# Sessions, auth, packages, MCP, index, feedback

## Session storage

Sessions auto-save to `~/.stepcode/agent/sessions/<encoded-cwd>/`, one JSONL file
per session with a tree structure. Each entry has an `id` and `parentId`; the
current position is the active leaf. Files contain message entries, model changes,
thinking-level changes, labels, compactions, branch summaries and extension
entries.

```bash
step -c                  # Continue most recent session
step -r                  # Browse and select a session
step --no-session        # Ephemeral mode; do not save
step --name "my task"    # Set session display name at startup
step --session <path|id> # Use a specific session file or partial UUID
step --session-id <id>   # Use exact project session ID, creating it if missing
step --fork <path|id>    # Fork a session file or partial UUID into a new session
step --session-dir <dir> # Custom session storage directory
```

`-r` with no value opens the same picker as `/resume`. In the picker: type to
search, Ctrl+P toggles paths, Ctrl+S toggles sort, Ctrl+N filters named sessions,
Ctrl+R renames, Ctrl+D deletes (with confirmation, using the `trash` CLI when
available).

### `-C` / `--cwd` interaction with session flags

- New sessions and `-c` / `--continue` start in `<dir>`; `--continue` looks for
  the most recent session of `<dir>`.
- `--fork <path|id>` forks into `<dir>`.
- `--session <path>` / `--session <id>` opens the session as-is: the cwd stored in
  the session header wins, and `-C` applies only if that directory no longer
  exists (you are then prompted to pick one). A session id found under a different
  project is offered for forking into `<dir>`.
- `--session-dir` is orthogonal: it relocates storage, not work. A relative
  `--session-dir` resolves against the launcher's directory.

A nonexistent `-C` path, or a path that is not a directory, fails fast with exit
code 1.

### Tree, fork, clone

| Feature | `/tree` | `/fork` | `/clone` |
|---------|---------|---------|----------|
| Output | Same session file | New session file | New session file |
| View | Full tree | User-message selector | Current active branch |
| Typical use | Explore alternatives in place | Start a new session from an earlier prompt | Duplicate current work before continuing |
| Summary | Optional branch summary | None | None |

RPC equivalents: `get_tree`, `get_entries`, `get_fork_messages`, `fork`,
`clone`, `switch_session`, `new_session`. SDK: `session.navigateTree()` and the
`AgentSessionRuntime` replacement APIs (`newSession`, `switchSession`, `fork`,
clone via `fork(entryId, {position:"at"})`, `importFromJsonl`).

### Export

```bash
step --export session.jsonl                # writes session.html next to it
step --export session.jsonl output.html    # explicit output
step --export ~/.stepcode/agent/sessions/--path--/session.jsonl
```

RPC `export_html {outputPath?}` returns the written path. Interactive `/export`
writes HTML or JSONL; `/share` uploads a private GitHub gist with a shareable
HTML link.

## Auth and credentials

```bash
step auth print-api-key     [--provider <p>] [--model <m>]
step auth print-bearer-token [--provider <p>] [--model <m>] [--min-expiry <d>]
step auth check             [--provider <p>] [--model <m>] [--json] [--credentials] [--no-refresh]
step login [--no-browser]
step login status [--json]
step logout
```

At least one of `--provider` or `--model` is required. `check` refreshes expired
OAuth credentials by default; `--no-refresh` prevents that. `--credentials`
emits the credential or includes it in JSON output.

Verified: `step auth check --provider step --json` →
`{"status":"ready","provider":"step","authType":"oauth"}`;
`step login status --json` →
`{"loggedIn":true,"loginMethod":"step_plan","profile":"step_plan","account":"…","session":{"state":"expiring"},"validity":"valid"}`.

Credential resolution priority (SDK `ModelRuntime`):

1. Runtime overrides (`setRuntimeApiKey`, not persisted)
2. Stored credentials in `auth.json` (API keys or OAuth tokens)
3. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...)
4. Fallback resolver (custom provider keys from `models.json`)

Login profiles (each owns its endpoint and env overrides):

| Profile | Credential | Model base URL | Login page | Overrides |
|---------|-----------|----------------|------------|-----------|
| `step_plan` | browser | `https://api.stepfun.com/step_plan` | `https://platform.stepfun.com` | `STEPCODE_STEP_PLAN_API_URL`, `STEPCODE_DEVCENTER_AUTH_CN_URL` |
| `step_plan_oversea` | browser | `https://api.stepfun.ai/step_plan` | `https://platform.stepfun.ai` | `STEPCODE_STEP_PLAN_API_URL_OVERSEA`, `STEPCODE_DEVCENTER_AUTH_OVERSEA_URL` |
| `platform_cn` | API key | `https://api.stepfun.com/v1` | `https://platform.stepfun.com/interface-key` | `STEPCODE_PLATFORM_API_URL`, `STEPCODE_PLATFORM_AUTH_URL` |
| `platform_oversea` | API key | `https://api.stepfun.ai/v1` | `https://api.stepfun.ai/interface-key` | `STEPCODE_PLATFORM_API_URL_OVERSEA`, `STEPCODE_DEVCENTER_AUTH_OVERSEA_URL` |

