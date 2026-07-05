import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { Suspense } from "react";
import { Shield, Sparkles, LockKeyhole, Cpu } from "lucide-react";
import { CredentialsForm } from "./CredentialsForm";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[--background]">
      <div className="absolute inset-0 bg-grid opacity-25" />
      <div className="absolute left-[-10%] top-[-16%] h-[28rem] w-[28rem] rounded-full bg-[rgba(108,124,255,0.18)] blur-3xl" />
      <div className="absolute bottom-[-18%] right-[-12%] h-[24rem] w-[24rem] rounded-full bg-[rgba(16,185,129,0.10)] blur-3xl" />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="surface-panel surface-glow hidden rounded-[30px] p-10 lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(108,124,255,0.24)] bg-[linear-gradient(180deg,rgba(108,124,255,0.22),rgba(108,124,255,0.10))]">
                <Shield className="h-6 w-6 text-[--primary]" />
              </div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[rgba(108,124,255,0.18)] bg-[rgba(108,124,255,0.08)] px-3 py-1 text-[11px] font-medium text-[--primary]">
                <Sparkles className="h-3.5 w-3.5" />
                Secure operator access
              </div>
              <h1 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight text-[--foreground]">
                Sentinel OS
              </h1>
              <p className="mt-4 max-w-md text-sm leading-6 text-[--muted-foreground]">
                Mission control for agents, memory, and workflows. Authenticate once and return to the shell with full context intact.
              </p>
            </div>

            <div className="grid gap-3">
              <SignalRow icon={LockKeyhole} title="Credential-safe by default" text="Provider keys stay in the browser, not the server." />
              <SignalRow icon={Cpu} title="Built for operators" text="Low-noise shell, fast module switching, deliberate control surfaces." />
            </div>
          </section>

          <section className="surface-panel surface-glow rounded-[28px] p-6 sm:p-8 lg:p-9">
            <div className="mb-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[rgba(108,124,255,0.24)] bg-[linear-gradient(180deg,rgba(108,124,255,0.22),rgba(108,124,255,0.10))] lg:hidden">
                <Shield className="h-5 w-5 text-[--primary]" />
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[--muted-foreground]">
                Sentinel OS
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[--foreground]">
                Sign in to Mission Control
              </h2>
              <p className="mt-2 text-sm leading-6 text-[--muted-foreground]">
                Use credentials or single sign-on to enter the control plane.
              </p>
            </div>

            <ErrorBanner searchParams={searchParams} />

            <Suspense>
              <CredentialsForm />
            </Suspense>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-[--border]" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-[--muted-foreground]">
                Continue with
              </span>
              <div className="h-px flex-1 bg-[--border]" />
            </div>

            <div className="space-y-3">
              <OAuthButton provider="google" searchParams={searchParams}>
                <GoogleIcon />
                Continue with Google
              </OAuthButton>
              <OAuthButton provider="github" searchParams={searchParams}>
                <GitHubIcon />
                Continue with GitHub
              </OAuthButton>
            </div>

            <p className="mt-6 text-center text-[11px] leading-5 text-[--muted-foreground]">
              Your API keys stay in your browser only.
              <br />
              Sentinel OS does not persist provider credentials server-side.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function SignalRow({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Shield;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(108,124,255,0.10)] text-[--primary]">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-medium text-[--foreground]">{title}</div>
          <div className="text-[12px] leading-5 text-[--muted-foreground]">{text}</div>
        </div>
      </div>
    </div>
  );
}

function OAuthButton({
  provider,
  searchParams,
  children,
}: {
  provider: "google" | "github";
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
  children: React.ReactNode;
}) {
  return (
    <form
      action={async () => {
        "use server";
        const params = await searchParams;
        try {
          await signIn(provider, {
            redirectTo: params.callbackUrl ?? "/dashboard",
          });
        } catch (e) {
          if (e instanceof AuthError) throw e;
          throw e;
        }
      }}
    >
      <button
        type="submit"
        className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-[--border] bg-[rgba(255,255,255,0.02)] px-4 text-sm font-medium text-[--foreground] transition-colors hover:border-[--ring]/30 hover:bg-[--accent]"
      >
        {children}
      </button>
    </form>
  );
}

async function ErrorBanner({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (!error) return null;

  const messages: Record<string, string> = {
    Configuration:
      "OAuth provider not configured. Set GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID in .env.local.",
    AccessDenied: "Access denied. Contact your administrator.",
    CredentialsSignin: "Invalid email or password.",
    Default: "Authentication failed. Please try again.",
  };

  return (
    <div className="mb-4 rounded-2xl border border-[--destructive]/20 bg-[--destructive]/10 px-3 py-2.5 text-xs text-[--destructive]">
      {messages[error] ?? messages.Default}
    </div>
  );
}
