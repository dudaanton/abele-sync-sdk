Run `npx vitest run test/fake --maxWorkers=2`. These tests use loopback HTTP,
Node's built-in WebSocket client and a minimal server-side WebSocket handshake
and text-frame encoder (no additional dependencies). The peer implements only
the v2 routes exercised here, including uploaded file creation and range reads;
it is not a replacement for the Docker compatibility suite.

Vitest controls scheduler timers; real short waits let loopback I/O settle.
Coverage includes compatibility validation, revocation, sanitized errors,
bounded retry scheduling, reconnect catch-up and duplicate/older event cursors.
The 5xx retry guarantee is recorded as `it.fails` with a `BUG:` title: core
classifies HTTP 5xx as a permanent error instead of scheduling an offline retry.
Another `BUG:` test records that `open()` propagates the server's connection
error message verbatim, exposing secrets if the peer echoes them. Runtime sync
events and status are sanitized; the opening handshake is not.
