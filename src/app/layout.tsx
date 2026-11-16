import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { auth } from "@/auth";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";

// Hanken Grotesk carries the interface; Bricolage Grotesque is reserved for
// titles; JetBrains Mono is for ids, times, models and telemetry only.
const ui = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-ui", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600"], variable: "--font-display-face", display: "swap" });
const code = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-code", display: "swap" });

export const metadata: Metadata = {
  title: "Sentinel OS",
  description: "Where people and agents work together, with a live view of what every agent is doing",
};

export const viewport: Viewport = {
  themeColor: "#e6e9e5",
  colorScheme: "light",
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
