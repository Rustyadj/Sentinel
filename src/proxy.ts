import { auth } from "@/auth";

// Next.js 16 renames middleware → proxy
export const proxy = auth;

export const config = {
  matcher: [
    "/((?!api/auth|api/health|api/ready|auth|media/|_next/static|_next/image|favicon.ico).*)",
  ],
};
