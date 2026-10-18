# @abele/notes

Pure task and Markdown note values, with no Obsidian or Node API imports.
Requires Node.js 22+ for the supported package runtime and ESM imports.
Installation target: `npm install @abele/notes`. In this workspace run `npm ci`
and `npm run build` first.

```ts
import { noteFromMarkdown, taskFromFrontmatter } from "@abele/notes";

const task = taskFromFrontmatter(
  { date: "2026-04-03", dateTime: "09:45", topics: ["garden"] },
  { labelProperty: "topics" },
);
const markdown = "---\ntype: task\nlabels: [garden]\n---\nWater seedlings.\n";
const note = noteFromMarkdown("Notes/Seedlings.md", markdown);
console.log(task.date?.format("YYYY-MM-DD HH:mm"), note.task?.labels);
```

`markdown` is caller-supplied text. For a complete sync-and-read example, see
[reading notes](https://github.com/dudaanton/abele-sync-sdk/tree/main/examples/reading-notes).

## Task fields and dates

| Frontmatter            | Returned value                                                  |
| ---------------------- | --------------------------------------------------------------- |
| `created`, `completed` | `createdAt`, `completedAt`: Dayjs or null                       |
| `date`, `dateTime`     | `date` with valid time applied, plus separate `dateTime` value  |
| `due`, `dueTime`       | `due` with valid time applied, plus separate `dueTime` value    |
| `recurrence`           | Truthy value retained, otherwise null; no automatic calculation |
| `labels`               | Normalized labels; configurable with `labelProperty`            |
| `priority`             | low, medium, high or null; configurable with `priorityProperty` |
| `groups`               | Array entries that are strings, otherwise an empty array        |

Dates use `YYYY-MM-DD`, times `HH:mm`. A time needs its corresponding date.
Parsing uses local Dayjs time and forgiving normalization, not strict calendar
validation. There is no task time-zone parameter or reminder property mapping.
Labels accept a scalar or list, trim hashes/whitespace, resolve wikilink display
text and collapse duplicates without case sensitivity. A comma in a scalar is
not a separator. Priority uses the first list item, trimmed and case-insensitive.
Options are evaluated when parsing; empty property names fall back to defaults.

## Recurrence and zones

```ts
import { dayjs, RecurrenceParser } from "@abele/notes";

const parser = new RecurrenceParser();
const next = parser.getNextDate(dayjs("2026-04-03"), "every 3 days");
console.log(next?.format("YYYY-MM-DD")); // 2026-04-06
```

`parse(pattern)` returns a rule or null. `getNextDate(baseDate, pattern,
completionDate?)` returns one Dayjs date or null. Supported forms include
`every N days` (also hours/weeks/months/years), `every 2 weeks on Mon, Wed`,
`every month on 1, 15`, `every first Monday`, `every last day of month`, and
`from completion`. Completion falls back to the base when omitted. Parsing is
permissive, uses English patterns, and is not an RFC recurrence-rule validator.
Not every combination yields a next date. Validate positive intervals in your
application. No occurrence window, scheduler or notification service is supplied.

Task dates do not automatically use calendar zones. The separate
`resolveZone(tzid)` resolves known Windows names, IANA names and some prefixed
names, or null. `wallTimeToInstant({ year, month, day, hour, minute, second }, zone)`
returns epoch milliseconds using platform Intl rules (month is 1–12). Resolve
the zone first. Ambiguous autumn time selects the first occurrence; skipped
spring time is interpreted after the transition. This helper does not parse
calendar files or register embedded VTIMEZONE definitions.

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

## Licence

GPL-3.0-only; see LICENSE. Conveying the package or a combined derivative work
requires complying with GPLv3 source, licence and notice obligations. Private
modification/use does not require public release; network access alone creates
no AGPL-style source offer. Distribution to others, including private or
commercial distribution, still carries GPL obligations.
