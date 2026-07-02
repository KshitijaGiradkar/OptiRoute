/**
 * postcss.config.js — PostCSS pipeline for Tailwind CSS.
 *
 * Tailwind is a PostCSS plugin that generates utility class CSS at build time.
 * Autoprefixer adds vendor prefixes (e.g., -webkit-) for cross-browser support.
 * Vite picks this config up automatically — no further wiring needed.
 */

export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
