// A stand-in for a Hermes dashboard, for browser verification of a release candidate without spending
// model credits or touching a real agent. It speaks the exact protocol src/lib/agents/runtime/hermes.ts
// speaks (ws-ticket, /api/ws JSON-RPC, gateway.ready, session.create / prompt.submit / session.interrupt,
// message.* / tool.* events), so everything on the Sentinel side of the wire is the real code.
//
// What it does is steered by markers in the prompt, so a test decides the scenario:
//   (none)         streams a short reply, then completes
//   [tool:NAME]    announces a call to the tool NAME (and its completion) before replying
//   [slow]         keeps streaming every 300ms (up to a minute) until interrupted
//   [stubborn]     refuses session.interrupt (the runtime "cannot confirm it stopped") until POST /__unstick
//   [fail]         ends the turn with an error event
// GET /__calls returns what the fake saw (prompts, tools, interrupts), so a test can prove what ran.
import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 4900);
const calls = { prompts: [], tools: [], interrupts: [], sessions: 0, refusedInterrupts: 0 };
const sessions = new Map(); // id -> { interrupted, stubborn }

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/api/auth/ws-ticket")) {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ticket: "fake-ticket" }));
  } else if (req.url === "/__calls") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(calls));
  } else if (req.url === "/__unstick" && req.method === "POST") {
    // The runtime recovers: sessions that refused to be interrupted will now accept it.
    for (const session of sessions.values()) session.stubborn = false;
    res.writeHead(204).end();
  } else if (req.url === "/__reset" && req.method === "POST") {
    calls.prompts = []; calls.tools = []; calls.interrupts = []; calls.refusedInterrupts = 0;
    res.writeHead(204).end();
  } else {
    res.writeHead(200, { "content-type": "text/plain" }).end("fake hermes dashboard");
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/api/ws")) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

wss.on("connection", (ws) => {
  const send = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
  const event = (type, session_id, payload = {}) => send({ jsonrpc: "2.0", method: "event", params: { type, session_id, payload } });
  send({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", session_id: "", payload: {} } });

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());
    const reply = (result) => send({ jsonrpc: "2.0", id: msg.id, result });
    const fail = (code, message) => send({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
    const p = msg.params ?? {};
    switch (msg.method) {
      case "config.get": return reply({ config: {} });
      case "session.create": {
        const id = `fh-${++calls.sessions}`;
        sessions.set(id, { interrupted: false, stubborn: false });
        return reply({ session_id: id, info: { model: p.model ?? "fake-model", provider: "fake" } });
      }
      case "session.resume": return reply({});
      case "session.interrupt": {
        const s = sessions.get(p.session_id);
        calls.interrupts.push(p.session_id);
        if (s?.stubborn) { calls.refusedInterrupts += 1; return fail(5000, "runtime cannot interrupt this session"); }
        if (s) s.interrupted = true;
        return reply({});
      }
      case "prompt.submit": {
        const s = sessions.get(p.session_id);
        if (!s) return fail(4001, "session not found");
        const full = String(p.text ?? "");
        calls.prompts.push(full);
        // A bot's prompt ends with its task; memory injected earlier in the prompt can quote old tasks, markers included.
        const text = full.trimEnd().split("\n").pop() ?? "";
        s.stubborn = text.includes("[stubborn]");
        s.interrupted = false;
        reply({ status: "streaming" });
        const sid = p.session_id;
        event("message.start", sid, { model: p.model ?? "fake-model", provider: "fake" });
        for (const m of text.matchAll(/\[tool:([A-Za-z0-9_.-]+)\]/g)) {
          await sleep(120);
          if (s.interrupted) return;
          calls.tools.push(m[1]);
          event("tool.start", sid, { name: m[1], tool_id: `call_${m[1]}` });
          await sleep(120);
          event("tool.complete", sid, { name: m[1], args: { path: "/x" }, result: { ok: true } });
        }
        if (text.includes("[fail]")) { await sleep(100); return event("error", sid, { message: "scripted failure" }); }
        const words = text.includes("[slow]") ? Array.from({ length: 200 }, (_, i) => `tick${i} `) : ["Fake ", "Hermes ", "reply: ", text.replace(/\[[^\]]*\]/g, "").trim().slice(0, 240) || "ok", "."];
        for (const w of words) {
          if (s.interrupted) return;
          await sleep(text.includes("[slow]") ? 300 : 150);
          event("message.delta", sid, { text: w });
        }
        if (!s.interrupted) event("message.complete", sid, { text: words.join(""), usage: { input: 21, output: 8, total: 29, model: "fake-model" } });
        return;
      }
      default: return fail(-32601, `unknown method ${msg.method}`);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`fake hermes on :${PORT}`));
