# Folder mirror

Build the workspace with `npm run build`, then run:

```sh
node examples/folder-mirror --key '<key>' --dir ./mirror --once
node examples/folder-mirror --key '<key>' --dir ./mirror --watch
```

Use a folder or group connection key from a compatible protocol 2 server.
Optional `--state-dir ./private-state`
keeps configuration and the ledger outside the mirror; temporary staging/locks
still use `.abele-sync` inside it. Reopen the same pair to resume.
The directory is created if needed. Existing files are synchronized both ways, with the core's
conflict and delete guards. The command prints a sync report and closes the
replica in a `finally` block. By default its `.abele-sync` directory stores local state,
credentials and the process lock. Do not share or synchronize that directory.

`--help` prints usage without connecting. A missing argument or failed sync exits
with status 1. Files still being written may need a later invocation.

`--watch` keeps syncing local edits and server events, prints status and applied
changes, and closes the replica on Ctrl-C or SIGTERM. Choose exactly one mode.
