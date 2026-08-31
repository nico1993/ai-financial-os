// WEB-6: Testing Library + vitest wiring. Registers jest-dom's matchers
// (toBeInTheDocument, toHaveTextContent, etc.) against vitest's `expect`
// -- the `/vitest` entry point exists specifically so this package never
// pulls in a real jest dependency. Referenced via vitest.config.ts's
// `test.setupFiles`, so every test file gets these matchers for free.
import "@testing-library/jest-dom/vitest";
