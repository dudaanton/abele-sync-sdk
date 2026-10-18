Run `npx vitest run test/fake --maxWorkers=2`. These tests use loopback HTTP,
Node's built-in WebSocket client and a minimal server-side WebSocket handshake
and text-frame encoder (no additional dependencies). The peer implements only
the v2 routes exercised here, including uploaded file creation and range reads;
it is not a replacement for the Docker compatibility suite.

Vitest controls scheduler timers; real short waits let loopback I/O settle.
Coverage includes compatibility validation, revocation with halted requests until
resume, sanitized errors, bounded retry scheduling, reconnect catch-up and
idempotent duplicate/older event cursors. HTTP 5xx failures enter the offline
state; retry delays increase, cap, and reset after success. Socket reconnect
delays also increase and cap, then reset after a valid frame.

Opening errors and runtime error events, status and logger output are sanitized.
The opening tests check that untrusted messages, causes and details do not expose
credentials, while typed error classifications and transient HTTP status are
preserved. The two tests whose titles still start with `BUG:` (opening error
sanitization and 5xx backoff) are ordinary regression tests, not `it.fails`
expected failures.
