import {
  applyTimeToDate,
  parseDateOrNull,
  parseDateTimeOrNull,
} from "./helpers/datesHelper.js";
import {
  DEFAULT_LABEL_PROPERTY,
  parseLabels,
  parsePriority,
  PRIORITY_PROPERTY,
} from "./helpers/taskMeta.js";

export interface TaskOptions {
  labelProperty?: string;
  priorityProperty?: string;
}

/** Task.load's value mapping, without a vault, watchers or global settings.
 * Date parsing deliberately retains the plugin's forgiving Dayjs semantics.
 */
export function taskFromFrontmatter(
  frontmatter: Record<string, unknown>,
  options: TaskOptions = {},
) {
  const createdAt = parseDateOrNull(frontmatter.created as string);
  const completedAt = parseDateOrNull(frontmatter.completed as string);
  const dateTime = parseDateTimeOrNull(
    frontmatter.date as string,
    frontmatter.dateTime as string,
  );
  const dueTime = parseDateTimeOrNull(
    frontmatter.due as string,
    frontmatter.dueTime as string,
  );
  const oldProps: Record<string, unknown> = {
    ...frontmatter,
    content: undefined,
  };
  return {
    createdAt,
    completedAt,
    recurrence: (frontmatter.recurrence || null) as string | null,
    date: applyTimeToDate(
      parseDateOrNull(frontmatter.date as string),
      dateTime,
    ),
    dateTime,
    due: applyTimeToDate(parseDateOrNull(frontmatter.due as string), dueTime),
    dueTime,
    labels: parseLabels(
      frontmatter[options.labelProperty || DEFAULT_LABEL_PROPERTY],
    ),
    priority: parsePriority(
      frontmatter[options.priorityProperty || PRIORITY_PROPERTY],
    ),
    groups: Array.isArray(frontmatter.groups)
      ? frontmatter.groups.filter((g): g is string => typeof g === "string")
      : [],
    oldProps,
  };
}

export type TaskData = ReturnType<typeof taskFromFrontmatter>;
