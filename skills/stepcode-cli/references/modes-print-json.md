# Print mode and JSON event stream

## Print mode (`-p` / `--print`)

```bash
step -p "prompt"
```

Processes the prompt, prints the final assistant answer as plain text, exits.
Print mode also **reads piped stdin and merges it into the initial prompt**:

```bash
cat README.md | step -p "Summarize this text"
echo "def f(): pass" | step -p "Add a docstring to this function"
```

Attachments work the same as interactive mode, and multiple `@file` arguments and
several trailing messages are all accepted:

```bash
step -p @screenshot.png "What's in this image?"
step -p @src/app.ts @src/app.test.ts "Review these together"
```

A prompt that begins with `-` must be separated from the flags:

```bash
step -p -- "- Summarize these points"
```

### Completion checks (print/json only)

| Flag | Meaning |
|------|---------|
| `--completion-check git-committed` | Opt-in check that the work is committed in Git |
| `--completion-check-attempts <n>` | Maximum same-session follow-ups, `1..3`, default `2` |
| `--completion-review` | One print/json task self-review; no Git required |

Both features own the bounded follow-up for missing output, so print mode sets
`setIncompleteTurnRecoveryEnabled(false)` for the whole invocation and the two
paths never each make a model call. With `git-committed`, `--completion-review`
shares the same follow-up budget.

A run that ends without a usable answer is reported on `agent_settled` with a
`failure` object (`{kind, reason, message}`), not by rewriting the assistant
message. Provider errors and cancellations keep using `stopReason`.

## JSON event stream (`--mode json`)

```bash
step --mode json "Your prompt"
step --mode json -p "Your prompt"
```

Every session event is written to stdout as one JSON object per line. The first
line is always the session header:

```json
{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path"}
```

### Facts vs frames

`--mode json` writes a **record**: frames are excluded and events that close over
messages report the boundary instead of repeating them.

- `message_update` and `tool_execution_update` are cumulative snapshots, each
  superseded by its successor (`message_end` / `tool_execution_end`). **They are
  not written by default.** The test is the successor, not the word "progress":
  `bash_execution_update` is a delta with no event that restates it, so it stays.
- `turn_end` is narrowed to `{ messageRole, toolResultCount }`; `agent_end` to
  `{ willRetry, messageCount }`.

Opt into frames with `--include-live-events`. That mode is a debugging aid, not a
log format: frames are frequent by design and a run redirected to a file is much
larger. A written `tool_execution_update` frame is still capped at 256 KiB of
serialized bytes (oversized frames keep the tail plus a
`[live output truncated]` marker, clip `toolCallId`/`toolName`, and omit
`args`/`details`). Terminal events are never bounded.

### What is deliberately repeated

- a **user** message appears on both `message_start` and `message_end` - that pair
  is how a reader frames it;
- a **tool result** appears on `tool_execution_end` and again in its own
  `message_start`/`message_end` (three copies total);
- an **assistant** message's final payload appears once, on `message_end`; its
  `message_start` carries the empty partial message.

A consumer reconstructs a run from `message_end` (messages),
`tool_execution_end` (tool results) and the boundaries for structure.

### Observed event stream

Verified against a real `step --mode json -p` run (Step build 0.1.7):

```json
{"type":"session","version":3,"id":"...","timestamp":"...","cwd":"..."}
{"type":"entry_appended","entry":{...}}            // Step extension events, ignore
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"user",...}}
{"type":"message_start","message":{"role":"assistant","content":[],...}}
{"type":"message_end","message":{"role":"user",...}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"..."}],...}}
{"type":"turn_end","messageRole":"assistant","toolResultCount":0}
{"type":"agent_end","willRetry":false,"messageCount":2}
{"type":"agent_settled"}
```

Counts from that run: `session` x1, `entry_appended` x51, `agent_start` x1,
`turn_start` x1, `message_start` x2, `message_end` x2, `turn_end` x1,
`agent_end` x1, `agent_settled` x1. **Always filter on `type`** - Step ships
extension events such as `entry_appended` on the same stream.

### Event types

| Event | Notes |
|-------|-------|
| `session` | Header line, first record |
| `agent_start` | Agent begins processing |
| `agent_end` | One low-level run completes; `{willRetry, messageCount}` |
| `agent_settled` | Fully settled - no retry, compaction retry or queued continuation remains. Carries `failure` when the run produced no usable answer |
| `turn_start` / `turn_end` | `turn_end` carries `{messageRole, toolResultCount}` |
| `message_start` / `message_end` | `message_end.message` is authoritative |
| `message_update` | Opt-in frame; delta-only, has top-level `usage` and `assistantMessageEvent` |
| `tool_execution_start` | `{toolCallId, toolName, args}` |
| `tool_execution_update` | Opt-in frame; `partialResult` holds accumulated output |
| `tool_execution_end` | `{toolCallId, toolName, result, isError}` |
| `bash_execution_update` | Direct RPC bash output chunk (delta, never framed out) |
| `queue_update` | Pending steering/follow-up queue changed |
| `compaction_start` / `compaction_end` | `reason` is `manual`, `threshold` or `overflow` |
| `auto_retry_start` / `auto_retry_end` | Transient-error retries |
| `summarization_retry_*` | Compaction / branch-summary retries |
| `extension_error` | Extension threw |
| `entry_appended` | Step-specific: a session entry was appended (ignore for parsing) |

`assistantMessageEvent` delta types: `text_start`, `text_delta`, `text_end`,
`thinking_start`, `thinking_delta`, `thinking_end`, `toolcall_start`,
`toolcall_delta`, `toolcall_end`. `toolcall_start` carries `id` and `toolName`;
buffer `toolcall_delta.delta` for arguments; `toolcall_end.toolCall` is complete.

### Example: extract the final answer

```bash
step --mode json -p "List files" 2>/dev/null | jq -c 'select(.type == "message_end")'
```

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
