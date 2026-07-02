/**
 * RouteDisplay.jsx — Optimised delivery route result display.
 *
 * Why this file exists:
 *   Presents the ordered delivery sequence returned by the VRPTW solver in a
 *   format that is immediately actionable for a driver on a mobile phone:
 *     • Stop number + address at a glance
 *     • Estimated arrival time (computed by OR-Tools)
 *     • Time slot window (what the customer booked)
 *     • "Open Maps" button that deep-links directly into Google Maps navigation
 *
 * Props:
 *   route  {OptimizeRouteResponse}  The full response object from the backend:
 *     {
 *       success:       boolean,
 *       total_stops:   number,
 *       depot_address: string,
 *       route: Array<{
 *         stop_number:  number,
 *         address:      string,
 *         arrival_time: string,   e.g. "10:30 AM"
 *         time_window:  string,   e.g. "9:00 AM – 12:00 PM"
 *         slot:         number,   1 or 2
 *         maps_url:     string,   Google Maps deep link
 *       }>
 *     }
 *
 * Mobile UX decisions:
 *   • "Open Maps" uses target="_blank" — on iOS/Android this hands off to
 *     the native Google Maps app if installed, otherwise opens Maps in the browser.
 *   • Stop cards are tall enough to tap comfortably (min ~48px touch target).
 *   • Text is truncated with ellipsis for long addresses; the Maps link shows
 *     the full address in navigation anyway.
 *   • Slot 1 stops get a blue accent; Slot 2 stops get an orange accent so
 *     the driver can visually group morning vs. afternoon deliveries at a glance.
 */

import React from "react";

/** Colour scheme per slot — applied to the left border and badge. */
const SLOT_STYLES = {
  1: {
    border:  "border-l-blue-500",
    badge:   "bg-blue-100 text-blue-700",
    label:   "Slot 1",
  },
  2: {
    border:  "border-l-orange-400",
    badge:   "bg-orange-100 text-orange-700",
    label:   "Slot 2",
  },
};

export default function RouteDisplay({ route }) {
  /**
   * Guard: render nothing if the prop is empty or the route array is empty.
   * App.jsx only renders this component once `route` is non-null, but this
   * guard protects against unexpected edge cases.
   */
  if (!route?.route?.length) return null;

  const { total_stops, depot_address, route: stops } = route;

  return (
    <section className="mt-6" aria-label="Optimised delivery route">

      {/* ── Summary banner ───────────────────────────────────────────── */}
      <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4
        flex items-start gap-3">
        <span className="text-2xl mt-0.5" aria-hidden="true">✅</span>
        <div>
          <h2 className="text-base font-bold text-green-800">
            Route optimised — {total_stops} {total_stops === 1 ? "stop" : "stops"}
          </h2>
          <p className="text-sm text-green-700 mt-0.5">
            <span className="font-medium">Starting from:</span>{" "}
            {depot_address}
          </p>
          <p className="text-xs text-green-600 mt-1">
            Arrival times are from a 9:00 AM depot departure.
            Tap a stop's "Maps →" button to navigate directly.
          </p>
        </div>
      </div>

      {/* ── Stop cards ───────────────────────────────────────────────── */}
      <ol className="space-y-3" aria-label="Ordered delivery stops">
        {stops.map((stop) => {
          const style = SLOT_STYLES[stop.slot] ?? SLOT_STYLES[1];

          return (
            <li
              key={stop.stop_number}
              className={`bg-white rounded-2xl shadow-sm border border-gray-100
                border-l-4 ${style.border} overflow-hidden`}
            >
              <div className="flex items-stretch">

                {/* Stop number circle */}
                <div className="flex-shrink-0 flex items-center justify-center
                  bg-gray-800 text-white font-bold text-sm w-10 min-h-full
                  rounded-l-none">
                  {stop.stop_number}
                </div>

                {/* Stop details */}
                <div className="flex-1 px-3 py-3 min-w-0">
                  {/* Address — truncated with tooltip for long strings */}
                  <p
                    className="font-semibold text-gray-900 text-sm leading-snug
                      truncate"
                    title={stop.address}
                  >
                    {stop.address}
                  </p>

                  {/* Time info row */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                    {/* ETA pill */}
                    <span className="inline-flex items-center gap-1 text-xs
                      font-bold text-blue-700 bg-blue-50 rounded-full px-2 py-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor"
                        strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <path strokeLinecap="round" d="M12 6v6l4 2" />
                      </svg>
                      ETA {stop.arrival_time}
                    </span>

                    {/* Slot badge */}
                    <span className={`text-xs font-semibold rounded-full
                      px-2 py-0.5 ${style.badge}`}>
                      {style.label} · {stop.time_window}
                    </span>
                  </div>
                </div>

                {/* Google Maps navigation button */}
                <div className="flex-shrink-0 flex items-center pr-3">
                  <a
                    href={stop.maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open Google Maps navigation to ${stop.address}`}
                    className="inline-flex items-center gap-1 bg-green-500
                      hover:bg-green-600 active:scale-95 text-white text-xs
                      font-bold px-3 py-2 rounded-xl transition-all duration-150
                      shadow-sm whitespace-nowrap"
                  >
                    {/* Mini map pin icon */}
                    <svg className="w-3.5 h-3.5" fill="currentColor"
                      viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75
                        7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5
                        S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
                    </svg>
                    Maps →
                  </a>
                </div>

              </div>
            </li>
          );
        })}
      </ol>

      {/* ── Footer note ──────────────────────────────────────────────── */}
      <p className="text-center text-xs text-gray-400 mt-5">
        Route computed by Google OR-Tools VRPTW &nbsp;•&nbsp;
        Travel times via Google Maps Distance Matrix API
      </p>
    </section>
  );
}
