#!/usr/bin/env node
/**
 * step-rpc.mjs - minimal StepCode RPC client with spec-compliant LF-only framing.
 *
 * Usage:
 *   node step-rpc.mjs "prompt" [--json] [--print-events]
 *   printf '%s\n' '{"type":"get_state"}' | node step-rpc.mjs --stdin
 *
 * Options:
 *   --json             Print a JSON result object
 *   --print-events     Also stream every RPC event as a JSON line to stderr
 *   --cwd <dir>        step -C
 *   --model <pattern>  Model pattern
 *   --name <name>      Session display name
 *   --no-session       Ephemeral session
 *   --timeout <ms>     Overall timeout (default 600000)
 *   --step <path>      Path to the step binary
 *   --stdin            Read newline-delimited RPC commands from stdin instead of a prompt
 *   --auto-confirm     Answer every extension_ui_request with its default value
 *
 * Why not readline: Node's readline also splits on U+2028/U+2029, which are
 * valid inside JSON strings. This client splits on "\n" only.
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const STEP_DEFAULT = process.platform === "win32"
  ? join(homedir(), ".stepcode", "bin", "step.exe")
  : "step";

const argv = process.argv.slice(2);
const opts = {
  json: false, printEvents: false, cwd: null, model: null, name: null,
  noSession: false, timeout: 600000, step: STEP_DEFAULT, stdin: false,
  autoConfirm: false,
};
let prompt = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  switch (a) {
    case "--json": opts.json = true; break;
    case "--print-events": opts.printEvents = true; break;
    case "--cwd": opts.cwd = argv[++i]; break;
    case "--model": opts.model = argv[++i]; break;
    case "--name": opts.name = argv[++i]; break;
    case "--no-session": opts.noSession = true; break;
    case "--timeout": opts.timeout = Number(argv[++i]); break;
    case "--step": opts.step = argv[++i]; break;
    case "--stdin": opts.stdin = true; break;
    case "--auto-confirm": opts.autoConfirm = true; break;
    default: if (prompt === null) prompt = a;
  }
}

const args = ["--mode", "rpc"];
if (opts.cwd) args.push("-C", opts.cwd);
if (opts.model) args.push("--model", opts.model);
if (opts.name) args.push("-n", opts.name);
if (opts.noSession) args.push("--no-session");

const child = spawn(opts.step, args, { stdio: ["pipe", "pipe", "inherit"] });

let nextId = 1;
const pending = new Map();   // id -> {resolve, reject}
const events = [];
let finalText = null;
let failure = null;
let settled = false;
let sessionId = null;
let buffer = "";

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function request(cmd, extra = {}) {
  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ id, type: cmd, ...extra });
  });
}

function handle(line) {
  let evt;
  try { evt = JSON.parse(line); } catch { return; }

  if (evt.type === "response" && evt.id !== undefined && pending.has(evt.id)) {
    const { resolve } = pending.get(evt.id);
    pending.delete(evt.id);
    resolve(evt);
    return;
  }

  if (opts.printEvents) process.stderr.write(line + "\n");
  events.push(evt);

  switch (evt.type) {
    case "message_end":
      if (evt.message && evt.message.role === "assistant") {
        const text = (evt.message.content || [])
          .filter((b) => b.type === "text").map((b) => b.text).join("");
        if (text.trim()) finalText = text;
      }
      break;
    case "agent_settled":
      settled = true;
      if (evt.failure) failure = evt.failure;
      finish();
      break;
    case "extension_ui_request":
      if (opts.autoConfirm) {
        const reply = { type: "extension_ui_response", id: evt.id };
        if (evt.method === "confirm") reply.confirmed = true;
        else reply.cancelled = true;
        send(reply);
      }
      break;
  }
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).replace(/\r$/, "");
    buffer = buffer.slice(idx + 1);
    if (line.trim()) handle(line);
  }
});

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const result = { sessionId, settled, failure, text: finalText, events: events.length };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else if (finalText) console.log(finalText);
  child.kill();
  process.exit(failure ? 1 : 0);
}

const timer = setTimeout(() => {
  console.error(`error: timed out after ${opts.timeout}ms`);
  child.kill();
  process.exit(2);
}, opts.timeout);
timer.unref?.();

child.on("error", (err) => {
  console.error(`error: failed to start ${opts.step}: ${err.message}`);
  process.exit(2);
});

(async () => {
  const state = await request("get_state");
  sessionId = state.data?.sessionId ?? null;

  if (opts.stdin) {
    let inBuf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      inBuf += c;
      let i;
      while ((i = inBuf.indexOf("\n")) >= 0) {
        const line = inBuf.slice(0, i).replace(/\r$/, "");
        inBuf = inBuf.slice(i + 1);
        if (line.trim()) { try { send(JSON.parse(line)); } catch { /* ignore */ } }
      }
    });
    process.stdin.on("end", () => child.stdin.end());
    return;                                   // caller drives the session
  }

  await request("prompt", { message: prompt });
  // Completion is detected from the event stream (agent_settled) in handle().
  // Belt and braces: if the process exits without settling, report it.
  child.on("close", (code) => {
    clearTimeout(timer);
    if (!settled) {
      console.error(`warning: process exited (code ${code}) before agent_settled`);
      if (finalText) { if (opts.json) console.log(JSON.stringify({ sessionId, settled, failure, text: finalText }, null, 2)); else console.log(finalText); }
      process.exit(code ?? 1);
    }
  });
})();
