"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { SentinelLogo } from "@/components/branding/SentinelLogo";
import { Field, Notice, PrimaryButton, QuietButton, fieldClass, formatDate, readError } from "@/components/people/ui";
import { ROLE_COPY } from "@/lib/people/roles";

interface Offer {
  scope: "organization" | "project"; role: string; target: string; invitedBy: string; note: string | null; email: string | null; expiresAt: string;
}

/**
 * Where an invitation link lands. Someone already signed in accepts with one
 * click; someone new makes their account here, and the invitation is what
 * admits them.
 */
export function InviteAccept({ token }: { token: string }) {
  const { data: session, status } = useSession();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [dead, setDead] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/auth/invitation?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) { setDead(await readError(res, "This invitation link is not valid.")); return; }
        const next = (await res.json()) as Offer;
        setOffer(next);
        if (next.email) setEmail(next.email);
      })
      .catch(() => { if (live) setDead("Sentinel could not be reached. Check your connection and open the link again."); });
    return () => { live = false; };
  }, [token]);

  const destination = (scope: Offer["scope"], projectId?: string | null) => (scope === "project" && projectId ? `/projects/${projectId}` : scope === "project" ? "/projects" : "/chat");

  async function acceptAsMe() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (!res.ok) throw new Error(await readError(res, "The invitation could not be accepted."));
      const result = (await res.json()) as { scope: Offer["scope"]; projectId: string | null };
      // A full load, so the session picks up what the invitation just granted.
      window.location.assign(destination(result.scope, result.projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The invitation could not be accepted.");
      setBusy(false);
    }
  }

  async function createAccount() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, inviteToken: token }),
      });
      if (!res.ok) throw new Error(await readError(res, "The account was not created."));
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) throw new Error("Your account was created. Sign in with it to continue.");
      window.location.assign(destination(offer?.scope ?? "organization"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The account was not created.");
      setBusy(false);
    }
  }

  const role = offer ? ROLE_COPY[offer.role as keyof typeof ROLE_COPY] : null;
  const signedInEmail = session?.user?.email ?? null;

  return (
    <div className="watch-ground min-h-screen overflow-y-auto text-(--foreground)">
      <div className="mx-auto flex min-h-screen w-full max-w-[460px] flex-col justify-center px-4 py-10">
        <SentinelLogo className="mb-8" />
        <main className="rounded-(--radius-lg) border border-(--border) bg-(--panel) p-6 shadow-(--shadow-lg) sm:p-8">
          {dead ? (
            <>
              <h1 className="font-display text-[26px] font-semibold tracking-tight">This link can&apos;t be used</h1>
              <p className="mt-2 text-[14.5px] leading-relaxed text-(--muted-foreground)">{dead}</p>
              <p className="mt-6 text-[14px]"><Link href="/auth/signin" className="text-(--primary-soft) underline underline-offset-2">Sign in to Sentinel</Link></p>
            </>
          ) : !offer || status === "loading" ? (
            <div className="space-y-3" aria-label="Loading the invitation">{[70, 90, 55].map((w) => <div key={w} className="h-4 animate-pulse rounded-full bg-(--muted) motion-reduce:animate-none" style={{ width: `${w}%` }} />)}</div>
          ) : (
            <>
              <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-tight">
                {offer.invitedBy} invited you to {offer.scope === "project" ? offer.target : `join ${offer.target}`}
              </h1>
              <dl className="mt-5 space-y-3 rounded-(--radius-md) border border-(--border) bg-(--background) p-4 text-[13.5px]">
                <div>
                  <dt className="text-(--muted-foreground)">You would be {offer.role === "admin" || offer.role === "editor" || offer.role === "operator" ? "an" : "a"} {role?.label.toLowerCase() ?? offer.role}</dt>
                  <dd className="mt-0.5 leading-snug">{role?.grants}</dd>
                </div>
                <div className="text-(--muted-foreground)">This invitation is good until {formatDate(offer.expiresAt)}.</div>
              </dl>

              {error ? <div className="mt-5"><Notice>{error}</Notice></div> : null}

              {signedInEmail ? (
                <div className="mt-6 space-y-3">
                  <PrimaryButton className="w-full" disabled={busy} onClick={() => void acceptAsMe()}>
                    {busy ? "Accepting…" : `Accept as ${signedInEmail}`}
                  </PrimaryButton>
                  <QuietButton className="w-full" onClick={() => void signOut({ callbackUrl: `/auth/invite/${token}` })}>Use a different account</QuietButton>
                </div>
              ) : (
                <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void createAccount(); }}>
                  <Field label="Your name">
                    <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={120} className={fieldClass} />
                  </Field>
                  <Field label="Email" hint={offer.email ? "This invitation was issued to this address." : undefined}>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={Boolean(offer.email)} autoComplete="email" required className={fieldClass} />
                  </Field>
                  <Field label="Choose a password" hint="At least 8 characters.">
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required className={fieldClass} />
                  </Field>
                  <PrimaryButton type="submit" className="w-full" disabled={busy}>{busy ? "Creating your account…" : "Create account and accept"}</PrimaryButton>
                  <p className="text-center text-[13px] text-(--muted-foreground)">
                    Already have an account?{" "}
                    <Link href={`/auth/signin?callbackUrl=${encodeURIComponent(`/auth/invite/${token}`)}`} className="text-(--primary-soft) underline underline-offset-2">Sign in, then accept</Link>
                  </p>
                </form>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
