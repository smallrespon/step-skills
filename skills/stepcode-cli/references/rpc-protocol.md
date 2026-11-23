# RPC mode (`--mode rpc`)

Headless operation over a JSON protocol on stdin/stdout. Use it to embed the
agent in another application, IDE, or custom UI.

```bash
step --mode rpc [options]
```

Common startup options: `--provider <name>`, `--model <pattern>`,
`--name <name>` / `-n <name>`, `--no-session`, `--session-dir <path>`,
`--plan-review-surface`, `--include-live-events`.

For Node/TypeScript hosts, prefer importing `AgentSession` from
`@step-harness/coding-agent` instead of spawning a subprocess. A subprocess-based
TypeScript client lives at `src/modes/rpc/rpc-client.ts` in the package.

## Framing (critical)

- Strict JSONL with LF (`\n`) as the only record delimiter.
- Split records on `\n` only; accept optional `\r\n` by stripping a trailing `\r`.
- Do **not** use generic line readers that treat Unicode separators as newlines.
  Node's `readline` is **not** protocol-compliant: it also splits on U+2028 and
  U+2029, which are valid inside JSON strings.

## Message categories

- **Commands**: JSON objects sent to stdin, one per line.
- **Responses**: `{"type":"response", ...}` with `success` and optional `data`.
- **Events**: agent events streamed to stdout as JSON lines.

All commands accept an optional `id` for request/response correlation; the
matching response echoes it. `bash_execution_update` events also carry the `id`
of their originating `bash` command.

Responses are **not** ordered by request: `prompt` is accepted asynchronously, so
its `response` can arrive after responses to later commands. Verified live.

## Commands

### Prompting

| Command | Payload | Notes |
|---------|---------|-------|
| `prompt` | `{message, images?}` | Response is emitted after the prompt is accepted, queued or handled; events keep streaming |
| `steer` | `{message, images?}` | Delivered after the current assistant turn finishes its tool calls, before the next LLM call |
| `follow_up` | `{message, images?}` | Delivered only when the agent stops |
| `abort` | - | Abort the current operation |
| `clear_queue` | - | Removes queued steering/follow-up messages and returns their text |
| `new_session` | `{parentSession?}` | Fresh session; `data.cancelled` if an extension cancelled |

While the agent is streaming, `prompt` requires `streamingBehavior`:
`"steer"` or `"followUp"`; without it the command returns an error. Extension
commands (`/mycommand`) execute immediately even during streaming and manage
their own LLM interaction. Skill commands (`/skill:name`) and prompt templates
(`/template`) are expanded before sending/queueing.

`clear_queue` + `abort` reproduces interactive Esc: `abort` continues queued
messages when they remain in the session.

```json
{"id": "req-1", "type": "prompt", "message": "Hello, world!"}
{"type": "prompt", "message": "What's in this image?", "images": [{"type": "image", "data": "base64", "mimeType": "image/png"}]}
{"type": "prompt", "message": "New instruction", "streamingBehavior": "steer"}
{"id": "req-1", "type": "response", "command": "prompt", "success": true}
```

`success: true` means accepted/queued/handled. Failures **after** acceptance are
reported through the event and message stream, not as a second `response`.

### State

| Command | Response `data` |
|---------|-----------------|
| `get_state` | `{model, thinkingLevel, isStreaming, isCompacting, steeringMode, followUpMode, sessionFile, sessionId, sessionName?, autoCompactionEnabled, messageCount, pendingMessageCount}` |
| `get_messages` | `{messages: AgentMessage[]}` |

### Model and thinking

| Command | Payload | Notes |
|---------|---------|-------|
| `set_model` | `{provider, modelId}` | Returns the full `Model` |
| `cycle_model` | - | `data.model` is `null` if only one model is available |
| `get_available_models` | - | Array of full `Model` objects |
| `set_thinking_level` | `{level}` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `cycle_thinking_level` | - | `data.level`, or `null` when the model has no thinking |
| `get_available_thinking_levels` | - | `data.levels`; `["off"]` for a model without reasoning |

