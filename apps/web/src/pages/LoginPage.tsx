import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { getApiErrorMessage } from "../api/client";
import { useLoginMutation, useSessionQuery } from "../auth/session";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";

interface LocationState {
  from?: { pathname: string };
}

// AUTH-5, implemented here per its cross-reference to WEB-4.
export default function LoginPage() {
  const location = useLocation();
  const session = useSessionQuery();
  const login = useLoginMutation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Already signed in -- e.g. a bookmark straight to /login -- so send
  // them on to wherever ProtectedRoute originally redirected them from.
  if (session.data) {
    const state = location.state as LocationState | null;
    return <Navigate to={state?.from?.pathname ?? "/net-worth"} replace />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Access your personal ledger.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-xs font-medium text-ink">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-xs font-medium text-ink">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {login.isError && (
              <p role="alert" className="text-xs text-critical-text">
                {getApiErrorMessage(login.error, "Sign in failed. Check your email and password.")}
              </p>
            )}
            <Button type="submit" disabled={login.isPending} className="mt-2">
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          {/* AUTH-6: always shown -- there's no cheap way to know in
              advance whether bootstrap registration is still open, and
              the register page's own 403 handles the closed case. */}
          <p className="mt-4 text-center text-xs text-ink-muted">
            Setting this up for the first time?{" "}
            <Link to="/register" className="font-medium text-ink underline underline-offset-2">
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
