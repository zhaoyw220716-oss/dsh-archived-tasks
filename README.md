# dsh-archived-tasks — Archived Tasks for DeepSeek Harness

English | [中文](README.zh.md)

> A DeepSeek Harness Web GUI plugin that adds an **Archived Tasks** settings
> page: list every archived session and restore it, or permanently delete its
> log files and registry references in one click.

## Install

Published on npm, installs as a profile bundle with a single command:

```sh
dsh plugin --profile web add dsh-archived-tasks
```

After installing, **restart `dsh web`**, then open **Settings → Archived Tasks**
(设置 → 已归档任务).

To remove:

```sh
dsh plugin --profile web remove dsh-archived-tasks
```

## What it does

The settings section lists sessions in the workspace registry's archived set:

- **恢复 (Restore)** — removes the session id from the registry's
  `archivedSessionIds` set; the session log and workspace accounting are kept.
- **删除 (Delete)** — destructive and irreversible. It `rm -rf`s the session
  log directory under `data/sessions`, drops the id from the archived set,
  detaches the in-memory session, and removes the id from every workspace's
  accounting list.

The delete route is intentionally guarded:

- POST only, same-origin requests only (light CSRF check on the Origin header).
- The session id must match `^session-[0-9a-f-]+$` — no path traversal.
- The resolved session path must sit exactly one level under
  `data/sessions/<encoded-cwd>/` before anything is removed.
- `dataRoot` resolution: `config.dataRoot` → `$DSH_DATA_ROOT` → `$DSH_HOME` →
  automatic walk-up from the module location (works for both the local vendor
  layout and a published npm install).

## Development

```sh
# local link install (from this checkout)
dsh plugin --profile web add link:$(pwd)

# publish a new version
npm publish --access public
```

## License

Apache-2.0
