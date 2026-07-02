/**
 * AddressForm.jsx — Delivery stop input form.
 *
 * Why this file exists:
 *   Encapsulates all user-input logic for building a route optimisation
 *   request.  The parent (App.jsx) only needs to provide an `onSubmit`
 *   callback; it never sees the internal editing state.
 *
 * What it renders:
 *   1. Depot / start address — a single text input at the top.
 *   2. Delivery stops list   — dynamic rows, each with:
 *        • A free-text address input
 *        • A slot selector (Slot 1 = 9am–12pm, Slot 2 = 1pm–5pm)
 *        • A remove button (hidden when only one stop remains)
 *   3. "Add Stop" button — appends a new blank row (max 20).
 *   4. "Optimise Route" submit button — validates then calls props.onSubmit.
 *
 * Props:
 *   onSubmit  {Function}  Called with { depot_address, deliveries } on valid submit.
 *   loading   {boolean}   When true, the submit button is disabled and shows a
 *                          spinner/label so the driver knows a request is in flight.
 *
 * Internal state:
 *   depotAddress  {string}       — controlled value of the depot input.
 *   stops         {Array<Stop>}  — list of delivery stop objects.
 *   errors        {Object}       — keyed validation errors ('depot', 'stop_0', …).
 *
 * Stop shape:
 *   { id: number, address: string, slot: 1|2 }
 *   id is a timestamp, used as the React key so re-ordering rows doesn't
 *   cause input focus to jump.
 */

import React, { useState } from "react";

/** Generates a fresh blank stop with a unique id. */
const newStop = () => ({ id: Date.now() + Math.random(), address: "", slot: 1 });

