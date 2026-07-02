# Delivery Route Optimization System

A full-stack application that optimises last-mile delivery routes using the **Vehicle Routing Problem with Time Windows (VRPTW)** algorithm.

Drivers enter a depot and up to 20 customer addresses, choose a morning or afternoon delivery slot per customer, and the system returns the fastest feasible sequence — with one-tap Google Maps navigation links for each stop.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Python FastAPI + Uvicorn |
| Optimisation | Google OR-Tools (VRPTW constraint solver) |
| Travel times | OpenRouteService Matrix + Geocoding API |
| Navigation | Google Maps deep links |

---

## How it works

```
Driver enters stops + slots
        │
        ▼
React (AddressForm)
        │  POST /api/optimize-route
        ▼
FastAPI (main.py)
        │
        ├─► distance.py ──► ORS Geocoding API (address → coordinates)
        │              └──► ORS Matrix API (coordinates → n×n time matrix, minutes)
        │
        └─► vrptw_solver.py ──► OR-Tools RoutingModel
               (PATH_CHEAPEST_ARC seed + local search, 30s limit)
               Returns ordered stop list with ETAs
        │
        ▼
React (RouteDisplay)
  Shows ordered stops + ETA + "Maps →" button per stop
```

### Time windows

| Slot | Hours | Minutes from 9 AM |
|---|---|---|
| Slot 1 | 9:00 AM – 12:00 PM | [0, 180] |
| Slot 2 | 1:00 PM – 5:00 PM | [240, 480] |

OR-Tools enforces these as hard constraints.  The solver allows waiting up to 60 min for a window to open but rejects any route that cannot meet all windows.

---

## Project Structure

```
Resume_project/
├── backend/
│   ├── config.py          # Loads ORS_API_KEY from .env
│   ├── models.py          # Pydantic request/response schemas
│   ├── distance.py        # ORS Geocoding + Matrix API client
│   ├── vrptw_solver.py    # OR-Tools VRPTW implementation
│   └── main.py            # FastAPI app + /optimize-route endpoint
├── frontend/
│   ├── index.html
│   ├── vite.config.js     # Dev proxy: /api → localhost:8000
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── package.json
│   └── src/
│       ├── main.jsx
│       ├── index.css      # Tailwind directives
│       ├── App.jsx        # Root component + state management
│       └── components/
│           ├── AddressForm.jsx   # Depot + dynamic stop input form
│           └── RouteDisplay.jsx  # Ordered route with Maps links
├── requirements.txt
├── .env.example
└── README.md
```

---

## Setup

### Prerequisites

- Python 3.10 or higher
- Node.js 18 or higher
- A free OpenRouteService account

### 1 — Get an OpenRouteService API Key

OpenRouteService is free — no credit card required.

1. Go to [openrouteservice.org](https://openrouteservice.org/) and click **Get API Key**
2. Confirm your email and log in to the dashboard
3. Your default API token is shown under **Tokens** — copy it
4. Free tier includes 2 000 geocoding + 2 000 matrix requests per day,
   which comfortably covers 20 stops × multiple optimisations per day

### 2 — Backend

```bash
# From the project root:
cd backend

# Create and activate a virtual environment (recommended)
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

# Install dependencies
pip install -r ../requirements.txt

# Configure your API key
cp ../.env.example ../.env
# Open .env and replace "your_openrouteservice_api_key_here" with your real key

# Start the API server
uvicorn main:app --reload --port 8000
```

The API is now live at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/docs`

### 3 — Frontend

```bash
# From the project root (new terminal):
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## API Reference

### `GET /health`

Liveness probe.

```json
{ "status": "ok", "service": "VRPTW Delivery Route Optimizer" }
```

### `POST /optimize-route`

**Request body:**

```json
{
  "depot_address": "10 Downing Street, London, UK",
  "deliveries": [
    { "address": "221B Baker Street, London, UK", "slot": 1 },
    { "address": "1 Parliament Square, London, UK", "slot": 2 }
  ]
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "total_stops": 2,
  "depot_address": "10 Downing Street, London, UK",
  "route": [
    {
      "stop_number": 1,
      "address": "221B Baker Street, London, UK",
      "arrival_time": "9:22 AM",
      "time_window": "9:00 AM – 12:00 PM",
      "slot": 1,
      "maps_url": "https://www.google.com/maps/dir/?api=1&destination=221B%20Baker%20Street%2C%20London%2C%20UK"
    },
    {
      "stop_number": 2,
      "address": "1 Parliament Square, London, UK",
      "arrival_time": "1:05 PM",
      "time_window": "1:00 PM – 5:00 PM",
      "slot": 2,
      "maps_url": "https://www.google.com/maps/dir/?api=1&destination=1%20Parliament%20Square%2C%20London%2C%20UK"
    }
  ]
}
```

**Error responses:**

| Status | Cause |
|---|---|
| 400 | Invalid/unroutable address, invalid slot, >20 stops |
| 422 | OR-Tools found no feasible solution |
| 503 | Google Maps API unreachable |

---

## Design Decisions

**Why VRPTW instead of TSP?**  
TSP (Travelling Salesman Problem) finds the shortest tour but ignores customer time preferences.  VRPTW adds hard time-window constraints so the solver only accepts routes where the driver actually arrives within the promised slot.

**Why OR-Tools?**  
Google OR-Tools is production-grade, free, and handles ≤20 stops in under a second.  The constraint programming engine propagates time-window violations early, pruning the search space before exploring infeasible branches.

**Why OpenRouteService instead of Google Maps?**  
ORS is fully free (no billing account, no credit card) and open-source, making it ideal for portfolio projects.  The trade-off is that ORS requires two API calls per request (geocoding + matrix) whereas Google Maps accepted address strings directly.  For production scale, Google Maps or HERE Maps offer higher quotas and global traffic data.

**Why two ORS calls (geocode then matrix)?**  
ORS's Matrix API only accepts coordinates, not address strings.  So we geocode each address individually first, then send all coordinates in one matrix call.  This is n+1 API calls per optimisation request (n geocodes + 1 matrix).

**Why service_time=10 minutes per stop?**  
Accounts for parking, walking to the door, and obtaining a signature.  Increase this value in `vrptw_data` in `main.py` if your deliveries take longer.
