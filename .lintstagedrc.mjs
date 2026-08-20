// lint-staged config for the monorepo. ESLint is workspace-scoped (each
// workspace has its own eslint.config.js — see SETUP-3), so staged files are
// grouped by workspace and linted through `pnpm --filter <name> exec eslint`
// rather than a single root-level eslint invocation. Prettier's config is
// shared and resolves from any directory (root package.json's "prettier"
// field), so it runs once across every staged file type it covers.
import path from "node:path";

const WORKSPACES = [
  { name: "@financial-os/web", dir: "apps/web" },
  { name: "@financial-os/api", dir: "apps/api" },
  { name: "@financial-os/worker", dir: "apps/worker" },
  { name: "@financial-os/db", dir: "packages/db" },
  { name: "@financial-os/providers", dir: "packages/providers" },
  { name: "@financial-os/shared", dir: "packages/shared" },
];

const toWorkspaceRelative = (dir, files) =>
  files.map((file) => JSON.stringify(path.relative(dir, file))).join(" ");

const eslintTasks = Object.fromEntries(
  WORKSPACES.map(({ name, dir }) => [
    `${dir}/**/*.{ts,tsx}`,
    (files) => `pnpm --filter ${name} exec eslint --fix ${toWorkspaceRelative(dir, files)}`,
  ]),
);

export default {
  ...eslintTasks,
  "*.{ts,tsx,js,jsx,json,md,yml,yaml,css,html}": ["prettier --write"],
};
