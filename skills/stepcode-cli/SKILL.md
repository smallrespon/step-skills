---
name: stepcode-cli
description: Drive StepCode (the `step` coding agent) non-interactively from another agent or script - one-shot `step -p` prompts, JSON event stream (`--mode json`), the RPC control channel (`--mode rpc`), the length-prefixed SDK stdio host (`--sdk-stdio`), the Node SDK, session resume/fork/clone, credential printing, package and MCP management, session indexing, feedback, and ultracode workflow runs from the shell. Use whenever you must operate StepCode headlessly, from CI, as a sub-agent backend, or when the interactive TUI is unavailable.
license: MIT
metadata:
  stepcode-cli-version: 0.1.7
  platform: win32
---

# StepCode non-interactive operation

This skill is the complete operator's reference for driving **StepCode** (`step`,
package `@step-harness/coding-agent`) without a human at a terminal. Every command
below was executed against the installed build or read from the shipped docs at
`~/.stepcode/bin/docs/` (see [Sources](#sources)).

## 1. Locate the binary

```bash
step --version                      # on PATH (npm global install)
"$HOME/.stepcode/bin/step.exe" --version   # installed Windows build (PowerShell: $env:USERPROFILE)
```

`step` is also installed at `~/.stepcode/bin/step.exe` on Windows. If `step` is not
on PATH, call that absolute path. The npm package is
`@step-harness/coding-agent` (binary `step`, entry `dist/bundle/step.js`).

## 2. Pick a mode

| Need | Command |
|------|---------|
| One answer, exit when done | `step -p "prompt"` |
| One answer, machine-readable | `step --mode json -p "prompt"` |
| Long-lived control channel | `step --mode rpc` |
| Embed in a Node/TS app | Node SDK `@step-harness/coding-agent` |
| Non-Node host, framed protocol | `step --sdk-stdio` |
| Multi-agent ultracode run from shell | `step -p "ultracode: <task>"` |
| Convert a saved session to HTML | `step --export <in> [out]` |

Details: [references/modes-print-json.md](references/modes-print-json.md),
[references/rpc-protocol.md](references/rpc-protocol.md).

## 3. Non-negotiable rules

1. **Non-interactive never prompts.** `-p`, `--mode json`, `--mode rpc` and
   `--sdk-stdio` never show a trust or approval dialog. Unanswered trust falls back
   to `defaultProjectTrust` (`ask`/`never` ignore project resources, `always` trusts
   them). Unanswered approval falls back to `--non-interactive-approval`. Always set
   both explicitly in automation.
2. **`isError` is not the exit code.** In JSON/RPC, `tool_execution_end.isError` is
   `false` for a command that exited nonzero, hit a deadline, or took a signal. Read
   `result.details.execution` for the real outcome.
3. **`messageCount` is not a checksum.** Detect a truncated run by a message that
   never received `message_end`, never by comparing counts.
4. **`agent_settled` is the only reliable "done" boundary.** `agent_end` can fire
   several times per prompt (retry, compaction retry, queued continuation).
5. **RPC splits on `\n` only.** Node `readline` is *not* protocol-compliant: it also
   splits on U+2028/U+2029, which are legal inside JSON strings.
6. **`--mode json` and `--mode rpc` write facts, not frames.** `message_update` and
   `tool_execution_update` are opt-in via `--include-live-events`.
7. **Prompt starting with `-`** needs `step -p -- "- text"`.
8. **`-C/--cwd` is a startup flag**, so `step -C <dir> <subcommand>` runs the
   subcommand and the subcommand ignores `-C`. Top-level subcommands are detected
   from the first argument.

## 4. Complete flag reference

Startup flags (space-separated values; the `--flag=value` form is reserved for
extension flags):

### Mode and output
| Flag | Meaning |
|------|---------|
| `-p`, `--print` | Non-interactive: process the prompt, print, exit. Merges piped stdin into the initial prompt |
| `--mode <text\|json\|rpc>` | Output mode; default `text` |
| `--include-live-events` | Opt into `message_update` / `tool_execution_update` frames (much larger logs) |
| `--plan-review-surface` | RPC client draws plan proposals and collects the decision |
| `--sdk-stdio` | Run the length-prefixed Step Agent SDK stdio host |
| `--export <file>` / `step --export <in> [out]` | Export a session file to HTML and exit |
| `--verbose` | Force verbose startup (overrides `quietStartup`) |

### Model
| Flag | Meaning |
|------|---------|
| `--provider <name>` | Provider name; default `step` |
| `--model <pattern>` | Model pattern or ID; supports `provider/id` and `:thinking` |
| `--api-key <key>` | API key, overriding env vars |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling; globs and fuzzy match |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--list-models [search]` | List available models and exit (optional fuzzy search) |

### Approval, trust and permissions
| Flag | Meaning |
|------|---------|
| `--approval-mode <confirm\|auto>` | Tool approval mode |
| `--non-interactive-approval <allow\|deny>` | Fallback when there is no approval UI |
| `--non-interactive-denial <terminate\|continue>` | What a blocked call does without a UI |
| `--tool-override <tool=mode>` | Per-tool override, repeatable; mode `allow`, `confirm`, `deny` |
| `-a`, `--approve` | Trust project-local files for this run |
| `-na`, `--no-approve` | Ignore project-local files for this run |

### Tools
| Flag | Meaning |
|------|---------|
| `-t`, `--tools <list>` | Allowlist of tool names (built-in, extension, custom) |
| `-xt`, `--exclude-tools <list>` | Denylist of tool names |
| `-nt`, `--no-tools` | Disable all tools |
| `-nbt`, `--no-builtin-tools` | Disable built-ins, keep extension/custom tools |

Built-in tools: `read`, `bash`, `powershell` (Windows), `edit`, `write`, `grep`,
`find`, `ls`. `grep`/`find`/`ls` are read-only and **off by default** - enable them
through `--tools` or settings.

### Sessions
| Flag | Meaning |
|------|---------|
| `-c`, `--continue` | Continue the most recent session |
| `-r`, `--resume [path\|id]` | Resume a session; without a value opens a selector |
| `--session <path\|id>` | Use a specific session file or partial UUID |
| `--session-id <id>` | Use an exact project session ID, creating it if missing |
| `--fork <path\|id>` | Fork a session file or partial UUID into a new session |
| `--session-dir <dir>` | Directory for session storage and lookup |
| `-C`, `--cwd <dir>` | Working directory for the whole run |
| `--no-session` | Ephemeral; do not save |
| `-n`, `--name <name>` | Session display name |

### Resources and prompting
| Flag | Meaning |
|------|---------|
| `-e`, `--extension <path>` | Load an extension; repeatable. Accepts path, npm or git source |
| `-ne`, `--no-extensions` | Disable extension discovery (explicit `-e` still works) |
| `--skill <path>` | Load a skill file or directory; repeatable |
| `-ns`, `--no-skills` | Disable skill discovery and loading |
| `--prompt-template <path>` | Load a prompt template file or directory; repeatable |
| `-np`, `--no-prompt-templates` | Disable prompt template discovery |
| `--theme <path>` | Load a theme file or directory; repeatable |
| `--no-themes` | Disable theme discovery |
| `--use-theme <name[/name]>` | Initial interactive theme for this run |
| `-nc`, `--no-context-files` | Disable `AGENTS.md` / `CLAUDE.md` discovery |
| `--system-prompt <text>` | Replace the default system prompt |
| `--append-system-prompt <text>` | Append text or file contents; repeatable |
| `--tui-mode <regular\|fullscreen>` | TUI mode (interactive only) |

### Completion checks
| Flag | Meaning |
|------|---------|
| `--completion-check <check>` | Opt-in print/json completion check; only value is `git-committed` |
| `--completion-check-attempts <n>` | Max same-session follow-ups, `1..3`, default `2` |
| `--completion-review` | One print/json task self-review; no Git required |

### Update and misc
| Flag | Meaning |
|------|---------|
| `--update-check` / `--no-update-check` | Toggle the Step binary update check at startup |
| `--context-projection <clm-v1\|lightweight-v1\|off>` | Context projection; default `clm-v1` |
| `--` | End option parsing |
| `-h`, `--help` / `-v`, `--version` | Help / version |

Extension CLI flags exist too (for example `--plan` from the plan-mode extension).

### File and message arguments
```bash
step [options] [--] [@files...] [messages...]
```
`@path` attaches a file (text or image) to the initial message. CLI-side relative
paths (`@file`, `-e`, `--skill`, `--prompt-template`, `--theme`, relative
`--export` output) resolve against `-C <dir>`.

## 5. Top-level subcommands

| Command | Usage |
|---------|-------|
| `step install <source> [-l] [-a\|-na]` | Install a package and add it to settings |
| `step remove <source> [-l] [-a\|-na]` | Remove a package and its source from settings |
| `step uninstall <source> [-l]` | Alias for `remove` |
| `step update [version\|source\|self\|step]` | `--all`, `--extensions`, `--models`, `--self [--force]`, `--extension <src>` |
| `step list` | List installed packages from user and project settings |
| `step config [-l]` | TUI to enable/disable package resources |
| `step config path [--json]` | Print resolved config paths |
| `step config show [--json]` | Print effective config (credentials omitted) |
| `step config init [--scope user\|workspace] [--path <file>] [--force]` | Write a config template |
| `step auth print-api-key [--provider p] [--model m]` | Print a provider API key for an external client |
| `step auth print-bearer-token [--provider p] [--model m] [--min-expiry d]` | Print a refreshed OAuth bearer token |
| `step auth check [--provider p] [--model m] [--json] [--credentials] [--no-refresh]` | Check provider readiness |
| `step login [--no-browser]` / `step login status [--json]` / `step logout` | OAuth sign-in, status, sign-out |
| `step mcp list\|get\|add\|remove\|login\|logout\|prepare` | MCP server management |
| `step feedback [comment] [--category …] [--message …] [--json] …` | Submit feedback |
| `step session-index status\|reindex [--full]\|clear [--json]` | Local session search index |

Full syntax and outputs: [references/sessions-auth-packages.md](references/sessions-auth-packages.md).

## 6. Fastest useful commands

```bash
# One-shot answer
step -p "List all .ts files in src/"

# One-shot with context on stdin
cat README.md | step -p "Summarize this text"

# One-shot with attachments, read-only, in another directory
step -C /repo --tools read,grep,find,ls -p @src/app.ts "Review this file"

# Named one-shot session you can resume later
step --name "release audit" -p "Audit this repository"

# Structured output, final assistant text only
step --mode json -p "Summarize the repo" 2>/dev/null \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const l of d.split("\n")){if(!l.trim())continue;const o=JSON.parse(l);if(o.type==="message_end"&&o.message.role==="assistant")console.log(o.message.content.filter(b=>b.type==="text").map(b=>b.text).join(""))}})'

