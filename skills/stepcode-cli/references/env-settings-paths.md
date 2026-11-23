# Environment, settings, paths, trust

## Environment variables

| Variable | Description |
|----------|-------------|
| `STEP_CODING_AGENT_DIR` | Config directory; default `~/.stepcode/agent` |
| `STEP_CODING_AGENT_SESSION_DIR` | Session storage directory; `--session-dir` takes precedence |
| `STEP_CODING_AGENT_PLAN_DIR` | Directory for newly selected native Markdown plan paths; defaults to `<cwd>/.stepcode/plans` |
| `STEP_PROVIDER` | Default provider for the step entrypoint |
| `STEP_MODEL` | Default model for the step entrypoint |
| `STEP_API_KEY` | API key for the Step provider |
| `STEP_BASE_URL` | Step provider API base URL |
| `STEPCODE_DEFAULT_THEME` | Default interactive theme |
| `STEPCODE_DISABLE_PI_SERVICES` | Disable upstream update/catalog services (enabled by step) |
| `STEP_PERMISSION_PRESET` | Permission tier: `ask`, `approve-for-me`, `full-access` |
| `STEP_APPROVAL_MODE` | Default tool approval mode: `confirm` or `auto` |
| `STEP_NON_INTERACTIVE_APPROVAL` | Fallback when no approval UI: `allow` or `deny` |
| `STEP_NON_INTERACTIVE_DENIAL` | Blocked call without a UI: `terminate` or `continue` |
| `STEP_AUTOPILOT` | Retired tier selector; resets to Ask |
| `STEP_AUTO_RESUME` | Model-error continuation override (`1` on, `0` off) |
| `STEPCODE_SEARCH_API_KEY` | Credential for the `search_web` tool |
| `STEPCODE_SEARCH_WEB_MCP_URL` | Override for the `search_web` MCP endpoint |
| `STEPCODE_STEP_PLAN_API_URL` / `..._OVERSEA_URL` | Step Plan model base URL overrides |
| `STEPCODE_PLATFORM_API_URL` / `..._OVERSEA_URL` | Platform model base URL overrides |
| `STEPCODE_DEVCENTER_AUTH_CN_URL` / `..._OVERSEA_URL` | Developer-center login page overrides |
| `STEPCODE_TELEMETRY_ENDPOINT` | Explicit telemetry collector override |
| `STEPCODE_INTERNAL_PROVIDER_HOSTS` | Internal gateway host list |
| `STEPCODE_USAGE_TELEMETRY` / `STEPCODE_USAGE_TELEMETRY_CONFIG` | Telemetry config (JSON inline / file path) |
| `STEPCODE_DISABLE_TELEMETRY` | Opt out of telemetry |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |
| `GIT_TERMINAL_PROMPT`, `GIT_SSH_COMMAND` | Git credential behavior for package installs in CI |

Retired `STEP_PERMISSION_PRESET` values (`bypass`, `autopilot`, `read-only`) reset
to `ask`; `full-access` requires risk acknowledgment. Retired
`STEP_APPROVAL_MODE` value `strict` maps to `confirm`.

The CLI sets `AI_AGENT=step`; child processes inherit it and the ordinary shell
environment. Shell tools do **not** inject session IDs, transcript paths, model
IDs or reasoning levels into command environments. Custom shell tools can adjust
the environment through `spawnHook`.

## Project trust (non-interactive)

On interactive startup, step asks before trusting a project folder that contains
project-local settings, resources, or project `.agents/skills` / `.claude/skills`
and has no saved decision for the folder or a parent in
`~/.stepcode/agent/trust.json`.

Non-interactive modes (`-p`, `--mode json`, `--mode rpc`) **never** show a trust
prompt. Without a saved decision they use `defaultProjectTrust` from global
settings:

| Value | Behavior |
|-------|----------|
| `ask` (default) | Ignore project resources |
| `always` | Trust them |
| `never` | Ignore project resources |

Override for one run with `-a` / `--approve` (trust) or `-na` / `--no-approve`
(ignore). Before a trust decision, only context files, user/global extensions and
CLI `-e` extensions load. `step config` and package commands use the same flow;
`step update` never prompts. `/trust` in interactive mode writes
`~/.stepcode/agent/trust.json` only and needs a restart to take effect.

## Settings files

- Global: `~/.stepcode/agent/settings.json`
- Project: `<cwd>/.stepcode/settings.json`
- Step product policy (permissions, telemetry): `~/.stepcode/config.toml` and
  `<cwd>/.stepcode/config.toml`, global-then-project precedence with file locking

Discover them programmatically:

```bash
step config path [--json]
step config show [--json]     # credentials omitted, but treat output as sensitive
```

Windows paths in JSON settings must use forward slashes or escaped backslashes.

