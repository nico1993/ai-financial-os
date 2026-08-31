import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "./api/queryClient";
import { router } from "./router";

// WEB-1 bootstrapped the toolchain with a placeholder screen; WEB-2/3/4
// replace it with the real provider + router composition. Routes/pages
// themselves are router.tsx's job, not this file's.
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
