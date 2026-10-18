# @abele/notes

Pure task and Markdown note values, with no Obsidian or Node API imports.

```ts
import { noteFromMarkdown, taskFromFrontmatter } from "@abele/notes";

const task = taskFromFrontmatter(
  { date: "2026-04-03", dateTime: "09:45", topics: ["garden"] },
  { labelProperty: "topics" },
);
const note = noteFromMarkdown("Notes/Seedlings.md", markdown);
```

`taskFromFrontmatter` mirrors the plugin's `Task.load` mapping, plus its labels,
priority and groups getters. Dates are Dayjs values or `null`; `date` and `due`
include their corresponding times when valid. The default label and priority
properties are `labels` and `priority`; options can name alternatives. `oldProps`
is a shallow copy with `content: undefined`. Values retain the plugin's forgiving
parsing, including Dayjs date overflow normalization and truthy recurrence values.
These helpers parse values; they do not validate an application schema.

`noteFromMarkdown(path, text, options?)` returns `{ path, frontmatter, body, task? }`.
Only `type: task` adds `task`. YAML calendar dates at the top level retain their
source spelling; other top-level timestamps become local date-time strings, as
in the plugin. Nested YAML dates remain native Dates. Ordinary frontmatter fences
preserve body whitespace. Legacy extended fences retain the original extractor's
whitespace behavior. Invalid YAML and non-mapping frontmatter throw. No filesystem
access, path rewriting, title inference or folder-based task detection occurs.

The public entry also exports frontmatter/YAML helpers, task metadata and tree
helpers, date/path helpers, color/date constants, `dayjs`, `RecurrenceParser` and
calendar zone conversion helpers. Recurrence calculates only the next date;
`from completion` uses the supplied completion date, falling back to the base
date when none is supplied. Window expansion belongs to a later task.

## Source and extraction seams

Copied from the GPL-3.0-only Abele plugin, master at
`eab17482af9105bdc7f3ae1b610af916e1e27dca`:
`noteFrontmatter`, `yamlDates`, `RecurrenceParser`, `taskMeta`, `taskTree`,
`datesHelper`, `dateLibrary`, `pathsHelpers`, `constants/colors`, `constants/dates`
and `calendars/zones`. Changes to those modules are relative ESM imports,
formatting, and strict-null type annotations/assertions; algorithms are preserved.
Runtime pins match the plugin: `dayjs` **1.11.18**, `js-yaml` **4.3.2**.

- `Task.load`'s metadata-cache read becomes a caller-supplied frontmatter mapping.
  Watchers, debounce, vault resolution, commands, stores and task mutation remain
  in the plugin; no replacements or stubs are provided.
- Global label/priority settings become explicit options and are evaluated at
  parsing time rather than reactive getters.
- `notesUtils.parseNoteContent`'s date normalization and body extraction become
  synchronous text parsing. The unused `TFile` argument, vault reads/writes,
  cache, templates and Obsidian YAML writer are outside this package.

The plugin repository is unchanged. Metadata tests are ported from its
`taskMeta.test.ts`; tree, recurrence and YAML parity cases are also retained.
