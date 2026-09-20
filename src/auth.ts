import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { normalizeEmailOrNull } from "@/lib/auth/email";
import { findCredentialIdentity, findEmailIdentities } from "@/lib/auth/identity";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await findCredentialIdentity(credentials.email as string);

        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!valid) return null;

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
