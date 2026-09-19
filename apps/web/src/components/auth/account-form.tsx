"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
export function AccountForm({ mode, onComplete }: { mode: "register" | "login" | "setup"; onComplete?: () => void }) {
 const { user, refresh } = useAuth(); const router = useRouter();
 const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState("");
 async function submit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); setBusy(true); setError("");
  try {
   if (mode !== "login" && data.password !== data.confirmPassword) throw new Error("Your passwords don’t match.");
   delete data.confirmPassword;
   const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
   const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not sign in.");
   await refresh(); if (onComplete) onComplete(); else router.replace(mode === "login" ? "/dashboard" : "/connections");
  } catch (e) { setError(e instanceof Error ? e.message : "Could not sign in. Try again."); } finally { setBusy(false); }
 }
 return <form className="account-form" onSubmit={submit}>
  {mode !== "login" ? <><label>Display name<input name="nickname" defaultValue={mode === "setup" ? user?.nickname ?? "" : ""} autoComplete="name" placeholder="What should we call you?" required maxLength={40}/></label><label>Username<input name="username" defaultValue={mode === "setup" ? user?.username ?? "" : ""} autoComplete="username" placeholder="e.g. david_money" pattern="[A-Za-z0-9_]{3,30}" title="3–30 letters, numbers or underscores" required minLength={3} maxLength={30}/></label><label>Email<input name="email" type="email" defaultValue={mode === "setup" ? user?.email ?? "" : ""} autoComplete="email" placeholder="you@example.com" required maxLength={254}/></label></> : <label>Username or email<input name="identifier" autoComplete="username" autoCapitalize="none" placeholder="Your username or email" required maxLength={254}/></label>}
  <label>Password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Your password" : "At least 12 characters"} minLength={mode === "login" ? 1 : 12} maxLength={128} required/></label>
  {mode !== "login" && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" placeholder="Enter your password again" minLength={12} maxLength={128} required/></label>}
  {error && <p role="alert" className="error-text">{error}</p>}
  <button className="button black" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : mode === "setup" ? "Save login details" : "Create account"}</button>
  <small className="account-session-note">Stay signed in on this browser for 30 days. Log out on shared devices.</small>
 </form>;
}
