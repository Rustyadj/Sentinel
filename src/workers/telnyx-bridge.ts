import { startBridgeServer } from "@/lib/telephony/bridge/server";

const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey) throw new Error("OPENAI_API_KEY is required for the Telnyx media bridge.");

const port = Number(process.env.TELNYX_BRIDGE_PORT ?? "4870");
startBridgeServer({ port, openaiApiKey });
console.info(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "telephony.bridge_listening", port }));
