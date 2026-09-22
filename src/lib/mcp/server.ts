/**
 * MCP JSON-RPC dispatch, transport-agnostic.
 *
 * The route handler owns HTTP (auth header, status codes, 202 for
 * notifications); this owns the protocol. Keeping them apart is what lets the
 * smoke test drive initialize -> tools/list -> tools/call as plain objects.
 *
 * Note the asymmetry MCP requires: a malformed request is a JSON-RPC *error*,
 * but a tool that throws is a JSON-RPC *result* with isError: true, so the
 * model sees the failure and can correct itself instead of the client
 * swallowing it as a transport fault.
 */
import { JSON_RPC, RpcError } from "./errors";
import { MCP_TOOLS, callTool, findTool, toolsVisibleTo, type ToolContext } from "./tools";

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = { name: "sentinel-mcp-gateway", version: "1.1.0" };

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function rpcErrorResponse(id: string | number | null, error: unknown): JsonRpcResponse {
  if (error instanceof RpcError) {
    return { jsonrpc: "2.0", id, error: { code: error.code, message: error.message, data: error.data } };
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: JSON_RPC.internalError, message: error instanceof Error ? error.message : "Internal error" },
  };
}

export function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined || message.id === null;
}

/** Serializes a tool's return value into MCP content blocks. */
function toolResult(value: unknown) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: typeof value === "object" && value !== null ? value : { value },
    isError: false,
  };
}

function toolFailure(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}

export async function handleRpc(message: JsonRpcRequest, ctx: ToolContext): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    throw new RpcError(JSON_RPC.invalidRequest, "Malformed JSON-RPC request.");
  }

  switch (message.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        // Only tools. No resources, prompts or sampling are exposed to
        // external connectors — declaring them would invite calls this
        // gateway has no authorization model for.
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "All data is restricted to the workspace selected during OAuth consent. Use search then fetch for broad retrieval; use sentinel_workspace_overview and sentinel_list_content for structured browsing. Confirm with the user before calling write tools.",
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // Notifications get no response body.

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: toolsVisibleTo(ctx.principal).map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        })),
      });

    case "tools/call": {
      const params = message.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const tool = findTool(name);
      if (!tool) {
        // Unknown name is a protocol-level error: there is nothing for the
        // model to retry against.
        throw new RpcError(JSON_RPC.invalidParams, `Unknown tool "${name}".`, {
          available: MCP_TOOLS.map((entry) => entry.name),
        });
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok(id, toolResult(await callTool(tool, args, ctx)));
      } catch (error) {
        return ok(id, toolFailure(error instanceof Error ? error.message : "Tool call failed."));
      }
    }

    default:
      throw new RpcError(JSON_RPC.methodNotFound, `Unsupported method "${message.method}".`);
  }
}

/** Handles one request or a JSON-RPC batch; null means "nothing to send back". */
export async function handleMessage(
  payload: unknown,
  ctx: ToolContext,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    const responses: JsonRpcResponse[] = [];
    for (const entry of payload) {
      const message = entry as JsonRpcRequest;
      try {
        const response = await handleRpc(message, ctx);
        if (response) responses.push(response);
      } catch (error) {
        responses.push(rpcErrorResponse(message?.id ?? null, error));
      }
    }
    return responses.length > 0 ? responses : null;
  }

  const message = payload as JsonRpcRequest;
  try {
    return await handleRpc(message, ctx);
  } catch (error) {
    if (isNotification(message)) return null;
    return rpcErrorResponse(message?.id ?? null, error);
  }
}
