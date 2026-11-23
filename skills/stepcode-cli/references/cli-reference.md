# CLI reference (verified)

Everything below was executed against the installed StepCode build `0.1.7`
(`%USERPROFILE%\.stepcode\bin\step.exe`) or read from its shipped docs.

## Root help

```
step - AI coding assistant with read, bash, edit, write tools

Usage:
  step [options] [--] [@files...] [messages...]

Commands:
  step install <source> [-l]     Install extension source and add to settings
  step remove <source> [-l]      Remove extension source from settings
  step uninstall <source> [-l]   Alias for remove
  step update [source|self|step] Update step, extensions, or model catalogs
  step list                      List installed extensions from settings
  step config [-l]               Open TUI to enable/disable package resources
  step auth <command>            Print credentials or check provider readiness
  step login                     Sign in with the Step account (OAuth)
  step logout                    Remove the stored Step credential
  step <command> --help          Show help for install/remove/uninstall/update/list/config/auth
```

Additional top-level subcommands discovered by probing the binary:
`mcp`, `feedback`, `session-index`.

## install

```
Usage:
  step install <source> [-l] [--approve|--no-approve]

Install a package and add it to settings.

Options:
  -l, --local       Install project-locally (.stepcode/config.toml)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  step install npm:@foo/bar
  step install git:github.com/user/repo
  step install git:git@github.com:user/repo
  step install https://github.com/user/repo
  step install ssh://git@github.com/user/repo
  step install ./local/path
```

Accepted source forms (from `packages.md`):

- npm: `npm:pkg`, `npm:@scope/pkg@1.2.3` (versioned specs are pinned and skipped
  by `step update --extensions` / `--all`).
- git with `git:` prefix: `git:github.com/user/repo@v1`,
  `git:git@github.com:user/repo@v1`.
- Protocol URLs without a prefix: `https://`, `http://`, `ssh://`, `git://`.
- Local absolute or relative path. A file loads as a single extension; a
  directory loads resources by package rules. Relative paths resolve against the
  settings file they appear in.

User installs land in `~/.stepcode/agent/npm/`; project installs (`-l`) in
`.stepcode/npm/`. Git clones land in `~/.stepcode/agent/git/<host>/<path>` or
`.stepcode/git/<host>/<path>`.

To try without installing: `step -e npm:@foo/bar` / `step -e git:github.com/user/repo`
(staged into a temp dir for that run only).

CI note: set `GIT_TERMINAL_PROMPT=0` and
`GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=5"` to fail fast instead
of prompting for credentials.

## remove / uninstall

```
Usage:
  step remove <source> [-l] [--approve|--no-approve]

Remove a package and its source from settings.
Alias: step uninstall <source> [-l]
```

## update

```
Usage: step update [version]
```

Flag variants documented in `packages.md`:

| Invocation | Effect |
|-------------|--------|
| `step update` | Update step only |
| `step update --self` | Update step only |
| `step update --self --force` | Reinstall step even if current (unsupported for installer-managed installs) |
| `step update --all` | Update step, update packages, reconcile pinned git refs |
| `step update --extensions` | Update packages and reconcile pinned git refs only |
| `step update --models` | Refresh model catalogs only |
| `step update npm:@foo/bar` | Update one package |
| `step update --extension npm:@foo/bar` | Update one package |

`step update` never prompts for project trust. Managed (installer-backed)
installations stage into a lockfile-backed release and activate only after
verification; the current release stays intact if the update fails.

To uninstall step itself use the package manager that installed it:
`npm uninstall -g @step-harness/coding-agent` (or `pnpm remove -g`, `yarn global
remove`, `bun uninstall -g`). Uninstalling leaves settings, credentials, sessions
and installed packages under `~/.stepcode/agent/`.

## list

```
Usage:
  step list [--approve|--no-approve]

List installed packages from user and project settings.
```

Verified output shape:

```
User packages:
  npm:@dietrichgebert/ponytail
    %USERPROFILE%\.stepcode\agent\npm\node_modules\@dietrichgebert\ponytail
  git:github.com/obra/superpowers
    %USERPROFILE%\.stepcode\agent\git\github.com\obra\superpowers
```

## config

```
Usage:
  step config [-l] [--approve|--no-approve]

Open the resource configuration TUI to enable or disable package resources.
Without -l, starts in global settings (~/.stepcode/config.toml).
Press Tab in the TUI to switch between global and project-local modes.

Subcommands:
  path   Print the resolved Step config file paths.
  show   Print the effective Step config (credentials omitted).
  init   Write a Step config template (--scope, --path, --force).
```

`config` is interactive - use `path` / `show` / `init` in automation.

```
step config path [--json]
step config show [--json]
step config init [--scope user|workspace] [--path <file>] [--force]
```

Verified `step config path` (text) on this machine:

