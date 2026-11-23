# Recipes

Copy-paste patterns for operating StepCode from other agents and scripts.

## 1. One-shot answer

```bash
step -p "List all .ts files in src/"
```

## 2. One-shot with stdin context

```bash
cat README.md | step -p "Summarize this text"
git diff | step -p "Write a commit message for this diff"
```

## 3. One-shot with attachments and a different working directory

```bash
step -C /repo --tools read,grep,find,ls -p @src/app.ts "Review this file"
```

## 4. Read-only audit (no writes possible)

```bash
step --tools read,grep,find,ls -p "Review the code in src/"
```

## 5. Fully unattended run (CI)

```bash
step \
  --approval-mode auto \
  --non-interactive-approval allow \
  --non-interactive-denial continue \
  -a \
  -p "Run the test suite and report failures"
```

`--approval-mode auto` pre-approves; `--non-interactive-approval allow` is the
fallback if a UI never appears; `--non-interactive-denial continue` keeps the run
going when a call is blocked. Use `-na` instead of `-a` when the project must not
be trusted.

Per-tool overrides are repeatable:

```bash
step --tool-override bash=allow --tool-override write=deny -p "..."
```

## 6. Structured output, final text only

```bash
step --mode json -p "Summarize the repo" 2>/dev/null | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  for (const l of d.split("\n")) { if (!l.trim()) continue;
    const o = JSON.parse(l);
    if (o.type === "message_end" && o.message.role === "assistant")
      console.log(o.message.content.filter(b=>b.type==="text").map(b=>b.text).join(""));
  }
})'
```

Or use the bundled runner:

```bash
node scripts/step-run.mjs "Summarize the repo" --json
```

## 7. Detect failure, not just exit code

A run can exit 0 and still have produced nothing usable. Watch for
`agent_settled` carrying `failure`:

```bash
step --mode json -p "..." 2>/dev/null | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  let failed = null;
  for (const l of d.split("\n")) { if (!l.trim()) continue;
    const o = JSON.parse(l);
    if (o.type === "agent_settled" && o.failure) failed = o.failure;
  }
  if (failed) { console.error("RUN FAILED:", failed.kind, failed.reason, failed.message); process.exit(1); }
})'
```

## 8. Continuity across turns

```bash
# Turn 1 - create/reuse a stable session id
step --session-id ci-audit -p "Audit this repository"

# Turn 2 - same session id continues the conversation
step --session-id ci-audit -p "Now check the error handling in src/http"

# Named session for later resume
step --name "release audit" -p "Audit this repository"
step -c -p "What did we discuss?"
step --session <partial-uuid> -p "Continue that thread"
```

## 9. Fork before a risky change

```bash
step --fork <path|id> -p "Try the risky refactor here"
```

## 10. Ephemeral run (no session file)

```bash
step --no-session -p "One-off question"
```

## 11. Force a specific model and thinking level

```bash
step --model step-3.7-flash:high -p "Solve this complex problem"
step --provider openai --model gpt-4o -p "Help me refactor"
step --models "step/*" --thinking high -p "..."
```

## 12. Inject instructions without touching project files

```bash
step --append-system-prompt "Always answer in Chinese. Never run git push." -p "..."
step --append-system-prompt ./prompts/review-rules.md -p "Review src/"
```

## 13. Isolate from project resources

```bash
step --no-extensions --no-skills --no-prompt-templates --no-context-files -p "..."
step --no-skills --skill ./my-skill/SKILL.md -p "..."
```

## 14. Multi-agent ultracode run from the shell

```bash
step -p "ultracode: audit the payment module for race conditions"
```

`/ultracode on|off|status|help` and `/ultraloop ...` are interactive editor
commands; session mode stays on until `/ultracode off` or a session boundary. One
turn can be opted in with `ultracode: <task>` / `ultraloop: <task>`, including
from the shell as shown above.

## 15. Completion-gated print run

```bash
step -p --completion-check git-committed "Fix the failing tests and commit"
step -p --completion-check git-committed --completion-check-attempts 3 "Land this change"
step -p --completion-review "Implement the feature and self-review"
```

## 16. RPC client (Node, spec-compliant framing)

`scripts/step-rpc.mjs` implements this. The essential shape:

```javascript
import { spawn } from "node:child_process";

const child = spawn("step", ["--mode", "rpc"], { stdio: ["pipe", "pipe", "inherit"] });
let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {          // LF only - never readline
    const line = buffer.slice(0, idx).replace(/\r$/, "");
    buffer = buffer.slice(idx + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

send({ id: "1", type: "get_state" });
send({ id: "2", type: "prompt", message: "Say PONG" });
send({ id: "3", type: "get_last_assistant_text" });
```

Remember: responses are not ordered by request, `prompt` resolves immediately
after acceptance, and `agent_settled` is the only reliable completion boundary.

## 17. Answer an extension UI dialog

If an `extension_ui_request` with `method: "confirm"` arrives, reply on stdin:

```json
{"type":"extension_ui_response","id":"uuid-2","confirmed":true}
```

For `select` / `input` / `editor` reply with `{"type":"extension_ui_response","id":"...","value":"..."}`,
or `{"type":"extension_ui_response","id":"...","cancelled":true}` to dismiss.

## 18. Use StepCode as a sub-agent backend from another agent

```bash
step \
  -C "$TARGET_DIR" \
  --no-session \
  --approval-mode auto \
  --non-interactive-approval allow \
  --non-interactive-denial continue \
  --tools read,grep,find,ls,edit,write,bash \
  -p "$SUBTASK"
```

For a sub-agent that must not write, drop `edit,write` from `--tools`. Add
`--name "$SUBTASK_ID"` if you want a resumable session instead of `--no-session`.

## 19. Export a finished session

```bash
step --export ~/.stepcode/agent/sessions/<encoded-cwd>/session.jsonl report.html
```

## 20. Hand a credential to an external client

```bash
step auth print-bearer-token --provider step
step auth check --provider step --json
```

Never log either output.

## 21. Discover what is available before running

```bash
step --list-models                 # provider, model, context, max-out, thinking, images
step --list-models flash           # fuzzy search
step config path --json            # config locations
step config show --json            # effective config (sensitive)
step list                          # installed packages
step mcp list                      # configured MCP servers
step login status --json           # auth state
```