### Queue modes

`set_steering_mode {mode: "all" | "one-at-a-time"}` (default `one-at-a-time`) and
`set_follow_up_mode {mode: "all" | "one-at-a-time"}` (default `one-at-a-time`).

### Compaction

| Command | Payload | Response `data` |
|---------|---------|-----------------|
| `compact` | `{customInstructions?}` | `{summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter, usage?, details}` |
| `set_auto_compaction` | `{enabled}` | - |

`estimatedTokensAfter` is a heuristic over the rebuilt context, not a
provider-exact count. `usage` reports the LLM call(s) that generated the summary
and may be omitted by custom compaction handlers.

### Retry

| Command | Notes |
|---------|-------|
| `set_auto_retry {enabled}` | Automatic retry on transient errors (overloaded, rate limit, 5xx) |
| `abort_retry` | Cancel the delay and stop retrying |

### Bash

```json
{"id": "req-1", "type": "bash", "command": "ls -la"}
```

Executes immediately, streams `bash_execution_update` events, and returns the
final result:

```json
{"id":"req-1","type":"response","command":"bash","success":true,"data":{
  "output":"...","exitCode":0,"cancelled":false,"truncated":false,
  "execution":{"status":"exited","exitCode":0,"signal":null,"timedOut":false,"aborted":false}}}
```

Truncated output adds `fullOutputPath`. `abort_bash` stops a running command.

**How bash output reaches the LLM:** a `BashExecutionMessage` is stored in the
agent's message state and converted to a user message on the **next** `prompt`.
So (1) output is included on the next prompt, not immediately, and (2) several
bash commands can run before one prompt and all outputs are included.

### Session

| Command | Payload | Response `data` |
|---------|---------|-----------------|
| `get_session_stats` | - | `{sessionFile, sessionId, userMessages, assistantMessages, toolCalls, toolResults, totalMessages, tokens, cost, contextUsage?}` |
| `export_html` | `{outputPath?}` | `{path}` |
| `switch_session` | `{sessionPath}` | `{cancelled}` |
| `fork` | `{entryId}` | `{text, cancelled}` |
| `clone` | - | `{cancelled}` |
| `get_fork_messages` | - | `{messages: [{entryId, text}]}` |
| `get_entries` | `{since?}` | `{entries, leafId}` |
| `get_tree` | - | `{tree: [{entry, children, label?, labelTimestamp?}], leafId}` |
| `get_last_assistant_text` | - | `{text}` or `{text: null}` |
| `set_session_name` | `{name}` | - |

`get_entries` returns append-order entries excluding the session header, and
includes pre-compaction history and abandoned branches. An entry id is a durable
cursor: pass the last seen id as `since`. If `since` matches no entry the
response is `success: false`. `leafId` is `null` for an empty session.

`get_last_assistant_text` returns the handoff text for an unanswered plan
proposal while `pendingProposalHash` is set; a newer answer wins over the
proposal. `/plan approve`, a change request, or `/plan off` clears it.

`get_session_stats`: `tokens` and `cost` cover the full session including tool
usage and summary generation. `contextUsage` is omitted when no model or context
window is available, and its `tokens`/`percent` are `null` right after compaction
until fresh usage data arrives.

### Commands (discovery)

`get_commands` lists extension commands, prompt templates and skills that can be
invoked via `prompt` with a `/` prefix:

```json
{"type":"response","command":"get_commands","success":true,"data":{"commands":[
  {"name":"session-name","description":"Set or clear session name","source":"extension","path":"..."},
  {"name":"fix-tests","description":"Fix failing tests","source":"prompt","location":"project","path":"..."},
  {"name":"skill:brave-search","description":"Web search via Brave API","source":"skill","location":"user","path":"..."}]}}
```

