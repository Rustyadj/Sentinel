import { signIn } from "@/auth";
import { AuthError } from "next-auth";

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
    <div className="min-h-screen flex items-center justify-center bg-[--background] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-[--primary]/20 border border-[--primary]/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🌸</span>
          </div>
          <h1 className="text-xl font-semibold text-[--foreground] tracking-tight">
            Sentinel OS
          </h1>
          <p className="text-sm text-[--muted-foreground] mt-1">
            Sign in to Mission Control
          </p>
        </div>

        {/* Card */}
        <div className="bg-[--card] border border-[--border] rounded-xl p-6 space-y-3">
          <ErrorBanner searchParams={searchParams} />

          {/* Google */}
          <form
            action={async () => {
              "use server";
              const params = await searchParams;
              try {
                await signIn("google", {
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
              className="w-full flex items-center justify-center gap-3 h-10 px-4 rounded-lg border border-[--border] bg-[--muted] text-sm text-[--foreground] hover:bg-[--accent] hover:border-[--foreground]/20 transition-colors"
            >
              <GoogleIcon />
              Continue with Google
            </button>
          </form>

          {/* GitHub */}
          <form
            action={async () => {
              "use server";
              const params = await searchParams;
              try {
                await signIn("github", {
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
              className="w-full flex items-center justify-center gap-3 h-10 px-4 rounded-lg border border-[--border] bg-[--muted] text-sm text-[--foreground] hover:bg-[--accent] hover:border-[--foreground]/20 transition-colors"
            >
              <GitHubIcon />
              Continue with GitHub
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-[--muted-foreground] mt-6">
          Your API keys are stored only in your browser.
          <br />
          Sentinel OS never stores your AI provider credentials.
        </p>
      </div>
    </div>
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
    Default: "Authentication failed. Please try again.",
  };

  return (
    <div className="px-3 py-2.5 rounded-lg bg-[--destructive]/10 border border-[--destructive]/20 text-xs text-[--destructive] mb-1">
      {messages[error] ?? messages.Default}
    </div>
  );
}