```
global: %USERPROFILE%\.stepcode\agent
global settings: %USERPROFILE%\.stepcode\config.toml
global models: %USERPROFILE%\.stepcode\models.json
global auth: %USERPROFILE%\.stepcode\auth.json
workspace: D:\gongzuoqu\stepworkspace\.stepcode
workspace settings: D:\gongzuoqu\stepworkspace\.stepcode\config.toml
existing: %USERPROFILE%\.stepcode\agent, %USERPROFILE%\.stepcode\config.toml, %USERPROFILE%\.stepcode\auth.json
```

`config path --json` keys: `globalAgentDir`, `globalSettingsPath`,
`globalModelsPath`, `globalAuthPath`, `workspaceConfigDir`,
`workspaceSettingsPath`, `existingPaths`.

`config show --json` keys: `paths` (`agentDir`, `globalSettings`, `globalModels`,
`globalAuth`, `projectDir`, `projectSettings`), `globalSettings`, `auth`
(`configured`, ...), plus project settings when present. **Treat its output as
sensitive**: credentials are omitted, but MCP server entries can carry
`http_headers` such as `Authorization`, so do not log it verbatim.

`step config init` writes a template; `--scope user` (default) or `workspace`,
`--path <file>` to choose the target, `--force` to overwrite.

## auth

```
Usage:
  step auth print-api-key [--provider <provider>] [--model <model>]
  step auth print-bearer-token [--provider <provider>] [--model <model>] [--min-expiry <duration>]
  step auth check [--provider <provider>] [--model <model>] [--json] [--credentials] [--no-refresh]

Auth commands require at least one of --provider or --model. Checks refresh
expired OAuth credentials by default; --no-refresh prevents this. --credentials
emits the credential, or includes it in JSON output.
```

Verified:

```
$ step auth check --provider step --json
{"status":"ready","provider":"step","authType":"oauth"}
$ step auth check
ready
```

`print-api-key` / `print-bearer-token` exist to hand a credential to an external
client; the bearer token refreshes when expired. Never print these into logs.

## login / logout

```
step login [--no-browser]
step login status [--json]
step logout
```

Verified:

```
$ step login status
Signed in as 421163413353947136.
Login method: Step Plan.
Validity: check passed.
Account session: expiring; it refreshes on next use.

$ step login status --json
{"loggedIn":true,"loginMethod":"step_plan","profile":"step_plan","account":"421163413353947136","session":{"state":"expiring"},"validity":"valid"}
```

`--no-browser` prints the URL instead of opening a browser (for SSH/headless
boxes). `logout` removes the stored credential.

## mcp

```
Usage: step mcp list|get|add|remove|login|logout|prepare
Usage: step mcp add <name> --url <url> [--bearer-token-env-var VAR] | [--env KEY=VALUE]... -- <command> [args...]
Usage: step mcp remove <name>
Usage: step mcp login|logout <http-server-name>
Usage: step mcp prepare
```

`mcp list` prints configured servers (`name: url-or-command`).
`mcp get <name>` prints one server. `mcp prepare` readies servers without starting
a session. MCP servers are configured in `config.toml` under `mcp_servers`, with
either `url` (+ optional `http_headers`) or `command` + `args` (+ optional `env`).

## feedback

```
Usage: step feedback [comment] [options]

Options:
  --category <name>       bug, bad-result, good-result, safety-check, other
  --message <text>        Feedback comment
  --no-diagnostics        Send without the log excerpt (attached by default)
  --no-session-bundle     Send without the conversation archive (attached by default)
  --session <id-or-path>  Session to archive
  --retry                 Retry locally pending feedback
  --json                  Emit JSON only on stdout
  -h, --help              Show this help
```

Feedback is user-initiated and gated by `feedbackEnabled` in the Step config;
submitting it produces no telemetry event. Delivery is two requests sharing a
client-generated `feedbackId` (JSON body, then an optional gzip session bundle);
`--retry` converges retryable failures.

## session-index

```
Usage: step session-index <command> [options]

Manage the local session search index. Session files are never modified;
the index can be deleted and rebuilt at any time.

Commands:
  status            Show index state and coverage
  reindex [--full]  Index new and changed sessions (--full rebuilds everything)
  clear             Delete the index database

Options:
  --json            Print machine-readable output (status, reindex)
```

Verified on this machine the index is `degraded` because the runtime lacks
`node:sqlite`; searches then fall back to scanning session files.

## export

`--export` is a startup flag, not a subcommand:

```bash
step --export session.jsonl                # writes session.html next to it
step --export session.jsonl output.html    # explicit output path
step --export ~/.stepcode/agent/sessions/--path--/session.jsonl
```

A missing value fails with `Error: --export requires a value`. Relative output
paths resolve against `-C <dir>`.

## list-models

```bash
step --list-models            # table: provider, model, context, max-out, thinking, images
step --list-models flash      # fuzzy search
```

## Exit codes and failure modes

| Situation | Behaviour |
|-----------|-----------|
| Success | exit `0` |
| `-C <dir>` missing or not a directory | fails fast, exit `1` |
| `--export` without a value | error, exit non-zero |
| Unknown subcommand / bad flag | usage error on stderr, exit non-zero |
| Model/provider error mid-run | reported on the assistant message `stopReason`, and on `agent_settled.failure` when the run produced no usable answer |
