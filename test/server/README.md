# Disposable server tests

Run `npm run test:server` with Docker available. The harness starts
`ghcr.io/dudaanton/abele-sync:<tag>` with SQLite and random independent encryption
and token secrets, publishes a random loopback port, waits for capabilities, then
runs the image's admin CLI to create a vault and two folder connection keys.
No host data directory is mounted. Cleanup removes the container, clients and
temporary replica directories on both success and failure.

The tag comes from `ABELE_SYNC_IMAGE_TAG`, defaulting to the first `servers`
entry in the root `compat.json`. CI runs each listed tag in an independent
Ubuntu Docker job. Only protocol 2 is supported; the current list is `0.3.3`.
Earlier image manifests could not be inspected in the development sandbox.
To add a tag, first run `docker manifest inspect ghcr.io/dudaanton/abele-sync:<tag>`,
confirm `/capabilities` advertises protocol 2, then run
`ABELE_SYNC_IMAGE_TAG=<tag> npm run test:server` with Docker available. Add the
tag to `compat.json` only after the full server suite passes. An image manifest
alone does not establish protocol compatibility.

The tests cover bidirectional convergence with Memory adapters and Node folder
replicas, socket delivery before fallback polling, and admin CLI revocation with
a single notification and halted retries. Node replica tests need permission to read
the system uptime for the core lock's boot identity. Sandboxes denying that call
fail with `uv_uptime returned EPERM`; rerun outside that sandbox:

```sh
npm run build
npm run test:server
```

To run only the real-server Memory case in that sandbox:

```sh
npm run test:server -- -t 'two Memory'
npm run test:server -- -t 'delivers live'
```
