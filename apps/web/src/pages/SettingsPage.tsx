// pages/SettingsPage.tsx — AUTH-7: lets the signed-in user edit their own
// profile (email, first/last name) and change their password. AUTH-8
// extends this same page with a "Danger zone" section (delete account)
// rather than a second page, since both are the same "manage my own
// account" destination reached from one place (AppShell's new settings
// link, next to Sign out).
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getApiErrorMessage } from "../api/client";
import {
  useChangePasswordMutation,
  useSessionQuery,
  useUpdateProfileMutation,
} from "../auth/session";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";

/** The Profile card: email, first name, last name. Prefilled once
 * `useSessionQuery()` resolves via the effect below -- unlike
 * RegisterPage/LoginPage (which start from an empty form), this page is
 * editing an existing record that may not have loaded yet on first
 * paint. */
function ProfileCard() {
  const session = useSessionQuery();
  const user = session.data;
  const updateProfile = useUpdateProfileMutation();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setFirstName(user.firstName ?? "");
      setLastName(user.lastName ?? "");
    }
  }, [user]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateProfile.mutate({ email, firstName, lastName });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name and the email you sign in with.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="first-name" className="text-xs font-medium text-ink">
                First name
              </label>
              <Input
                id="first-name"
                autoComplete="given-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="last-name" className="text-xs font-medium text-ink">
                Last name
              </label>
              <Input
                id="last-name"
                autoComplete="family-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>
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
          {updateProfile.isError && (
            <p role="alert" className="text-xs text-critical-text">
              {getApiErrorMessage(updateProfile.error, "Could not save your profile. Try again.")}
            </p>
          )}
          {updateProfile.isSuccess && <p className="text-xs text-ink-secondary">Saved.</p>}
          <Button type="submit" disabled={updateProfile.isPending || !user} className="self-start">
            {updateProfile.isPending ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** The Password card: current + new + confirm. Clears its own fields on
 * a successful change rather than leaving the just-changed password
 * sitting in the form -- the same instinct RegisterPage's confirm-
 * password field serves, applied here so a filled-in password field
 * doesn't linger on screen longer than it has to. */
function PasswordCard() {
  const changePassword = useChangePasswordMutation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setMismatchError(true);
      return;
    }
    setMismatchError(false);
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Requires your current password to set a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="current-password" className="text-xs font-medium text-ink">
              Current password
            </label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-password" className="text-xs font-medium text-ink">
              New password
            </label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-new-password" className="text-xs font-medium text-ink">
              Confirm new password
            </label>
            <Input
              id="confirm-new-password"
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
              New passwords do not match.
            </p>
          )}
          {changePassword.isError && (
            <p role="alert" className="text-xs text-critical-text">
              {getApiErrorMessage(changePassword.error, "Could not change your password.")}
            </p>
          )}
          {changePassword.isSuccess && (
            <p className="text-xs text-ink-secondary">Password changed.</p>
          )}
          <Button type="submit" disabled={changePassword.isPending} className="self-start">
            {changePassword.isPending ? "Changing…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-medium tracking-tight text-ink">Settings</h1>
        <p className="text-sm text-ink-secondary">Manage your profile and account.</p>
      </div>

      <div className="flex max-w-md flex-col gap-4">
        <ProfileCard />
        <PasswordCard />
      </div>
    </div>
  );
}
