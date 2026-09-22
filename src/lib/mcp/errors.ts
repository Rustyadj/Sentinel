/**
 * Two error vocabularies meet in this gateway and they are not the same.
 *
 * OAuth endpoints answer with RFC 6749 error codes in a JSON body and an HTTP
 * status. The MCP endpoint answers with JSON-RPC 2.0 error objects, where
 * transport-level failures (bad JSON, unknown method) are JSON-RPC errors but
 * a tool that fails is a *successful* JSON-RPC result carrying isError — an
 * MCP requirement, so the model can see and react to the failure rather than
 * the client swallowing it.
 */
export class OAuthError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "invalid_client"
      | "invalid_grant"
      | "invalid_scope"
      | "unauthorized_client"
      | "unsupported_grant_type"
      | "access_denied"
      | "server_error",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export function oauthErrorResponse(error: unknown): Response {
  if (error instanceof OAuthError) {
    return Response.json({ error: error.code, error_description: error.message }, { status: error.status });
  }
  return Response.json({ error: "server_error", error_description: "Unexpected gateway error." }, { status: 500 });
}

/** JSON-RPC 2.0 reserved codes, plus the MCP convention for auth failures. */
export const JSON_RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = "RpcError";
  }
}

/** A tool refusing for lack of scope — surfaced to the model, not the transport. */
export class ToolScopeError extends Error {
  constructor(readonly requiredScope: string) {
    super(`This connector was not granted "${requiredScope}". Re-authorize it in Sentinel to enable this tool.`);
    this.name = "ToolScopeError";
  }
}
