// pages/RegisterPage.tsx — AUTH-6: the bootstrap account-creation page
// that never got built alongside AUTH-5/WEB-4's login form. The backend
// side (`POST /api/auth/register`, AUTH-3/ADR-0018) has always existed
// and always enforced its own "bootstrap only, or an already-signed-in
// user adding another" rule -- what was missing was any way to reach it
// from a browser at all. Before this, the only path was a raw `curl`
// call, which is fine for one person setting up their own self-hosted
// instance once, but not something to hand someone less comfortable
// doing that by hand (BACKLOG.md's own gap note, verbatim).
//
// This page is deliberately reachable at all times, not conditionally
// shown only "when registration is actually open" -- there's no cheap,
// public way to know that in advance (checking would mean a new
// unauthenticated "is registration open" endpoint just to decide whether
// to show a link to a form the backend already gates correctly), and the
// backend's 403 ("registration is closed") is a perfectly clear answer
// on its own. Post-bootstrap, visiting /register and getting a plain
// "Registration is closed" message is a completely ordinary outcome for
// a self-hosted app, the same shape as most single-tenant software
// handles a used-up setup link.
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { getApiErrorMessage } from "../api/client";
import { useRegisterMutation, useSessionQuery } from "../auth/session";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";

export default function RegisterPage() {
  const navigate = useNavigate();
  const session = useSessionQuery();
  const register = useRegisterMutation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState(false);

  // Already signed in -- e.g. someone bookmarked /register after their
  // one-time bootstrap -- send them on rather than showing a form whose
  // only remaining outcome (adding a second user) isn't this app's
  // primary use case, matching LoginPage's own already-signed-in guard.
  if (session.data) {
    return <Navigate to="/accounts" replace />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMismatchError(true);
      return;
    }
    setMismatchError(false);
    register.mutate(
      { email, password },
      { onSuccess: () => navigate("/accounts", { replace: true }) },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            One-time setup for this self-hosted instance -- there is no public signup.
          </CardDescription>
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
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirm-password" className="text-xs font-medium text-ink">
                Confirm password
              </label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            {mismatchError && (
              <p role="alert" className="text-xs text-critical-text">
                Passwords do not match.
              </p>
            )}
            {register.isError && (
              <p role="alert" className="text-xs text-critical-text">
                {getApiErrorMessage(register.error, "Could not create the account. Try again.")}
              </p>
            )}
            <Button type="submit" disabled={register.isPending} className="mt-2">
              {register.isPending ? "Creating account…" : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-ink-muted">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-ink underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
