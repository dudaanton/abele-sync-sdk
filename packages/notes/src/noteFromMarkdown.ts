import { load } from "js-yaml";
import dayjs from "./helpers/dateLibrary.js";
import parseFrontmatter from "./helpers/noteFrontmatter.js";
import { isCalendarDate, timestampTextSchema } from "./helpers/yamlDates.js";
import {
  taskFromFrontmatter,
  type TaskData,
  type TaskOptions,
} from "./taskFromFrontmatter.js";

export interface MarkdownNote {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  task?: TaskData;
}

/** Pure counterpart of notesUtils.parseNoteContent. Invalid YAML is reported to the caller.
 * Only `type: task` identifies a task; folders have no special meaning here.
 */
export function noteFromMarkdown(
  path: string,
  text: string,
  options: TaskOptions = {},
): MarkdownNote {
  const parsed = parseFrontmatter<unknown>(text);
  if (
    parsed.attributes === null ||
    typeof parsed.attributes !== "object" ||
    Array.isArray(parsed.attributes)
  ) {
    throw new TypeError("Note frontmatter must be a mapping");
  }
  const attributes = parsed.attributes as Record<string, unknown>;
  const source = Object.values(attributes).some(
    (value) => value instanceof Date,
  )
    ? ((load(parsed.frontmatter ?? "", {
        schema: timestampTextSchema,
      }) as Record<string, unknown>) ?? {})
    : {};
  // Match the plugin's top-level normalization; nested YAML Dates stay Dates.
  const frontmatter = Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      value instanceof Date
        ? isCalendarDate(source[key])
          ? source[key]
          : dayjs(value).format("YYYY-MM-DDTHH:mm:ss")
        : value,
    ]),
  );
  const match =
    parsed.frontmatter !== undefined
      ? text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/)
      : null;
  const body = match ? text.slice(match[0].length) : parsed.body;
  return {
    path,
    frontmatter,
    body,
    ...(frontmatter.type === "task"
      ? { task: taskFromFrontmatter(frontmatter, options) }
      : {}),
  };
}
