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
  server: {
    // Dev-only convenience (WEB-3, ADR-0032): the Caddyfile already
    // reverse-proxies /api + /events to apps/api for the docker-compose
    // stack, but running `pnpm --filter @financial-os/web dev` on its own
    // -- no Caddy in front -- would otherwise send apiFetch's relative
    // `/api/...` calls to Vite's own dev server instead of apps/api on
    // :3000. This proxy makes standalone frontend dev work the same way
    // without requiring the full stack to be up. Vite's dev-only `server`
    // option, so it has no effect on `vite build`/production.
    proxy: {
      "/api": "http://localhost:3000",
      "/events": "http://localhost:3000",
    },
  },
});
