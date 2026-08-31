import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";

// WEB-6's RTL convention, applied to WEB-4's actual guard logic rather
// than a throwaway example component. Mocks the global `fetch` the same
// way client.test.ts does, so useSessionQuery's underlying apiFetch call
// resolves to whatever a given test needs without a real apps/api server.
function renderProtectedRoute(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/net-worth" element={<div>Net worth page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProtectedRoute", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("renders the nested route once the session resolves to a user", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "u1", email: "a@b.com" }), { status: 200 }),
    );

    renderProtectedRoute("/net-worth");

    expect(await screen.findByText("Net worth page")).toBeInTheDocument();
  });

  it("redirects to /login when the session resolves to unauthenticated", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );

    renderProtectedRoute("/net-worth");

    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });
});
