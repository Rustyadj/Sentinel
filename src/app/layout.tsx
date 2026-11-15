import type { Metadata, Viewport } from "next";
import { Familjen_Grotesk, Martian_Mono, Onest } from "next/font/google";
import "./globals.css";
import { auth } from "@/auth";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";

// Onest carries the interface; Familjen Grotesk is reserved for titles, where
// its narrow, slightly eccentric forms give Sentinel a voice; Martian Mono is
// for ids, models and telemetry only.
const ui = Onest({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const display = Familjen_Grotesk({ subsets: ["latin"], variable: "--font-display-face", display: "swap" });
const code = Martian_Mono({ subsets: ["latin"], variable: "--font-code", display: "swap" });

export const metadata: Metadata = {
  title: "Sentinel OS",
  description: "Where people and agents work together, with a live view of what every agent is doing",
};

export const viewport: Viewport = {
  themeColor: "#0d1226",
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
