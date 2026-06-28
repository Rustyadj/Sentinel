import type { Metadata } from "next";
import "./globals.css";
import { auth } from "@/auth";
import { SessionProvider } from "@/components/auth/SessionProvider";

export const metadata: Metadata = {
  title: "Sentinel OS · Mission Control",
  description: "AI-powered mission control platform",
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
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
