import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { normalizeEmail, normalizeEmailOrNull } from "@/lib/auth/email";

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

        const user = await db.user.findUnique({
          // Normalized so a user who typed a capital letter at signup can
          // still sign in, and so this matches the stored canonical address.
          where: { email: normalizeEmail(credentials.email as string) },
        });

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
      if (!token.sub && (user?.email || token.email)) {
        // This upsert is what created the duplicate identity: a social
        // provider returns the canonical lowercase address, which did not
        // match an account registered with different casing, so it created a
        // second user instead of finding the first.
        const email = normalizeEmailOrNull(user?.email ?? token.email);
        if (email) {
          const dbUser = await db.user.upsert({
            where: { email },
            update: { name: user?.name ?? token.name ?? undefined },
            create: { email, name: user?.name ?? token.name ?? undefined },
          });
          token.sub = dbUser.id;
        }
      }
      return token;
    },
  },
  session: { strategy: "jwt" },
});
