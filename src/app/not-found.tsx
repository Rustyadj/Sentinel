import Link from "next/link";

export default function NotFound() {
  return <main className="grid h-full place-items-center bg-[#05080d] p-8 text-white"><section className="text-center"><p className="text-sm text-violet-300">404</p><h1 className="mt-2 text-2xl font-semibold">Module not found</h1><p className="mt-2 text-sm text-white/60">This route is not registered in Sentinel OS.</p><Link href="/" className="mt-5 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm">Return to Mission Control</Link></section></main>;
}
