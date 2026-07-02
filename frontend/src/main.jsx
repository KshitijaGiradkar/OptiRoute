/**
 * main.jsx — React application bootstrap.
 *
 * Why this file exists:
 *   Vite looks for the entry point declared in index.html's <script> tag.
 *   This file is that entry point.  It mounts the React component tree into
 *   the #root DOM node and imports the global CSS (Tailwind directives).
 *
 * StrictMode:
 *   Wrapping in React.StrictMode enables extra dev-only warnings, including
 *   double-invocation of render functions to catch side-effect bugs.  It has
 *   no effect in production builds.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";   // Tailwind base / components / utilities

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
