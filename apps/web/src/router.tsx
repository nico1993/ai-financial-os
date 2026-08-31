import { Navigate, createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./layout/AppShell";
import LoginPage from "./pages/LoginPage";
import { PageStub } from "./pages/PageStub";

// WEB-2's route table -- every page BACKLOG.md names for this epic:
// login (AUTH-5), net worth, cash flow, spending categories,
// subscriptions, and the review queue (CAT-7). Each protected page is a
// PageStub until ANLY-9..11/CAT-7 build the real thing; WEB-2's job is
// the table and the auth guard, not those pages themselves.
//
// /login sits outside ProtectedRoute (public); everything else nests
// under it, then under AppShell for the shared nav/header (WEB-4). "/"
// redirects to /net-worth rather than being its own page -- BACKLOG.md
// never named a distinct overview/dashboard-home route, so this doesn't
// invent one ahead of the ticket that would.
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/net-worth" replace /> },
          {
            path: "net-worth",
            element: (
              <PageStub
                title="Net Worth"
                description="Balance history across every linked account (ANLY-3, ANLY-9)."
              />
            ),
          },
          {
            path: "cash-flow",
            element: (
              <PageStub
                title="Cash Flow"
                description="Monthly income vs. expenses, transfers excluded (ANLY-4, ANLY-9)."
              />
            ),
          },
          {
            path: "spending",
            element: (
              <PageStub
                title="Spending"
                description="Category breakdown and trend over time (ANLY-5, ANLY-9)."
              />
            ),
          },
          {
            path: "subscriptions",
            element: (
              <PageStub
                title="Subscriptions"
                description="Recurring charges detected from transaction history (ANLY-7, ANLY-9)."
              />
            ),
          },
          {
            path: "review",
            element: (
              <PageStub
                title="Needs Review"
                description="Transactions Tier 1-3 categorization couldn't confidently resolve (CAT-7)."
              />
            ),
          },
          { path: "*", element: <Navigate to="/net-worth" replace /> },
        ],
      },
    ],
  },
]);
