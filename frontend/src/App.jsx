/**
 * App.jsx — Root application component.
 *
 * Why this file exists:
 *   Manages the top-level application state and orchestrates the two child
 *   components (AddressForm and RouteDisplay).  Keeping state here — rather
 *   than in a child — lets both siblings share a single source of truth for
 *   loading, error, and route data without a state-management library.
 *
 * State:
 *   route   {object|null}   — Optimised route response from the backend.
 *                             null until a successful API call returns.
 *   loading {boolean}       — True while the POST /optimize-route request
 *                             is in flight; disables the form submit button.
 *   error   {string|null}   — Error message to surface to the driver.
 *                             null when there is no error.
 *
 * Data flow:
 *   AddressForm → onSubmit(formData) → handleOptimize() → POST /api/optimize-route
 *       → success: setRoute(data)      → RouteDisplay renders result
 *       → failure: setError(message)   → inline error banner
 */

import React, { useState } from "react";
import axios from "axios";
import AddressForm from "./components/AddressForm";
import RouteDisplay from "./components/RouteDisplay";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function App() {
  const [route, setRoute]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  /**
   * handleOptimize
   *
   * Called by AddressForm when the user submits valid input.
   * POSTs the form data to the FastAPI backend and updates state
   * based on the response.
   *
   * @param {Object} formData
   *   {
   *     depot_address: string,
   *     deliveries: Array<{ address: string, slot: number }>
   *   }
   *
   * The Vite proxy (vite.config.js) forwards /api/* → http://localhost:8000/*
   * so the URL here works in dev without hard-coding localhost:8000.
   */
  const handleOptimize = async (formData) => {
    setLoading(true);
    setError(null);
    setRoute(null);   // clear any previous result

    try {
      // const response = await axios.post("/api/optimize-route", formData);
      const response = await axios.post(
        `${API_URL}/optimize-route`,
        formData
      );
      setRoute(response.data);

      // Scroll to the results section after a short frame delay so the
      // DOM has time to render the RouteDisplay component before we scroll.
      setTimeout(() => {
        document.getElementById("results-section")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } catch (err) {
      // FastAPI surfaces user-facing error text in err.response.data.detail.
      // Fall back to the generic axios message for network-level failures.
      const detail = err.response?.data?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : err.message || "An unexpected error occurred. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-blue-600 text-white shadow-lg sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <span className="text-3xl" aria-hidden="true">🚚</span>
          <div>
            <h1 className="text-xl font-bold leading-tight tracking-tight">
              Delivery Route Optimizer
            </h1>
            <p className="text-blue-200 text-xs mt-0.5">
              VRPTW &nbsp;•&nbsp; Google OR-Tools &nbsp;•&nbsp; Google Maps
            </p>
          </div>
        </div>
      </header>

      {/* ─── Main Content ────────────────────────────────────────────────── */}
      <main className="max-w-2xl mx-auto px-4 pb-16">
        {/* Input form — always visible so the user can resubmit */}
        <AddressForm onSubmit={handleOptimize} loading={loading} />

        {/* Error banner — shown only when there is an error */}
        {error && (
          <div
            role="alert"
            className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl"
          >
            <p className="text-red-800 font-semibold text-sm">
              Optimisation failed
            </p>
            {/* Error text can be multi-line (FastAPI returns newline-separated hints) */}
            <pre className="text-red-700 text-sm mt-1 whitespace-pre-wrap font-sans">
              {error}
            </pre>
          </div>
        )}

        {/* Results — rendered once a successful response arrives */}
        {route && (
          <div id="results-section">
            <RouteDisplay route={route} />
          </div>
        )}
      </main>

      {/* ─── Footer ─────────────────────────────────────────────────────── */}
      <footer className="text-center text-xs text-gray-400 py-4 border-t border-gray-200">
        VRPTW Delivery Optimizer &nbsp;•&nbsp; Built with OR-Tools + FastAPI + React
      </footer>
    </div>
  );
}
