// Base ESLint flat config shared by every workspace: typescript-eslint's
// recommended rules on top of ESLint's own recommended set, with Prettier's
// conflicting stylistic rules turned off (Prettier owns formatting, ESLint
// owns correctness). Workspace-specific configs (node.js, react.js) extend
// this and layer on their own globals/plugins — see ARCHITECTURE.md 7.4.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "build/**", ".turbo/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
);