export default function AddressForm({ onSubmit, loading }) {
  const [depotAddress, setDepotAddress] = useState("");
  const [stops, setStops]               = useState([newStop()]);
  const [errors, setErrors]             = useState({});

  // ─── Stop list mutation helpers ────────────────────────────────────────

  /**
   * addStop
   *
   * Appends a blank delivery stop to the list.
   * Capped at 20 to match the backend's Distance Matrix API limit.
   */
  const addStop = () => {
    if (stops.length >= 20) return;
    setStops((prev) => [...prev, newStop()]);
  };

  /**
   * removeStop
   *
   * Removes the stop with the given id from the list.
   * Refuses to remove the last remaining stop so the form is never empty.
   *
   * @param {number} id — the stop's unique id
   */
  const removeStop = (id) => {
    if (stops.length <= 1) return;
    setStops((prev) => prev.filter((s) => s.id !== id));
    // Clear any error for removed stop (find its index by id for cleanup)
    setErrors((prev) => {
      const updated = { ...prev };
      // We don't know the old index here, so re-validate on next submit.
      return updated;
    });
  };

  /**
   * updateStop
   *
   * Immutably updates a single field on the stop with the given id.
   *
   * @param {number} id     — target stop id
   * @param {string} field  — 'address' | 'slot'
   * @param {*}      value  — new value for that field
   */
  const updateStop = (id, field, value) => {
    setStops((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  // ─── Validation ────────────────────────────────────────────────────────

  /**
   * validate
   *
   * Checks that every required field is filled in.  Returns an errors object
   * keyed by field name; an empty object means the form is valid.
   *
   * @returns {Object} errors — e.g. { depot: 'Required', stop_0: 'Required' }
   */
  const validate = () => {
    const errs = {};

    if (!depotAddress.trim()) {
      errs.depot = "Depot address is required.";
    }

    stops.forEach((stop, idx) => {
      if (!stop.address.trim()) {
        errs[`stop_${idx}`] = "Address is required.";
      }
    });

    return errs;
  };

  // ─── Form submission ────────────────────────────────────────────────────

  /**
   * handleSubmit
   *
   * Validates the form, then calls props.onSubmit with the cleaned data.
   * Prevents the default browser form submission (page reload).
   *
   * @param {React.FormEvent} e
   */
  const handleSubmit = (e) => {
    e.preventDefault();

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      // Scroll to the first error so it's visible on mobile.
      const firstErrKey = Object.keys(errs)[0];
      const el = document.getElementById(`field-${firstErrKey}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setErrors({});
    onSubmit({
      depot_address: depotAddress.trim(),
      deliveries: stops.map((s) => ({
        address: s.address.trim(),
        slot:    s.slot,
      })),
    });
  };

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <form
      onSubmit={handleSubmit}
      noValidate              /* we handle validation ourselves */
      className="bg-white rounded-2xl shadow-md p-5 mt-4"
    >
      <h2 className="text-lg font-bold text-gray-800 mb-5">Plan Your Deliveries</h2>

      {/* ── Depot Address ─────────────────────────────────────────────── */}
      <div className="mb-6" id="field-depot">
        <label
          htmlFor="depot-input"
          className="block text-sm font-semibold text-gray-700 mb-1"
        >
          Depot / Start Address
        </label>
        <input
          id="depot-input"
          type="text"
          value={depotAddress}
          onChange={(e) => setDepotAddress(e.target.value)}
          placeholder="e.g. 10 Downing Street, London, UK"
          autoComplete="street-address"
          className={`w-full border rounded-xl px-4 py-3 text-base
            focus:outline-none focus:ring-2 focus:ring-blue-500
            ${errors.depot ? "border-red-400 bg-red-50" : "border-gray-300"}`}
        />
        {errors.depot && (
          <p className="text-red-500 text-xs mt-1" role="alert">
            {errors.depot}
          </p>
        )}
        <p className="text-gray-400 text-xs mt-1">
          Where the driver starts — warehouse, office, etc.
        </p>
      </div>

      {/* ── Delivery Stops ────────────────────────────────────────────── */}
      <div className="mb-5">
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-gray-700">
            Delivery Stops
            <span className="ml-1 text-gray-400 font-normal">
              ({stops.length}/20)
            </span>
          </span>
          <button
            type="button"
            onClick={addStop}
            disabled={stops.length >= 20}
            className="text-sm text-blue-600 font-semibold disabled:text-gray-400
              disabled:cursor-not-allowed hover:text-blue-800 transition-colors"
          >
            + Add Stop
          </button>
        </div>

        {/* Stop rows */}
        <div className="space-y-3">
          {stops.map((stop, idx) => (
            <div
              key={stop.id}
              id={`field-stop_${idx}`}
              className="flex gap-2 items-start"
            >
              {/* Stop number badge */}
              <span className="flex-shrink-0 w-7 h-10 flex items-center justify-center
                text-sm font-bold text-gray-400 pt-1">
                {idx + 1}
              </span>

              {/* Address input */}
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={stop.address}
                  onChange={(e) => updateStop(stop.id, "address", e.target.value)}
                  placeholder={`Customer address ${idx + 1}`}
                  autoComplete="off"
                  className={`w-full border rounded-xl px-3 py-2.5 text-base
                    focus:outline-none focus:ring-2 focus:ring-blue-500
                    ${errors[`stop_${idx}`]
                      ? "border-red-400 bg-red-50"
                      : "border-gray-300"
                    }`}
                />
                {errors[`stop_${idx}`] && (
                  <p className="text-red-500 text-xs mt-1" role="alert">
                    {errors[`stop_${idx}`]}
                  </p>
                )}
              </div>

              {/* Slot selector */}
              <select
                value={stop.slot}
                onChange={(e) => updateStop(stop.id, "slot", Number(e.target.value))}
                aria-label={`Time slot for stop ${idx + 1}`}
                className="flex-shrink-0 border border-gray-300 rounded-xl px-2
                  py-2.5 text-sm bg-white
                  focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={1}>Slot 1 · 9am–12pm</option>
                <option value={2}>Slot 2 · 1pm–5pm</option>
              </select>

              {/* Remove button — hidden when there's only one stop */}
              {stops.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeStop(stop.id)}
                  aria-label={`Remove stop ${idx + 1}`}
                  className="flex-shrink-0 w-9 h-10 flex items-center justify-center
                    text-gray-400 hover:text-red-500 transition-colors rounded-lg
                    hover:bg-red-50"
                >
                  ✕
                </button>
              ) : (
                /* Invisible spacer so layout stays consistent */
                <div className="flex-shrink-0 w-9" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Slot legend ───────────────────────────────────────────────── */}
      <div className="flex gap-4 mb-5 text-xs text-gray-500">
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400 mr-1" />
          Slot 1: 9:00 AM – 12:00 PM
        </span>
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400 mr-1" />
          Slot 2: 1:00 PM – 5:00 PM
        </span>
      </div>

      {/* ── Submit button ──────────────────────────────────────────────── */}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold
          text-base hover:bg-blue-700 active:scale-95
          disabled:opacity-60 disabled:cursor-not-allowed
          transition-all duration-150 shadow-sm"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            {/* Simple CSS spinner */}
            <svg
              className="animate-spin h-5 w-5 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12" cy="12" r="10"
                stroke="currentColor" strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            Optimising route…
          </span>
        ) : (
          "Optimise Route →"
        )}
      </button>
    </form>
  );
}
