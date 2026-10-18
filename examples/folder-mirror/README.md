# Folder mirror

Build the workspace with `npm run build`, then run:

```sh
node examples/folder-mirror --key '<key>' --dir ./mirror --once
```

Use a folder connection key from a compatible protocol 2 server. The directory
is created if needed. Existing files are synchronized both ways, with the core's
conflict and delete guards. The command prints a sync report and closes the
replica in a `finally` block. Its `.abele-sync` directory stores local state,
credentials and the process lock. Do not share or synchronize that directory.

`--help` prints usage without connecting. A missing argument or failed sync exits
with status 1. Files still being written may need a later invocation.
