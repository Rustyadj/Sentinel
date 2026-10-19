"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export function CredentialsForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (result?.code === "rate_limited") {
      setError("Too many sign-in attempts. Try again in a few minutes.");
    } else if (result?.error) {
      setError("Invalid email or password.");
    } else {
      router.push(callbackUrl);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      setError(data.error ?? "Registration failed.");
      setLoading(false);
      return;
    }
    // Auto sign-in after registration
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setError("Registered but sign-in failed. Try signing in manually.");
    } else {
      router.push(callbackUrl);
    }
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div role="tablist" aria-label="Account" className="flex gap-1 border-b border-(--border)">
        {(["signin", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setError(""); }}
            className={`relative -mb-px px-1 pb-2.5 pt-1 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${
              mode === m
                ? "border-b-2 border-(--primary) text-(--foreground)"
                : "border-b-2 border-transparent text-(--muted-foreground) hover:text-(--foreground)"
            } ${m === "register" ? "ml-4" : ""}`}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={mode === "signin" ? handleSignIn : handleRegister} className="space-y-3">
        {mode === "register" && (
          <label className="block space-y-1.5">
          <span className="text-[13px] font-medium text-(--muted-foreground)">Name</span>
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="name"
            className="w-full h-11 px-3.5 rounded-md border border-(--border-strong) bg-(--canvas) text-[15px] text-(--foreground) placeholder:text-(--text-faint) outline-none transition-colors hover:border-[#41575c] focus:border-(--primary) focus:ring-2 focus:ring-(--primary)/25"
          />
          </label>
        )}

        <label className="block space-y-1.5">
        <span className="text-[13px] font-medium text-(--muted-foreground)">Email</span>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="w-full h-11 px-3.5 rounded-md border border-(--border-strong) bg-(--canvas) text-[15px] text-(--foreground) placeholder:text-(--text-faint) outline-none transition-colors hover:border-[#41575c] focus:border-(--primary) focus:ring-2 focus:ring-(--primary)/25"
        />
        </label>

        <div className="space-y-1.5">
        <label htmlFor="signin-password" className="block text-[13px] font-medium text-(--muted-foreground)">Password</label>
        <div className="relative">
          <input
            id="signin-password"
            type={showPw ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="w-full h-11 pl-3.5 pr-11 rounded-md border border-(--border-strong) bg-(--canvas) text-[15px] text-(--foreground) placeholder:text-(--text-faint) outline-none transition-colors hover:border-[#41575c] focus:border-(--primary) focus:ring-2 focus:ring-(--primary)/25"
          />
          <button
            type="button"
            onClick={() => setShowPw(v => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-(--muted-foreground) transition-colors hover:text-(--foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-(--destructive)/30 bg-(--destructive)/10 px-3 py-2.5 text-[13px] text-(--destructive)">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="!mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-(--primary) text-[15px] font-semibold text-(--primary-foreground) transition-colors hover:bg-(--primary-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--panel) disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