`source` is `extension`, `prompt` or `skill`; `location` is `user`, `project` or
`path`. Built-in TUI commands (`/settings`, `/hotkeys`, ...) are **not** included
and will not execute if sent via `prompt`.

## Plan review surface

`--plan-review-surface` tells the session that this client draws the proposal and
collects the decision. With it, `exit_plan_mode` keeps plan mode on, ends the
turn, and records the proposal as waiting; the client answers with
`/plan approve` / `/plan approve <hash>` or `/plan off`. Without it the RPC host
keeps the handoff behavior: plan mode exits, the turn ends, and approval belongs
to the caller. The flag is not implied by `--mode rpc`.

## Events

Events stream to stdout as JSON lines and generally carry no `id`, except
`bash_execution_update`, which carries the originating `bash` command's `id`.

| Event | Notes |
|-------|-------|
| `agent_start` | Agent begins processing a prompt |
| `agent_end` | One low-level run completes; `{willRetry, messageCount}` |
| `agent_settled` | Fully settled; carries `failure` when the run produced no usable answer |
| `turn_start` / `turn_end` | `turn_end` carries `{messageRole, toolResultCount}` |
| `message_start` / `message_end` | `message` is an `AgentMessage` |
| `message_update` | Opt-in frame (`--include-live-events`) |
| `bash_execution_update` | `{id, delta}` - direct RPC bash output chunk |
| `tool_execution_start` | `{toolCallId, toolName, args}` |
| `tool_execution_update` | Opt-in frame; `partialResult` holds accumulated output |
| `tool_execution_end` | `{toolCallId, toolName, result, isError}` |
| `queue_update` | `{steering: [...], followUp: [...]}` |
| `compaction_start` | `{reason}` - `manual`, `threshold` or `overflow` |
| `compaction_end` | `{reason, result?, aborted, willRetry, errorMessage?}` |
| `auto_retry_start` / `auto_retry_end` | `{attempt, maxAttempts, delayMs, errorMessage}` / `{success, attempt, finalError?}` |
| `summarization_retry_scheduled` / `_attempt_start` / `_finished` | Compaction/branch-summary retries; `source` is `compaction` or `branchSummary` |
| `extension_error` | `{extensionPath, event, error}` |
| `entry_appended` | Step-specific session-entry event (ignore for parsing) |
| `extension_ui_request` | Extension UI sub-protocol, see below |

`agent_end` does not bound one prompt: an incomplete-turn recovery, a compaction
retry and queued continuations each emit their own. `agent_settled` is the
boundary that says the run is over.

Compaction: if `reason` was `overflow` and compaction succeeds, `willRetry` is
`true` and the prompt is retried automatically. If aborted, `result` is `null`
and `aborted` is `true`. If it failed, `result` is `null`, `aborted` is `false`,
and `errorMessage` explains why.

## Extension UI sub-protocol

Extensions can request interaction via `ctx.ui.select()`, `confirm()`, etc.

- **Dialog methods** (`select`, `confirm`, `input`, `editor`): emit an
  `extension_ui_request` on stdout and block until the client replies with an
  `extension_ui_response` on stdin carrying the matching `id`.
- **Fire-and-forget** (`notify`, `setStatus`, `setWidget`, `setTitle`,
  `set_editor_text`): emit the request and expect no response.

Dialog requests may include `timeout`; the agent auto-resolves with a default
value when it expires, so the client does not need to track timeouts.

Requests look like:

