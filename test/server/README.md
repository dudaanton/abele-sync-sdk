# Disposable server tests

Use Node.js 22 or newer with dependencies installed (`npm ci`). Allow Docker
access, loopback HTTP/WebSocket traffic and writes to `.cache` in the repository.
Build the workspace and create the temporary-directory parent before running:

```sh
npm run build
mkdir -p .cache
npm run test:server
```

The harness starts
`ghcr.io/dudaanton/abele-sync:<tag>` with SQLite and random independent encryption
and token secrets, publishes a random loopback port, waits for capabilities, then
runs the image's admin CLI to create a vault and two folder connection keys.
No host data directory is mounted. Cleanup removes the container, clients and
temporary replica directories on both success and failure.

The tag comes from `ABELE_SYNC_IMAGE_TAG`, defaulting to the first `servers`
entry in the root `compat.json`. CI runs each listed tag in an independent
Ubuntu Docker job. Only protocol 2 is supported; the current list is `0.3.3`.
To add a tag, first run `docker manifest inspect ghcr.io/dudaanton/abele-sync:<tag>`,
confirm `/capabilities` advertises protocol 2, then run
`ABELE_SYNC_IMAGE_TAG=<tag> npm run test:server` with Docker available. Add the
tag to `compat.json` only after the full server suite passes. An image manifest
alone does not establish protocol compatibility.

The tests cover bidirectional convergence with Memory adapters and Node folder
replicas, socket delivery before fallback polling, and admin CLI revocation with
a single notification. They also cover version and deleted-file restoration,
held-delete confirmation, self-revocation, and Node disconnect cleanup that keeps
files, forgets owned state and refuses unsafe state directories. Node convergence
checks that reopening with external state avoids downloading unchanged content.

Node replica tests need permission to read the system uptime for the core lock's
boot identity. Sandboxes denying that call fail with `uv_uptime returned EPERM`;
run those tests in an environment granting that permission.

To run only the Memory convergence and live-delivery cases (without the Node
replica uptime requirement):

```sh
npm run test:server -- -t 'two Memory'
npm run test:server -- -t 'delivers live'
```
