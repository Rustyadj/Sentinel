import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { Suspense } from "react";
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

/**
 * The product's mark, drawn rather than described: four strata — agents,
 * projects, tasks, memory — with the brass context line dropping through
 * them. Static, decorative, hidden from assistive tech.
 */
function StrataMark() {
  const planes = [
    { y: 40, color: "var(--entity-agent)" },
    { y: 104, color: "var(--entity-project)" },
    { y: 168, color: "var(--entity-task)" },
    { y: 232, color: "var(--entity-memory)" },
  ];
  const dots = [[-70, -8], [10, 14], [64, -18], [-24, 22], [92, 10], [-96, 6]];
  return (
    <svg viewBox="-200 0 400 300" aria-hidden className="h-auto w-full max-w-[420px]">
      {planes.slice().reverse().map((p, k) => (
        <g key={p.y}>
          <path
            d={`M -170 ${p.y} L 0 ${p.y - 34} L 170 ${p.y} L 0 ${p.y + 34} Z`}
            fill={p.color}
            fillOpacity={0.045}
            stroke={p.color}
            strokeOpacity={0.4}
            strokeWidth={1}
          />
          {dots.map(([dx, dy], i) => (
            <circle key={i} cx={dx * (0.8 + ((k + i) % 3) * 0.1)} cy={p.y + dy * 0.8} r={k === 3 ? 3.2 : 2.2} fill={p.color} fillOpacity={0.85} />
          ))}
        </g>
      ))}
      <line x1={10} y1={40 + 11} x2={10} y2={232 + 22} stroke="var(--primary)" strokeWidth={1.2} strokeDasharray="3 5" />
      {[104, 168, 232].map((y) => (
        <ellipse key={y} cx={10} cy={y + 11} rx={11} ry={3.6} fill="none" stroke="var(--primary)" strokeOpacity={0.6} />
      ))}
      <circle cx={10} cy={51} r={4.5} fill="var(--primary)" />
    </svg>
  );
}

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  return (
    <div className="sentinel-app-shell strata-ground relative min-h-screen overflow-y-auto text-(--foreground)">
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-10 px-4 py-10 sm:px-6 lg:flex-row lg:gap-16">
        <section className="hidden flex-1 flex-col lg:flex">
          <StrataMark />
          <h1 className="mt-8 font-display text-[44px] font-semibold leading-none tracking-tight">Sentinel</h1>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-(--muted-foreground)">
            Agents, the projects they serve, the work in flight, and everything they remember — in one operating picture.
          </p>
        </section>

        <section className="w-full max-w-[400px] rounded-lg border border-(--border) bg-(--panel) p-6 shadow-[var(--shadow-lg)] sm:p-8">
          <div className="mb-6">
            <div className="mb-5 flex items-center gap-2.5 lg:hidden">
              <span className="font-display text-[22px] font-semibold tracking-tight">Sentinel</span>
            </div>
            <h2 className="font-display text-[24px] font-semibold tracking-tight text-(--foreground)">
              Sign in
            </h2>
            <p className="mt-1.5 text-[14px] leading-6 text-(--muted-foreground)">
              Use your Sentinel account or single sign-on.
            </p>
          </div>

          <ErrorBanner searchParams={searchParams} />

          <Suspense>
            <CredentialsForm />
          </Suspense>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-(--border)" />
            <span className="text-[12px] text-(--text-faint)">or</span>
            <div className="h-px flex-1 bg-(--border)" />
          </div>

          <div className="space-y-2.5">
            <OAuthButton provider="google" searchParams={searchParams}>
              <GoogleIcon />
              Continue with Google
            </OAuthButton>
            <OAuthButton provider="github" searchParams={searchParams}>
              <GitHubIcon />
              Continue with GitHub
            </OAuthButton>
          </div>

          <p className="mt-6 text-center text-[12px] leading-5 text-(--text-faint)">
            Your API keys stay in your browser only. Sentinel OS does not persist provider credentials server-side.
          </p>
        </section>
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
        className="flex h-11 w-full items-center justify-center gap-3 rounded-md border border-(--border-strong) bg-transparent px-4 text-[14px] font-medium text-(--foreground) transition-colors hover:bg-(--muted) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
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
    <div role="alert" className="mb-4 rounded-md border border-(--destructive)/30 bg-(--destructive)/10 px-3 py-2.5 text-[13px] text-(--destructive)">
      {messages[error] ?? messages.Default}
    </div>
  );
}
