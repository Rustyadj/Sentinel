import { requireUser } from "@/lib/current-user";
export async function GET() {
  await requireUser();
  return Response.json({ error: "Contradiction review is unavailable until legacy contradiction rows carry tenant scope." }, { status: 503 });
}
