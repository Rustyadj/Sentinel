import type { Metadata } from "next";
import "./globals.css";
import { auth } from "@/auth";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";

export const metadata: Metadata = {
  title: "Sentinel OS",
  description: "Agent workspace with a live knowledge graph",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden">
        <SessionProvider session={session}><ToastProvider>{children}</ToastProvider></SessionProvider>
      </body>
    </html>
  );
}
