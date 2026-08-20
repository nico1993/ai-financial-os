// Plain Node/TS ruleset: base config + Node globals. Used by apps/api,
// apps/worker, and the packages/* libraries — none of them run in a
// browser. See ARCHITECTURE.md 7.4.
import globals from "globals";
import base from "./base.js";

export default [
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
