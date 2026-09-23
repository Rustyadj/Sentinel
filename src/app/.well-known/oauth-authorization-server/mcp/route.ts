// Compatibility alias for clients that derive the metadata URL from the last
// segment of /api/mcp rather than the full path. Mirrors the equivalent alias
// on the protected-resource document.
//
// `dynamic` is declared here rather than re-exported: Next parses route
// segment config statically and rejects a re-export of it.
export { GET } from "../api/mcp/route";

export const dynamic = "force-dynamic";
