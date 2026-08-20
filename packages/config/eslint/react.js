// apps/web's ruleset: base config + browser globals + React/React Hooks
// correctness rules (hooks-of-hooks, dependency arrays). See
// ARCHITECTURE.md 7.4. JSX runtime is react-jsx (see apps/web/tsconfig.json),
// so react/react-in-jsx-scope is unnecessary and disabled.
import globals from "globals";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import base from "./base.js";

export default [
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
];
