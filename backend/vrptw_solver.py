"""
vrptw_solver.py — Google OR-Tools VRPTW (Vehicle Routing Problem with Time Windows) solver.

Why this file exists:
    The core optimisation logic lives here.  Given a real-world travel-time
    matrix and customer time windows, it uses Google OR-Tools' constraint
    programming engine to find the shortest feasible delivery sequence that
    arrives at every customer within their requested time slot.

Algorithm overview — VRPTW with OR-Tools:
    1.  RoutingIndexManager  maps between our "node" indices (0…n-1) and the
        internal "routing indices" that OR-Tools uses.  The depot is always
        node 0.
    2.  RoutingModel         is the solver object.  We register a transit
        callback (travel time between two nodes) and set it as the cost
        function — so OR-Tools minimises total travel time.
    3.  Time Dimension       is a cumulative quantity that tracks how much
        time has elapsed as the vehicle moves through stops.  OR-Tools
        propagates this automatically through the transit callback.
    4.  Time Windows         are hard constraints applied per node.  If the
        vehicle arrives early it waits (up to `slack_max` minutes); if it
        arrives after the latest time the solution is infeasible.
    5.  First Solution       is seeded with PATH_CHEAPEST_ARC (greedy
        nearest-neighbour), which is fast and good enough for ≤ 20 stops.
        The solver then tries local-search improvements within the 30-second
        time limit.

Time unit convention throughout this file:
    All times are in **minutes from 9:00 AM**.
        0   = 9:00 AM
        180 = 12:00 PM  (Slot 1 upper bound)
        240 = 1:00 PM   (Slot 2 lower bound)
        480 = 5:00 PM   (Slot 2 upper bound)
        540 = 6:00 PM   (hard horizon — driver must be done by then)
"""

from typing import Optional, List, Dict, Any

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

# ---------------------------------------------------------------------------
# Public constants (also useful for documentation / tests)
# ---------------------------------------------------------------------------
TIME_HORIZON_MINUTES = 540   # 9:00 AM + 540 min = 6:00 PM  (hard day boundary)
MAX_SLACK_MINUTES    = 60    # vehicle may wait up to 60 min for a window to open
SERVICE_TIME_DEFAULT = 10    # minutes spent at each delivery stop (unloading etc.)


# ---------------------------------------------------------------------------
# Time-formatting helpers
# ---------------------------------------------------------------------------

def _minutes_to_time_str(minutes_from_9am: int) -> str:
    """
    Converts an integer offset (minutes from 9:00 AM) into a human-readable
    12-hour clock string.

    Why this exists:
        OR-Tools stores and returns all times as integer offsets from the
        domain start (9 AM = minute 0).  Drivers need clock times, not offsets.

    Args:
        minutes_from_9am (int):  Non-negative integer.  e.g. 90 → "10:30 AM"

    Returns:
        str:  Clock time string, e.g. "10:30 AM", "1:00 PM".

    Examples:
        0   → "9:00 AM"
        90  → "10:30 AM"
        180 → "12:00 PM"
        240 → "1:00 PM"
        480 → "5:00 PM"
    """
    total_minutes_from_midnight = 9 * 60 + minutes_from_9am
    hours_24 = total_minutes_from_midnight // 60
    mins     = total_minutes_from_midnight % 60
    period   = "AM" if hours_24 < 12 else "PM"
    hours_12 = hours_24 % 12 or 12   # converts 0 → 12, 13 → 1, etc.
    return f"{hours_12}:{mins:02d} {period}"


def _format_time_window(tw: tuple) -> str:
    """
    Formats a (start, end) minute-offset tuple into a slot label.

    Args:
        tw (tuple):  (start_minutes, end_minutes) both from 9 AM.

    Returns:
        str:  e.g. "9:00 AM – 12:00 PM"
    """
    return f"{_minutes_to_time_str(tw[0])} – {_minutes_to_time_str(tw[1])}"


# ---------------------------------------------------------------------------
# Core solver
# ---------------------------------------------------------------------------