The chosen profile is stored in `auth.json` next to the credential and is the
single source of region afterwards. `step login status` validates against that
profile's `/v1/models`. The built-in Step provider uses the `anthropic-messages`
adapter, which appends `/v1/messages` to the configured base URL, so the canonical
Step base is `https://api.stepfun.com/step_plan`. `STEP_BASE_URL` also accepts the
older `.../v1` and `.../v1/messages` spellings and normalizes them.

`STEP_API_KEY` is deliberately **excluded** from the `search_web` credential
chain: StepCode injects it with `STEP_BASE_URL` for its own model gateway, and
the search endpoint never follows that base URL.

## MCP

```
step mcp list
step mcp get <name>
step mcp add <name> --url <url> [--bearer-token-env-var VAR]
step mcp add <name> [--env KEY=VALUE]... -- <command> [args...]
step mcp remove <name>
step mcp login|logout <http-server-name>
step mcp prepare
```

Servers live in `config.toml` under `mcp_servers`, either as
`{url, http_headers?}` or `{command, args?, env?}`. Verified:

```
$ step mcp list
web-search: https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp
markitdown: D:\Tools\python312\python.exe

$ step mcp get web-search
web-search: https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp
```

The Step tool profile also registers `search_web`, backed by the remote
`stepsearch.web_search` Streamable HTTP MCP tool. Its credential resolves from an
explicit `step --api-key`, then `STEPCODE_SEARCH_API_KEY`, then the Step login
entry in `auth.json`, and is sent only as a Bearer header. Endpoints are
profile-based (see the table above) because the endpoint decides which account is
billed; `STEPCODE_SEARCH_WEB_MCP_URL` overrides the selection, and an override
that supplies only an origin keeps the profile's own path.

## Packages

```bash
step install npm:@foo/bar@1.0.0
step install git:github.com/user/repo@v1
step install https://github.com/user/repo
step install /absolute/path/to/package
step install ./relative/path/to/package
step install <source> -l          # project-local (.stepcode/config.toml)

step remove npm:@foo/bar
step uninstall npm:@foo/bar       # alias

step list
step update [version|--all|--extensions|--models|--self [--force]|--extension <src>]
step config [-l]                  # interactive resource enable/disable TUI
step -e npm:@foo/bar              # try without installing (temp dir, this run only)
```

Sources: `npm:pkg[@version]`, `git:github.com/user/repo@ref`,
`git:git@github.com:user/repo@ref`, protocol URLs (`https://`, `http://`,
`ssh://`, `git://`), and local paths. Versioned npm specs and git refs are pinned:
`step update --extensions` / `--all` do not move them, but do reconcile an
existing clone to the configured ref. Move a pinned ref with
`step install git:host/user/repo@new-ref`.

Storage: user npm → `~/.stepcode/agent/npm/`, project npm → `.stepcode/npm/`,
git clones → `~/.stepcode/agent/git/<host>/<path>` or
`.stepcode/git/<host>/<path>`. Reconciliation resets and cleans the clone, then
runs `npm install` when a `package.json` exists.

Set `npmCommand` in `settings.json` to pin npm operations to a wrapper, e.g.
`{"npmCommand": ["mise", "exec", "node@20", "--", "npm"]}`.

A package declares resources in `package.json` under the `pi` key (legacy name,
still read as-is; discovery keyword is `pi-package`):

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"],
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

Without a manifest, conventional directories are auto-discovered:
`extensions/` (`.ts`, `.js`), `skills/` (recursive `SKILL.md` folders plus
top-level `.md`), `prompts/` (`.md`), `themes/` (`.json`).

Filtering with the object form in settings:

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-pkg",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

Omit a key to load all of that type; `[]` loads none; `!pattern` excludes;
`+path` force-includes an exact path; `-path` force-excludes. Filters narrow what
the manifest already allows.

Scope and dedup: a package in both global and project settings - the project
entry wins unless it has `autoload: false`, in which case it is applied as a delta
over the global entry. Identity: npm → package name, git → repo URL without ref,
local → resolved absolute path.

Bundled core packages for extensions/skills that must go in
`peerDependencies` with `"*"` and must not be bundled:
`@step-harness/providers`, `@step-harness/agent-core`,
`@step-harness/coding-agent`, `@step-harness/pi-tui`, `typebox`. Other step
packages must be bundled in the tarball (`dependencies` + `bundledDependencies`)
and referenced through `node_modules/` paths.

## Session index

```bash
step session-index status [--json]
step session-index reindex [--full] [--json]
step session-index clear
```

The index is a derived SQLite database. Session files are never modified and the
index can be deleted and rebuilt at any time. On a runtime without `node:sqlite`
the index is `degraded` and searches scan session files directly.

## Feedback

```bash
step feedback "comment text" --category bug --json
step feedback --message "..." --category bad-result --session <id-or-path>
step feedback --no-diagnostics --no-session-bundle --message "..."
step feedback --retry
```

Categories: `bug`, `bad-result`, `good-result`, `safety-check`, `other`.
Diagnostics (a bounded log excerpt) and a conversation archive are attached by
default. Delivery is two requests sharing one client-generated `feedbackId`:
the JSON body first, then an optional gzip session bundle after attachment
consent; a bundle failure does not fail an accepted body. `--retry` converges
retryable failures; permanent 4xx rejections (e.g. oversized bundle) require
changing the report or archive before resubmission.
