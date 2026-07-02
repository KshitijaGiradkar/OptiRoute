"""
distance.py — OpenRouteService (ORS) integration for geocoding and travel-time matrix.

Why this file exists:
    The VRPTW solver needs a matrix of real-world driving times between every
    pair of locations.  This module handles the two ORS API calls required:

        1.  Geocoding  — convert each address string → (longitude, latitude)
            ORS Geocoding endpoint uses Pelias, which covers most global addresses.

        2.  Matrix     — given all coordinates, return an n×n driving-time matrix.
            The ORS Matrix API returns durations in seconds; we convert to minutes.

Why two separate steps (vs. Google Maps which accepted address strings directly):
    ORS's Matrix API only accepts coordinates, not free-text addresses.
    So we must geocode each address first.  This costs one extra API call per
    address, but ORS geocoding is also free within the daily quota.

ORS free-tier limits (as of 2024):
    - Geocoding:  2 000 requests / day
    - Matrix:     2 000 requests / day, max 50 locations per call (50×50 = 2 500 elements)
    Both limits are well above the 20-stop maximum this app supports.

API docs:
    Geocoding:  https://openrouteservice.org/dev/#/api-docs/geocode/search/get
    Matrix:     https://openrouteservice.org/dev/#/api-docs/v2/matrix/{profile}/post
"""

import requests
from typing import List, Tuple

from config import ORS_API_KEY

_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"
_MATRIX_URL  = "https://api.openrouteservice.org/v2/matrix/driving-car"


def _geocode_address(address: str) -> Tuple[float, float]:
    """
    Converts a single free-text address string into (longitude, latitude) coordinates.

    Uses the ORS Geocoding API (Pelias-based), which handles street addresses,
    place names, postcodes, and city names globally.

    Why longitude-first (not latitude-first)?
        ORS follows the GeoJSON spec (RFC 7946) which mandates [longitude, latitude]
        order.  This is the opposite of most mapping conventions (lat/lng) — easy
        to get wrong.  All ORS API calls expect this order.

    Args:
        address (str):
            Free-text address, e.g. "221B Baker Street, London, UK".
            The more specific the address, the more accurate the geocode result.

    Returns:
        Tuple[float, float]:
            (longitude, latitude) in decimal degrees.
            Example: (-0.1577, 51.5237) for Baker Street, London.

    Raises:
        ValueError:
            If ORS cannot geocode the address (no features returned in response).
            This means the address is too vague, misspelled, or doesn't exist.
        requests.RequestException:
            Network-level failure (DNS error, timeout, connection refused).
    """
    params = {
        "api_key": ORS_API_KEY,
        "text":    address,
        "size":    1,    # return only the single best match
    }

    response = requests.get(_GEOCODE_URL, params=params, timeout=10)
    response.raise_for_status()

    data     = response.json()
    features = data.get("features", [])

    if not features:
        raise ValueError(
            f"Could not geocode address: '{address}'.\n"
            "Please check the spelling, add a city/country, and try again."
        )

    # GeoJSON geometry.coordinates is always [longitude, latitude]
    lon, lat = features[0]["geometry"]["coordinates"]
    return (lon, lat)


def _geocode_all(addresses: List[str]) -> List[List[float]]:
    """
    Geocodes every address in the list and returns ORS-ready coordinate pairs.

    Iterates sequentially rather than in parallel to avoid hitting ORS rate
    limits on the free tier (which enforces per-second limits in addition to
    the daily quota).

    Args:
        addresses (List[str]): Full address list — depot at [0], customers at [1…n-1].

    Returns:
        List[List[float]]:
            [[lon0, lat0], [lon1, lat1], …] — one pair per input address.
            The outer list keeps the same order as the input so that matrix
            index i always corresponds to addresses[i].

    Raises:
        ValueError: If any single address fails to geocode (error identifies which one).
    """
    coordinates = []
    for addr in addresses:
        lon, lat = _geocode_address(addr)
        coordinates.append([lon, lat])   # ORS Matrix expects a list of lists
    return coordinates


def fetch_distance_matrix(addresses: List[str]) -> List[List[int]]:
    """
    Geocodes all addresses then fetches a real-world driving-time matrix from ORS.

    This is the only public function in this module.  Its signature is identical
    to the original Google Maps version so that main.py needs zero changes.

    Pipeline:
        1. Validate input length.
        2. Geocode every address via _geocode_all() → list of [lon, lat] pairs.
        3. POST to ORS Matrix API with all coordinates.
        4. Convert the returned duration matrix from seconds → minutes.

    The returned matrix M satisfies:
        M[i][j] = estimated driving time in minutes from addresses[i] to addresses[j]
        M[i][i] = 0

    Args:
        addresses (List[str]):
            All addresses in routing order: depot at index 0, customers at 1…n-1.
            Must contain at least 2 elements.

    Returns:
        List[List[int]]:
            Square n×n matrix of driving times in minutes (rounded to nearest minute).

    Raises:
        ValueError:
            • Fewer than 2 addresses provided.
            • An address cannot be geocoded.
            • ORS Matrix API returns a None duration for an address pair (unroutable).
            • ORS API-level error in the response body.
        requests.RequestException:
            Network-level failures (timeout, connection refused, quota HTTP 429).
            The caller (main.py) maps this to HTTP 503.
    """
    if len(addresses) < 2:
        raise ValueError(
            "At least 2 addresses are required (depot + at least 1 customer)."
        )

    # ── Step 1: Geocode all addresses ─────────────────────────────────────
    # Each call to _geocode_address() makes one GET request to ORS Geocoding.
    coordinates = _geocode_all(addresses)

    # ── Step 2: Call ORS Matrix API ───────────────────────────────────────
    # ORS Matrix uses the Authorization header (not a query param) for POST.
    headers = {
        "Authorization":  ORS_API_KEY,
        "Content-Type":   "application/json",
        "Accept":         "application/json, application/geo+json",
    }

    # Request body: all coordinates are both sources and destinations so we
    # get the complete n×n matrix in a single request.
    body = {
        "locations": coordinates,
        "metrics":   ["duration"],   # we only need time, not distance
        "units":     "m",            # metres (irrelevant for duration-only, but required)
    }

    response = requests.post(_MATRIX_URL, json=body, headers=headers, timeout=30)

    # ORS returns HTTP 4xx for bad API keys (401) and quota exceeded (429).
    # raise_for_status() converts these into requests.HTTPError so the caller
    # can distinguish them from our own ValueError.
    response.raise_for_status()

    data = response.json()

    # The "durations" key is a 2-D list (n×n) of floats in seconds,
    # or None for pairs with no driving route.
    raw_durations = data.get("durations")
    if not raw_durations:
        raise ValueError(
            "ORS Matrix API returned no duration data.  "
            "This is unexpected — check that all coordinates are reachable by car."
        )

    # ── Step 3: Convert seconds → minutes, check for unroutable pairs ─────
    n = len(addresses)
    time_matrix: List[List[int]] = [[0] * n for _ in range(n)]

    for i in range(n):
        for j in range(n):
            secs = raw_durations[i][j]

            # ORS returns None (null in JSON) when no route exists between two points
            # (e.g., islands without ferry connections, or geocoding landed in water).
            if secs is None:
                raise ValueError(
                    f"No driving route found between:\n"
                    f"  '{addresses[i]}'\n"
                    f"  '{addresses[j]}'\n"
                    "Verify that both addresses are reachable by car in the same region."
                )

            time_matrix[i][j] = round(secs / 60)

    return time_matrix
