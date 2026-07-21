"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en"><body className="grid min-h-screen place-items-center bg-[#05080d] p-8 text-white">
      <main className="max-w-md text-center"><h1 className="text-2xl font-semibold">Sentinel OS is temporarily unavailable</h1><p className="mt-3 text-sm text-white/60">The application shell could not recover. No operation was retried automatically.</p><button onClick={reset} className="mt-5 rounded-lg bg-violet-600 px-4 py-2 text-sm">Reload</button></main>
    </body></html>
  );
}