# Headless, fully unattended, no project trust surprises
step --approval-mode auto --non-interactive-approval allow \
     --non-interactive-denial continue -a -p "Run the test suite and report failures"

# Multi-agent ultracode run from the shell
step -p "ultracode: audit the payment module for race conditions"
```

Ready-made runners live in [scripts/](scripts/):
`step-run.mjs` (one-shot print/JSON with final-text extraction and `--json` summary)
and `step-rpc.mjs` (minimal, spec-compliant RPC client).

## 7. Reference map

| File | Contents |
|------|----------|
| [references/cli-reference.md](references/cli-reference.md) | Every subcommand's help text, verified outputs, and semantics |
| [references/modes-print-json.md](references/modes-print-json.md) | Print mode, stdin merging, JSON event contract, frames, completion checks |
| [references/rpc-protocol.md](references/rpc-protocol.md) | RPC commands, events, extension UI sub-protocol, types, error handling |
| [references/sessions-auth-packages.md](references/sessions-auth-packages.md) | Sessions, resume/fork/clone, auth, login, MCP, packages, session-index, feedback |
| [references/env-settings-paths.md](references/env-settings-paths.md) | Environment variables, settings keys, config paths, project trust |
| [references/recipes.md](references/recipes.md) | Copy-paste recipes: CI, sub-agent backend, RPC clients, ultracode, exports |
| [scripts/step-run.mjs](scripts/step-run.mjs) | One-shot runner with final-text extraction |
| [scripts/step-rpc.mjs](scripts/step-rpc.mjs) | Minimal RPC client (LF-only framing) |

## 8. Sources

- Shipped docs: `~/.stepcode/bin/docs/` (`index.md`, `usage.md`,
  `quickstart.md`, `json.md`, `rpc.md`, `sdk.md`, `sessions.md`, `packages.md`,
  `settings.md`, `skills.md`, `environment-variables.md`, `step-integration.md`,
  `shell-aliases.md`, `docs.json`)
- Live verification: `step --help`, every `<subcommand> --help`, `step -v`,
  `step config path|show`, `step login status --json`, `step auth check --json`,
  `step list`, `step mcp list|get`, `step session-index status|reindex --json`,
  and real `step -p`, `step --mode json -p`, and `step --mode rpc` runs.