### Settings keys relevant to headless runs

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `defaultProjectTrust` | string | `"ask"` | Fallback project trust: `ask`, `always`, `never`. Global only |
| `npmCommand` | string[] | - | Command argv for npm lookup/install operations |
| `shellPath` | string | - | Custom shell path |
| `shellCommandPrefix` | string | - | Prefix for every bash command |
| `externalEditor` | string | `$VISUAL` → `$EDITOR` → Notepad/nano | Ctrl+G editor |
| `quietStartup` | boolean | `false` | Hide the startup header |
| `collapseChangelog` | boolean | `false` | Condensed changelog after updates |
| `enableAnalytics` | boolean | `false` | Opt-in analytics sharing |
| `steeringMode` / `followUpMode` | string | `one-at-a-time` | Queue delivery |
| `images.blockImages` | boolean | `false` | Block all images from being sent to the LLM |
| `skills` | string[] | - | Extra skill files or directories |
| `enableSkillCommands` | boolean | `true` | Register skills as `/skill:name` commands |
| `packages` | (string \| object)[] | - | Installed packages with optional filters |
| `treeFilterMode` | string | - | Default `/tree` filter mode |

Enable shell aliases in headless runs (bash runs non-interactively and does not
expand aliases by default):

```json
{"shellCommandPrefix": "shopt -s expand_aliases\neval \"$(grep '^alias ' ~/.zshrc)\""}
```

## Resource discovery

`cwd` drives project extensions (`.stepcode/extensions/`), project skills
(`.stepcode/skills/`, `.agents/skills/`, `.claude/skills/` in cwd and ancestors up
to the git root or filesystem root), project prompts (`.stepcode/prompts/`), and
context files (`AGENTS.md` walking up from cwd).

`agentDir` (default `~/.stepcode/agent`) drives global extensions, global skills
(`skills/`, `~/.stepcode/skills/`, `~/.agents/skills/`, `~/.claude/skills/`),
global prompts, the global context file, `settings.json`, `models.json`,
`auth.json` and `sessions/`.

Disable discovery with `--no-extensions` / `-ne`, `--no-skills` / `-ns`,
`--no-prompt-templates` / `-np`, `--no-themes`, `--no-context-files` / `-nc`.
Combine with explicit flags to load exactly what you need:

```bash
step --no-extensions -e ./my-extension.ts
step --no-skills --skill ./my-skill/SKILL.md
```

## Context files and system prompts

Loaded from `~/.stepcode/agent/AGENTS.md`, parent directories walking up from cwd,
and the current directory. `AGENTS.override.md` replaces `AGENTS.md`/`CLAUDE.md`
in that directory. System prompt files: `.stepcode/SYSTEM.md` (project) and
`~/.stepcode/agent/SYSTEM.md` (global) replace the default;
`APPEND_SYSTEM.md` in either location appends. `--system-prompt` replaces and
`--append-system-prompt` appends from the CLI.

## Telemetry

Off unless a collector is configured (there is no built-in default). Precedence,
highest first: `STEPCODE_TELEMETRY_ENDPOINT` /
`STEPCODE_INTERNAL_PROVIDER_HOSTS`, then `STEPCODE_USAGE_TELEMETRY` (JSON) or
`STEPCODE_USAGE_TELEMETRY_CONFIG` (YAML/JSON file), then `config.toml`
`[telemetry] endpoint` (release builds), then the embedded build config, then the
legacy `STEPCODE_BUILD_INTERNAL_PROVIDER_HOSTS`. Opt out with
`STEPCODE_DISABLE_TELEMETRY` or `config.toml` `[telemetry] enabled = false`.
Prompts, responses, tool arguments and API keys are never reported.

The Step entrypoint mirrors stderr to `<storage-root>/logs/dev-YYYY-MM-DD.log`
(0700 dirs, 0600 files, seven local calendar days retained). It is a developer
log and may contain user text and file paths.

## Node SDK

```typescript
import { createAgentSession, ModelRuntime, SessionManager } from "@step-harness/coding-agent";

const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

Key API: `session.prompt(text, options?)`, `steer()`, `followUp()`, `subscribe()`,
`setModel()`, `setThinkingLevel()`, `cycleModel()`, `cycleThinkingLevel()`,
`navigateTree()`, `compact()`, `abortCompaction()`, `abort()`, `dispose()`.
Session replacement (`newSession`, `switchSession`, `fork`, clone, `importFromJsonl`)
lives on `AgentSessionRuntime`; re-subscribe after replacement.

`PromptOptions`: `{expandPromptTemplates?, images?, streamingBehavior?: "steer" | "followUp", source?, preflightResult?}`.
`preflightResult` fires once per `prompt()`: `true` for accepted/queued/handled,
`false` for preflight rejection. `prompt()` resolves only after the full accepted
run finishes, including retries.

Model runtime: `ModelRuntime.create({allowModelNetwork, modelRefreshTimeoutMs})`,
`getModel(provider, id)`, `getAvailable()`, `refresh({providers, signal})`,
`setRuntimeApiKey()`, `checkAuth(provider.id)`. Remote catalogs persist to
`~/.stepcode/agent/models-store.json` and refresh at most once per provider every
four hours unless forced.

`--sdk-stdio` runs the length-prefixed stdio host. Its handshake advertises
`streaming-input`, `sdk-tools`, `permission-callback`, `hooks` and `sessions`.
Partial text events are emitted only when `includePartialMessages` is enabled;
final assistant and tool-result events always come from the runtime session event
stream. Unsupported query options are reported in the init message instead of
being silently ignored.
