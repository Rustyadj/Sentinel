import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    throw new Error("Unauthorized");
  }

  const userById = await db.user.findUnique({
    where: { id: session.user.id },
  });
  if (userById?.email === session.user.email) return userById;

  return db.user.upsert({
    where: { email: session.user.email },
    update: { name: session.user.name ?? undefined },
    create: { email: session.user.email, name: session.user.name ?? undefined },
  });
}
