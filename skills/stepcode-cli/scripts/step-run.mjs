#!/usr/bin/env node
/**
 * step-run.mjs - run StepCode non-interactively and extract the final answer.
 *
 * Usage:
 *   node step-run.mjs "prompt" [options]
 *
 * Options:
 *   --json                 Emit a JSON summary instead of plain text
 *   --cwd <dir>            Working directory for the run (step -C)
 *   --model <pattern>      Model pattern, e.g. step-3.7-flash:high
 *   --tools <list>         Comma-separated tool allowlist
 *   --name <name>          Session display name
 *   --session-id <id>      Reuse an exact session id across runs
 *   --continue             Continue the most recent session (-c)
 *   --no-session           Ephemeral run
 *   --approval <mode>      confirm|auto
 *   --ni-approval <mode>   allow|deny
 *   --ni-denial <mode>     terminate|continue
 *   --approve / --no-approve   Trust / ignore project-local files
 *   --timeout <ms>         Kill the run after this long (default 600000)
 *   --step <path>          Path to the step binary
 *   -- <extra args>        Passed through verbatim to step
 *
 * Reads piped stdin and appends it to the prompt, matching `step -p` behavior.
 * Exit codes: 0 success, 1 run failed, 2 usage/start error.
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const STEP_DEFAULT = process.platform === "win32"
  ? join(homedir(), ".stepcode", "bin", "step.exe")
  : "step";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
  console.log("Usage: node step-run.mjs \"prompt\" [--json] [--cwd <dir>] [--model <p>] [--tools <list>]");
  process.exit(2);
}

const opts = {
  json: false, cwd: null, model: null, tools: null, name: null,
  sessionId: null, continueSession: false, noSession: false,
  approval: null, niApproval: null, niDenial: null,
  approve: null, timeout: 600000, step: STEP_DEFAULT, extra: [],
};
const passthrough = [];
let prompt = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--") { passthrough.push(...argv.slice(i + 1)); break; }
  switch (a) {
    case "--json": opts.json = true; break;
    case "--cwd": opts.cwd = argv[++i]; break;
    case "--model": opts.model = argv[++i]; break;
    case "--tools": opts.tools = argv[++i]; break;
    case "--name": opts.name = argv[++i]; break;
    case "--session-id": opts.sessionId = argv[++i]; break;
    case "--continue": opts.continueSession = true; break;
    case "--no-session": opts.noSession = true; break;
    case "--approval": opts.approval = argv[++i]; break;
    case "--ni-approval": opts.niApproval = argv[++i]; break;
    case "--ni-denial": opts.niDenial = argv[++i]; break;
    case "--approve": opts.approve = "a"; break;
    case "--no-approve": opts.approve = "na"; break;
    case "--timeout": opts.timeout = Number(argv[++i]); break;
    case "--step": opts.step = argv[++i]; break;
    default:
      if (prompt === null) prompt = a;
      else passthrough.push(a);
  }
}

if (prompt === null) { console.error("error: no prompt given"); process.exit(2); }

const args = ["--mode", "json", "-p"];
if (opts.cwd) args.push("-C", opts.cwd);
if (opts.model) args.push("--model", opts.model);
if (opts.tools) args.push("--tools", opts.tools);
if (opts.name) args.push("--name", opts.name);
if (opts.sessionId) args.push("--session-id", opts.sessionId);
if (opts.continueSession) args.push("-c");
if (opts.noSession) args.push("--no-session");
if (opts.approval) args.push("--approval-mode", opts.approval);
if (opts.niApproval) args.push("--non-interactive-approval", opts.niApproval);
if (opts.niDenial) args.push("--non-interactive-denial", opts.niDenial);
if (opts.approve === "a") args.push("-a");
if (opts.approve === "na") args.push("-na");
args.push(...passthrough, "--", prompt);

const child = spawn(opts.step, args, { stdio: ["pipe", "pipe", "inherit"] });

let stdinData = "";
if (!process.stdin.isTTY) {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { stdinData += c; });
}

let buffer = "";
let sessionId = null;
let sessionCwd = null;
const toolCalls = [];
let finalText = "";
let failure = null;
let settled = false;
let messageCount = null;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {          // LF only
    const line = buffer.slice(0, idx).replace(/\r$/, "");
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }  // ignore entry_appended etc.
    switch (evt.type) {
      case "session":
        sessionId = evt.id; sessionCwd = evt.cwd; break;
      case "tool_execution_end":
        toolCalls.push({ tool: evt.toolName, isError: evt.isError }); break;
      case "message_end":
        if (evt.message && evt.message.role === "assistant") {
          const text = (evt.message.content || [])
            .filter((b) => b.type === "text")
            .map((b) => b.text).join("");
          if (text.trim()) finalText = text;
        }
        break;
      case "agent_end":
        messageCount = evt.messageCount; break;
      case "agent_settled":
        settled = true;
        if (evt.failure) failure = evt.failure;
        break;
    }
  }
});

if (!process.stdin.isTTY) {
  process.stdin.on("end", () => {
    if (stdinData.trim()) child.stdin.write(`\n\n${stdinData.trimEnd()}\n`);
    child.stdin.end();
  });
} else {
  child.stdin.end();
}

const timer = setTimeout(() => { child.kill(); }, opts.timeout);
timer.unref?.();

child.on("error", (err) => { console.error(`error: failed to start ${opts.step}: ${err.message}`); process.exit(2); });
child.on("close", (code) => {
  clearTimeout(timer);
  const summary = {
    sessionId, cwd: sessionCwd, settled, failure,
    messageCount, toolCalls: toolCalls.length, text: finalText, exitCode: code,
  };
  if (opts.json) console.log(JSON.stringify(summary, null, 2));
  else if (finalText) console.log(finalText);
  if (failure) { console.error(`run failed: ${failure.kind}/${failure.reason} ${failure.message ?? ""}`); process.exit(1); }
  if (!settled) { console.error("warning: run ended before agent_settled"); process.exit(code ?? 1); }
  process.exit(code ?? 0);
});
