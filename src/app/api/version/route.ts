export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    commit: process.env.SENTINEL_COMMIT ?? process.env.SENTINEL_RELEASE_SHA ?? "unknown",
    builtAt: process.env.SENTINEL_BUILT_AT ?? "unknown",
    environment: process.env.NODE_ENV ?? "unknown",
  });
}