```json
{"type":"extension_ui_request","id":"uuid-1","method":"select","title":"Allow dangerous command?","options":["Allow","Block"],"timeout":10000}
{"type":"extension_ui_request","id":"uuid-2","method":"confirm","title":"Clear session?","message":"All messages will be lost.","timeout":5000}
{"type":"extension_ui_request","id":"uuid-3","method":"input","title":"Enter a value","placeholder":"type something..."}
{"type":"extension_ui_request","id":"uuid-4","method":"editor","title":"Edit some text","prefill":"Line 1\nLine 2"}
{"type":"extension_ui_request","id":"uuid-5","method":"notify","message":"Command blocked by user","notifyType":"warning"}
{"type":"extension_ui_request","id":"uuid-6","method":"setStatus","statusKey":"my-ext","statusText":"Turn 3 running..."}
{"type":"extension_ui_request","id":"uuid-7","method":"setWidget","widgetKey":"my-ext","widgetLines":["--- My Widget ---","Line 1"],"widgetPlacement":"aboveEditor"}
{"type":"extension_ui_request","id":"uuid-8","method":"setTitle","title":"step - my project"}
{"type":"extension_ui_request","id":"uuid-9","method":"set_editor_text","text":"prefilled text for the user"}
```

Responses (stdin), dialog methods only:

```json
{"type":"extension_ui_response","id":"uuid-1","value":"Allow"}
{"type":"extension_ui_response","id":"uuid-2","confirmed":true}
{"type":"extension_ui_response","id":"uuid-3","cancelled":true}
```

Omitting `statusText` clears a status entry; omitting `widgetLines` clears a
widget. `notifyType` is `info` (default), `warning` or `error`.
`widgetPlacement` is `aboveEditor` (default) or `belowEditor`.

Degraded in RPC mode: `custom()` returns `undefined`;
`setWorkingMessage()`, `setWorkingIndicator()`, `setFooter()`, `setHeader()`,
`setEditorComponent()`, `setToolsExpanded()` are no-ops;
`getEditorText()` returns `""`; `getToolsExpanded()` returns `false`;
`pasteToEditor()` delegates to `setEditorText()`; `getAllThemes()` returns `[]`;
`getTheme()` returns `undefined`; `setTheme()` returns
`{success:false,error:"..."}`. `ctx.mode` is `"rpc"` and `ctx.hasUI` is `true`
in RPC mode; guard TUI-only features with `ctx.mode === "tui"`.

## Error handling

```json
{"type":"response","command":"set_model","success":false,"error":"Model not found: invalid/model"}
{"type":"response","command":"parse","success":false,"error":"Failed to parse command: Unexpected token..."}
```

## Wire types

`Model`:
`{id, name, api, provider, baseUrl, reasoning, input[], contextWindow, maxTokens, cost{input,output,cacheRead,cacheWrite}}`

`UserMessage`: `{role:"user", content: string | (TextContent|ImageContent)[], timestamp, attachments?}`
`AssistantMessage`: `{role:"assistant", content:[text|thinking|toolCall], api, provider, model, usage?, stopReason, timestamp}`
Stop reasons: `stop`, `length`, `toolUse`, `error`, `aborted`.
`ToolResultMessage`: `{role:"toolResult", toolCallId, toolName, content[], usage?, isError, timestamp}`
`BashExecutionMessage`: `{role:"bashExecution", command, output, exitCode, cancelled, truncated, fullOutputPath, execution, timestamp}`
`Attachment`: `{id, type, fileName, mimeType, size, content, extractedText?, preview?}`

Command results: `tool_execution_end.isError` is `false` for a command that
returned a nonzero exit, deadline or signal. Read `details.execution` for the
precise outcome; treat `isError` as "was this a successful result".

## Minimal Python client skeleton

```python
import json, subprocess

p = subprocess.Popen(["step", "--mode", "rpc"], stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, text=True, bufsize=1)

def send(obj):
    p.stdin.write(json.dumps(obj) + "\n"); p.stdin.flush()

send({"id": "1", "type": "get_state"})
send({"id": "2", "type": "prompt", "message": "Say PONG"})
send({"id": "3", "type": "get_last_assistant_text"})

for line in p.stdout:              # LF-only: use a plain iterator, never readline-unicode
    if not line.strip():
        continue
    evt = json.loads(line)
    if evt.get("type") == "response" and evt.get("id") == "3":
        print(evt["data"]["text"])
        break
p.stdin.close(); p.wait()
```
