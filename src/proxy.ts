import { auth } from "@/auth";

// Next.js 16 renames middleware → proxy
export const proxy = auth;

export const config = {
  matcher: [
    "/((?!api/auth|auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
