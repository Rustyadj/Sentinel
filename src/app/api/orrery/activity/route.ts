import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getOrreryActivity } from "@/lib/orrery/activity";

export const dynamic = "force-dynamic";

/** Real agent activity for the Orrery. `since` is the cursor from the last poll. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const sinceParam = request.nextUrl.searchParams.get("since");
    const parsed = sinceParam ? new Date(sinceParam) : undefined;
    const since = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
    return NextResponse.json(await getOrreryActivity(user.id, since));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Activity query failed";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
