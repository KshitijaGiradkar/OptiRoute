/**
 * tailwind.config.js — Tailwind CSS configuration.
 *
 * content: tells Tailwind which files to scan for class names.
 *   Any class found in these files is included in the production CSS build;
 *   everything else is purged, keeping the bundle tiny.
 *
 * theme.extend: empty for now — the default Tailwind palette and spacing
 *   scale are sufficient for this project.
 *
 * plugins: none needed for this project.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      // Custom safe-area padding for mobile notches (useful for drivers
      // opening this on modern iPhones with a home indicator bar).
      spacing: {
        "safe-bottom": "env(safe-area-inset-bottom)",
      },
    },
  },
  plugins: [],
};
