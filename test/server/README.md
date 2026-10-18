# Disposable server tests

Run `npm run test:server` with Docker available. The harness starts
`ghcr.io/dudaanton/abele-sync:0.3.3` with SQLite and random independent encryption
and token secrets, publishes a random loopback port, waits for capabilities, then
runs the image's admin CLI to create a vault and two folder connection keys.
No host data directory is mounted. Cleanup removes the container, clients and
temporary replica directories on both success and failure.

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
