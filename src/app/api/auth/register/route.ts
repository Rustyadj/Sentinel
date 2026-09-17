import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { normalizeEmail } from "@/lib/auth/email";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const body = await req.json() as { email?: string; password?: string; name?: string };

  if (!body.email || !body.password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  if (body.password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  // Stored canonically so the account can be found again regardless of how
  // the address is typed, here or by a social provider.
  const email = normalizeEmail(body.email);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(body.password, 12);

  const user = await db.user.create({
    data: {
      email,
      name: body.name ?? email.split("@")[0],
      passwordHash,
    },
    select: { id: true, email: true, name: true },
  });

  return NextResponse.json(user, { status: 201 });
}
