"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="grid h-full place-items-center bg-[#05080d] p-8 text-white">
      <section className="max-w-md rounded-2xl border border-red-400/20 bg-red-400/5 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-red-300">Module unavailable</p>
        <h1 className="mt-2 text-xl font-semibold">Sentinel hit an operational error.</h1>
        <p className="mt-2 text-sm text-white/60">Your data was not changed. Retry the module or check service readiness.</p>
        <button onClick={reset} className="mt-5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500">Retry</button>
      </section>
    </main>
  );
}
