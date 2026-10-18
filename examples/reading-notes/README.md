# Reading notes

After `npm ci` and `npm run build`, run with a protocol 2 connection key:

```sh
node examples/reading-notes/index.js --key '<key>' --dir ./mirror --prefix Notes/
```

Optional `--state-dir ./private-state` keeps credentials and the ledger outside
the mirror. `--help` works without connecting. This example runs one bidirectional
sync, lists local Markdown through the public SDK, and parses it with
`@abele/notes`. It prints one JSON record per note, with body and task values
when frontmatter has `type: task`. It always closes the client in `finally`.
Use a server read-only key when uploads must be prohibited.

For example, a generic `Notes/Water.md` could contain:

```markdown
---
type: task
date: 2026-04-03
dateTime: "09:45"
labels: [garden]
recurrence: every 3 days
---

Water seedlings.
```

Dates are formatted as local wall time, without implying a UTC instant. No
recurrence expansion or reminders run. Invalid YAML fails the command; failures
print a generic message without transport credentials and exit with status 1.
A successful sync may leave settling/deferred files for a later run.
