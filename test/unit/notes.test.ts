import { expect, it } from "vitest";
import * as api from "../../packages/notes/src/index.js";
it("notes loads as an ESM module with its public model", () => {
  for (const name of [
    "taskFromFrontmatter",
    "noteFromMarkdown",
    "parseFrontmatter",
    "RecurrenceParser",
    "buildTaskTree",
  ])
    expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
});
