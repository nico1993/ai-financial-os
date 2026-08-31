import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite + React + Tailwind (WEB-1, ADR-0011/ADR-0031). Tailwind's official
// Vite plugin replaces the postcss.config.js + autoprefixer setup Tailwind
// v3 needed -- v4 does the CSS transform itself. See src/index.css for the
// `@config` line that points Tailwind at tailwind.config.ts, which in turn
// imports src/design/tokens.ts -- that file stays the single place a
// color/font/radius value is edited (ADR-0030).
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
