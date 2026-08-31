import { Navigate, createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./layout/AppShell";
import LoginPage from "./pages/LoginPage";
import { PageStub } from "./pages/PageStub";
import NetWorthPage from "./pages/NetWorthPage";
import CashFlowPage from "./pages/CashFlowPage";
import SpendingPage from "./pages/SpendingPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";

// WEB-2's route table -- every page BACKLOG.md names for this epic:
// login (AUTH-5), net worth, cash flow, spending categories,
// subscriptions, and the review queue (CAT-7). ANLY-9 replaced the four
// analytics PageStubs with the real pages; /review stays a PageStub until
// CAT-7 (a separate, still-unchecked ticket -- confirmed via BACKLOG.md,
// not assumed) builds the Tier 4 review queue UI.
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
          { path: "net-worth", element: <NetWorthPage /> },
          { path: "cash-flow", element: <CashFlowPage /> },
          { path: "spending", element: <SpendingPage /> },
          { path: "subscriptions", element: <SubscriptionsPage /> },
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
