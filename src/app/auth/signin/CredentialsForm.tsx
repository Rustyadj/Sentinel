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
    if (result?.error) {
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
      <div className="flex rounded-2xl border border-[--border] bg-[rgba(255,255,255,0.03)] p-1">
        {(["signin", "register"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(""); }}
            className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors ${
              mode === m
                ? "bg-[rgba(255,255,255,0.05)] text-[--foreground] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                : "text-[--muted-foreground] hover:text-[--foreground]"
            }`}
          >
            {m === "signin" ? "Sign In" : "Register"}
          </button>
        ))}
      </div>

      <form onSubmit={mode === "signin" ? handleSignIn : handleRegister} className="space-y-3">
        {mode === "register" && (
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="name"
            className="w-full h-12 px-4 rounded-2xl border border-[--border] bg-[rgba(255,255,255,0.03)] text-sm text-[--foreground] placeholder:text-[--muted-foreground] outline-none focus:border-[--primary]/60 transition-colors"
          />
        )}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="w-full h-12 px-4 rounded-2xl border border-[--border] bg-[rgba(255,255,255,0.03)] text-sm text-[--foreground] placeholder:text-[--muted-foreground] outline-none focus:border-[--primary]/60 transition-colors"
        />

        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="w-full h-12 px-4 pr-10 rounded-2xl border border-[--border] bg-[rgba(255,255,255,0.03)] text-sm text-[--foreground] placeholder:text-[--muted-foreground] outline-none focus:border-[--primary]/60 transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowPw(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[--muted-foreground] hover:text-[--foreground] transition-colors"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-[--destructive]/20 bg-[--destructive]/10 px-3 py-2.5 text-xs text-[--destructive]">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[--primary] text-sm font-medium text-white shadow-[0_12px_30px_rgba(108,124,255,0.22)] transition-all hover:-translate-y-px hover:bg-[--primary]/92 disabled:opacity-60"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