def solve_vrptw(data: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    """
    Solves the VRPTW and returns an ordered list of delivery stops.

    This is the main function called by main.py.  It wraps all OR-Tools API
    calls so the endpoint code stays clean and framework-agnostic.

    Args:
        data (dict):
            A dictionary built by main.py with the following keys:
            ┌─────────────────┬───────────────────────────────────────────────┐
            │ Key             │ Type / Description                            │
            ├─────────────────┼───────────────────────────────────────────────┤
            │ time_matrix     │ List[List[int]] — n×n matrix, minutes         │
            │ time_windows    │ List[Tuple[int,int]] — (earliest, latest) per │
            │                 │   node, in minutes from 9 AM; index 0=depot   │
            │ num_vehicles    │ int — number of delivery vehicles (usually 1) │
            │ depot           │ int — index of the depot node (always 0)      │
            │ service_time    │ int — minutes spent at each delivery stop      │
            │ addresses       │ List[str] — addresses[i] matches matrix row i │
            └─────────────────┴───────────────────────────────────────────────┘

    Returns:
        List[dict] on success — one dict per delivery stop (NOT including depot):
            {
              'stop_number':    int   — 1-based position in the route
              'address':        str   — customer address
              'arrival_minutes':int   — minutes from 9 AM (raw OR-Tools value)
              'arrival_time':   str   — human-readable clock string
              'slot':           int   — 1 or 2
              'time_window':    str   — human-readable window string
            }
        None if OR-Tools cannot find a feasible solution within constraints.

    Algorithmic notes:
        • Service time is folded into the transit callback so OR-Tools treats
          "time at node i" as travel_time(i→j) + service_time(i).
          This correctly models the driver spending time at each stop before
          leaving, without needing a separate "wait" arc.
        • fix_start_cumul_to_zero=False lets the solver choose the optimal
          start time within the depot's time window, rather than forcing the
          vehicle to depart exactly at minute 0 (9 AM).
        • AddVariableMinimizedByFinalizer on the end cumvar ensures the solver
          tries to minimise total tour duration when multiple solutions are
          otherwise equivalent in cost.
    """
    n = len(data["time_matrix"])

    # ------------------------------------------------------------------
    # Step 1: Routing Index Manager
    #   Maps between our 0…n-1 node indices and OR-Tools internal indices.
    #   Keeping them separate avoids confusion when OR-Tools adds "virtual"
    #   start/end nodes for each vehicle.
    # ------------------------------------------------------------------
    manager = pywrapcp.RoutingIndexManager(
        n,                       # total locations (depot + customers)
        data["num_vehicles"],    # vehicles in the fleet
        data["depot"],           # index of the depot node
    )

    # ------------------------------------------------------------------
    # Step 2: Routing Model
    #   The central OR-Tools object.  We attach callbacks and constraints
    #   to it, then ask it to solve.
    # ------------------------------------------------------------------
    routing = pywrapcp.RoutingModel(manager)

    # ------------------------------------------------------------------
    # Step 3: Transit (time) callback
    #   OR-Tools calls this with *routing indices* (not our node indices).
    #   We convert back to node indices to look up the time matrix, then
    #   add service time for non-depot origins.
    # ------------------------------------------------------------------
    def time_callback(from_routing_index: int, to_routing_index: int) -> int:
        """
        Returns the time cost (minutes) of moving from one routing index to another.

        Cost = travel_time(from→to) + service_time(from)
        Service time is only charged at delivery nodes, not at the depot.

        Args:
            from_routing_index: OR-Tools internal index of the origin node.
            to_routing_index:   OR-Tools internal index of the destination node.

        Returns:
            int: Total time in minutes to leave `from` and arrive at `to`.
        """
        from_node = manager.IndexToNode(from_routing_index)
        to_node   = manager.IndexToNode(to_routing_index)

        travel_minutes = data["time_matrix"][from_node][to_node]

        # Charge service time for delivery nodes only; the depot has no
        # unloading work associated with departing from it.
        service_minutes = (
            data.get("service_time", SERVICE_TIME_DEFAULT)
            if from_node != data["depot"]
            else 0
        )
        return travel_minutes + service_minutes

    transit_callback_index = routing.RegisterTransitCallback(time_callback)

    # Make total travel+service time the objective function to minimise.
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # ------------------------------------------------------------------
    # Step 4: Add the "Time" dimension
    #   A dimension is a cumulative quantity that OR-Tools tracks along
    #   each vehicle's route.  Here it represents elapsed time (minutes
    #   from 9 AM) at each node.
    #
    #   Parameters:
    #     transit_callback_index — how time increments at each arc
    #     MAX_SLACK_MINUTES      — max time the vehicle can wait at a node
    #                              before its time window opens
    #     TIME_HORIZON_MINUTES   — hard upper bound on cumulative time
    #                              (driver must be back by 6 PM)
    #     fix_start_cumul=False  — let the solver choose the best start
    #                              time within the depot's window
    #     'Time'                 — dimension name (must be unique)
    # ------------------------------------------------------------------
    routing.AddDimension(
        transit_callback_index,
        MAX_SLACK_MINUTES,
        TIME_HORIZON_MINUTES,
        False,    # do NOT fix start cumul to zero
        "Time",
    )
    time_dim = routing.GetDimensionOrDie("Time")

    # ------------------------------------------------------------------
    # Step 5: Apply time-window constraints to each delivery node.
    #   CumulVar(index).SetRange(lo, hi) tells OR-Tools:
    #     "the vehicle must arrive at `index` no earlier than lo
    #      and no later than hi."
    #   The solver propagates this constraint through the whole tour.
    # ------------------------------------------------------------------
    for node_idx, (window_start, window_end) in enumerate(data["time_windows"]):
        if node_idx == data["depot"]:
            # Depot constraint is handled below (per-vehicle start/end).
            continue
        routing_index = manager.NodeToIndex(node_idx)
        time_dim.CumulVar(routing_index).SetRange(window_start, window_end)

    # ------------------------------------------------------------------
    # Step 6: Set depot (start + end) time windows for each vehicle.
    #   We allow the vehicle to start and end anywhere in the full workday
    #   window [0, TIME_HORIZON_MINUTES].
    # ------------------------------------------------------------------
    for vehicle_id in range(data["num_vehicles"]):
        start_index = routing.Start(vehicle_id)
        end_index   = routing.End(vehicle_id)

        time_dim.CumulVar(start_index).SetRange(0, TIME_HORIZON_MINUTES)
        time_dim.CumulVar(end_index).SetRange(0, TIME_HORIZON_MINUTES)

        # Tell the finalizer to minimise finish time — tiebreaks in favour
        # of the driver finishing earlier in the day.
        routing.AddVariableMinimizedByFinalizer(time_dim.CumulVar(end_index))

    # ------------------------------------------------------------------
    # Step 7: Configure the search strategy.
    #   PATH_CHEAPEST_ARC builds the initial solution greedily (nearest
    #   neighbour) — O(n²) and very fast for ≤ 20 stops.
    #   The 30-second time limit allows OR-Tools to improve the initial
    #   solution via local search (2-opt, relocate, etc.).
    # ------------------------------------------------------------------
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.time_limit.seconds = 30

    # ------------------------------------------------------------------
    # Step 8: Solve!
    # ------------------------------------------------------------------
    solution = routing.SolveWithParameters(search_params)

    if not solution:
        # OR-Tools returns None when no feasible solution exists within
        # the given time windows and travel-time constraints.
        return None

    # ------------------------------------------------------------------
    # Step 9: Extract the ordered route from the solution.
    #   We walk the route for vehicle 0 using NextVar, collecting each
    #   delivery node's data as we go.
    # ------------------------------------------------------------------
    return _extract_route(manager, routing, solution, time_dim, data)


def _extract_route(
    manager: pywrapcp.RoutingIndexManager,
    routing: pywrapcp.RoutingModel,
    solution,
    time_dim,
    data: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Walks the OR-Tools solution for vehicle 0 and builds a Python list of
    stop dicts ready for the API response.

    Why separate from solve_vrptw:
        Keeping extraction logic separate keeps the main solver function
        focused on setup, and makes this piece unit-testable in isolation.

    Args:
        manager:   RoutingIndexManager used during solve.
        routing:   RoutingModel after solving.
        solution:  The Assignment object returned by SolveWithParameters.
        time_dim:  The "Time" dimension handle.
        data:      The same data dict passed to solve_vrptw.

    Returns:
        Ordered List[dict], one entry per delivery node (depot excluded).
        Each dict has keys: stop_number, address, arrival_minutes,
        arrival_time, slot, time_window.
    """
    stops: List[Dict[str, Any]] = []
    stop_number = 1

    # Start at the depot (vehicle 0's start node) and follow NextVar links
    # until we reach the end node.
    index = routing.Start(0)

    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)

        if node != data["depot"]:
            # Retrieve the minimum feasible arrival time for this node.
            # solution.Min(CumulVar) gives the earliest the solver can
            # satisfy all constraints — i.e., the optimistic ETA.
            arrival_min = solution.Min(time_dim.CumulVar(index))

            tw       = data["time_windows"][node]
            slot_num = 1 if tw[1] <= 180 else 2   # Slot 1 ends at 12pm = 180min

            stops.append(
                {
                    "stop_number":     stop_number,
                    "address":         data["addresses"][node],
                    "arrival_minutes": arrival_min,
                    "arrival_time":    _minutes_to_time_str(arrival_min),
                    "slot":            slot_num,
                    "time_window":     _format_time_window(tw),
                }
            )
            stop_number += 1

        # Advance to the next node in the tour.
        index = solution.Value(routing.NextVar(index))

    return stops
