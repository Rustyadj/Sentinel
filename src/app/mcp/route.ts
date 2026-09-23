/**
 * /mcp — the conventional mount point for an MCP server, aliasing /api/mcp.
 *
 * Clients are routinely configured with the bare /mcp form, and until this
 * existed that URL fell through to the page session gate and answered POST
 * with a 307 to an HTML sign-in form. A connector cannot discover OAuth from
 * a redirect to a login page, so it gave up without ever registering and
 * without leaving anything in a log to explain itself.
 *
 * Same handlers, so the two paths cannot drift. The canonical resource
 * identifier stays https://<host>/api/mcp — that is what the protected
 * resource metadata advertises and what access tokens carry as `aud`, and a
 * client arriving here is pointed at that document by the 401 exactly as it
 * would be at /api/mcp.
 */
export { POST, GET, DELETE } from "../api/mcp/route";

export const dynamic = "force-dynamic";
