import { Navigate, createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./layout/AppShell";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import TransactionsPage from "./pages/TransactionsPage";
import OverviewPage from "./pages/OverviewPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import ReviewPage from "./pages/ReviewPage";
import CategoriesPage from "./pages/CategoriesPage";
import SettingsPage from "./pages/SettingsPage";

// WEB-2's route table -- every page BACKLOG.md names for this epic:
// login (AUTH-5), net worth, cash flow, spending categories,
// subscriptions, and the review queue (CAT-7). ANLY-9 replaced the four
// analytics PageStubs with the real pages; CAT-7 replaced the fifth
// (/review) with the real Tier 4 review queue, reusing WEB-8's
// TransactionsTable + useTransactionsQuery (status: "needs_review") per
// BACKLOG.md's own rescoping note, rather than a page built from scratch.
// /accounts (WEB-7) and /transactions (WEB-8) are both new since then --
// neither named in WEB-2's original ticket text, added once each was
// scoped as its own real gap: connect-a-bank has to live somewhere
// before net worth/cash flow/spending have anything to show, and a raw
// transaction ledger turned out to not exist anywhere despite four pages
// of aggregates over it (BACKLOG.md's WEB-8 gap note).
//
// ANLY-13 replaces /net-worth, /cash-flow, /spending, and /accounts (four
// routes) with a single /overview route absorbing all four pages' content
// -- see OverviewPage.tsx's own file header for the layout. "/" and any
// unmatched path both redirect to /overview now (previously /net-worth);
// nothing else about the redirect shape changes.
//
// /login and /register (AUTH-6) both sit outside ProtectedRoute
// (public); everything else nests under it, then under AppShell for the
// shared nav/header (WEB-4).
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/overview" replace /> },
          { path: "overview", element: <OverviewPage /> },
          { path: "transactions", element: <TransactionsPage /> },
          { path: "subscriptions", element: <SubscriptionsPage /> },
          { path: "review", element: <ReviewPage /> },
          // CAT-16: the /categories management page -- three grouped
          // sections (Custom/Income/Expense) plus "Add category",
          // relocated off ReviewPage.tsx (see CategoriesPage.tsx's own
          // comment).
          { path: "categories", element: <CategoriesPage /> },
          // AUTH-7: reached from AppShell's new settings link next to
          // Sign out, not from the main NAV_ITEMS list -- a settings
          // page is not a daily-use destination competing with the ones
          // that already have nav items (CAT-16's own /categories
          // placement made the same call for the same reason).
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <Navigate to="/overview" replace /> },
        ],
      },
    ],
  },
]);
