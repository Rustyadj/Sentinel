import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { normalizeEmailOrNull } from "@/lib/auth/email";
import { findCredentialIdentity, findEmailIdentities } from "@/lib/auth/identity";
import { isSignInThrottled, recordSignInFailure } from "@/lib/auth/rate-limit";
import { isSignupAllowed } from "@/lib/auth/signup-policy";

/** Surfaces to the sign-in form as `result.code === "rate_limited"`. */
class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (typeof credentials?.email !== "string" || typeof credentials?.password !== "string") return null;

        if (await isSignInThrottled(credentials.email, request.headers)) throw new RateLimitedSignin();

        const user = await findCredentialIdentity(credentials.email);
        const valid = Boolean(user?.passwordHash) && await bcrypt.compare(credentials.password, user!.passwordHash!);
        if (!user || !valid) {
          await recordSignInFailure(credentials.email, request.headers);
          return null;
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin",
  },
  callbacks: {
    // A first OAuth sign-in creates an account (see jwt below), so it is
    // subject to the same signup policy as credentials registration. Existing
    // accounts are unaffected; credentials sign-in already requires one.
    async signIn({ account, user }) {
      if (!account || account.provider === "credentials") return true;
      const email = normalizeEmailOrNull(user?.email);
      if (!email) return false;
      if ((await findEmailIdentities(email)).length > 0) return true;
      return isSignupAllowed(email);
    },
    authorized({ auth: session }) {
      return !!session;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
    async jwt({ token, account, user }) {
      if (account) token.provider = account.provider;
      if ((account?.provider !== "credentials" || !token.sub) && (user?.email || token.email)) {
        const email = normalizeEmailOrNull(user?.email ?? token.email);
        if (email) {
          const candidates = await findEmailIdentities(email);
          if (candidates.length > 1) {
            // Choosing either row would mint sessions and MCP grants for an
            // arbitrary authority boundary. An operator must reconcile it.
            throw new Error("Account identity requires administrator reconciliation.");
          }
          const dbUser = candidates[0] ?? await db.user.create({
            data: { email, name: user?.name ?? token.name ?? undefined },
          });
          if (candidates[0] && (user?.name ?? token.name)) {
            await db.user.update({ where: { id: dbUser.id }, data: { name: user?.name ?? token.name ?? undefined } });
          }
          token.sub = dbUser.id;
        }
      }
      return token;
    },
  },
  session: { strategy: "jwt" },
});
