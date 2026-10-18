import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { auth } from "@/auth";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";

// Hanken Grotesk carries the interface; Bricolage Grotesque is reserved for
// titles, where its ink traps give Sentinel a voice; JetBrains Mono is for
// ids, models and telemetry only.
const ui = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display-face", display: "swap" });
const code = JetBrains_Mono({ subsets: ["latin"], variable: "--font-code", display: "swap" });

export const metadata: Metadata = {
  title: "Sentinel OS",
  description: "Agent workspace with a live knowledge graph",
};

export const viewport: Viewport = {
  themeColor: "#0e1416",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  return (
    <html lang="en" className={`h-full ${ui.variable} ${display.variable} ${code.variable}`}>
      <body className="h-full overflow-hidden">
        <SessionProvider session={session}><ToastProvider>{children}</ToastProvider></SessionProvider>
      </body>
    </html>
  );
}
