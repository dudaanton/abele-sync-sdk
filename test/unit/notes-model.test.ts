import { describe, expect, it } from "vitest";
import {
  noteFromMarkdown,
  taskFromFrontmatter,
} from "../../packages/notes/src/index.js";

describe("taskFromFrontmatter (Task.load parity)", () => {
  it("maps dates, applies times, reads labels and filters groups without mutating input", () => {
    const fm = {
      created: "2026-04-01",
      completed: "2026-04-07",
      date: "2026-04-03",
      dateTime: "09:45",
      due: "2026-04-04",
      dueTime: "18:15",
      recurrence: "every week",
      topics: ["#Garden", "garden"],
      groups: ["[[Projects/Seedlings]]", 5],
      content: "ignored",
    };
    const task = taskFromFrontmatter(fm, { labelProperty: "topics" });
    expect(task.createdAt?.format("YYYY-MM-DD")).toBe("2026-04-01");
    expect(task.completedAt?.format("YYYY-MM-DD")).toBe("2026-04-07");
    expect(task.date?.format("YYYY-MM-DD HH:mm")).toBe("2026-04-03 09:45");
    expect(task.dateTime?.format("HH:mm")).toBe("09:45");
    expect(task.due?.format("YYYY-MM-DD HH:mm")).toBe("2026-04-04 18:15");
    expect(task.dueTime?.format("HH:mm")).toBe("18:15");
    expect(task.recurrence).toBe("every week");
    expect(task.labels).toEqual(["Garden"]);
    expect(task.groups).toEqual(["[[Projects/Seedlings]]"]);
    expect(task.oldProps).toEqual({ ...fm, content: undefined });
    expect(fm.content).toBe("ignored");
  });

  it("defaults missing and invalid dates to null and ignores a scalar group", () => {
    const task = taskFromFrontmatter({
      date: "bad",
      dueTime: "12:00",
      groups: "Parent",
      labels: "Home",
      recurrence: "",
    });
    expect([
      task.createdAt,
      task.completedAt,
      task.date,
      task.dateTime,
      task.due,
      task.dueTime,
      task.recurrence,
    ]).toEqual(Array(7).fill(null));
    expect(task.labels).toEqual(["Home"]);
    expect(task.groups).toEqual([]);
  });

  it("keeps an all-day date when the time is invalid", () => {
    const task = taskFromFrontmatter({ date: "2026-04-03", dateTime: "bad" });
    expect(task.date?.format("YYYY-MM-DD HH:mm")).toBe("2026-04-03 00:00");
    expect(task.dateTime).toBeNull();
  });
});

describe("noteFromMarkdown", () => {
  it("preserves body spacing and calendar dates, and recognizes type: task", () => {
    const note = noteFromMarkdown(
      "Tasks/Plant.md",
      "---\ntype: task\ndate: 2026-04-03\nlabels: [garden]\nnested: {date: 2026-04-04}\n---\n\nPlant seeds.\n",
    );
    expect(note.path).toBe("Tasks/Plant.md");
    expect(note.body).toBe("\nPlant seeds.\n");
    expect(note.frontmatter.date).toBe("2026-04-03");
    expect((note.frontmatter.nested as { date: Date }).date).toBeInstanceOf(
      Date,
    );
    expect(note.task?.date?.format("YYYY-MM-DD")).toBe("2026-04-03");
  });

  it("leaves ordinary notes without a task", () => {
    expect(noteFromMarkdown("Notes/Ideas.md", "Ideas\n")).toEqual({
      path: "Notes/Ideas.md",
      frontmatter: {},
      body: "Ideas\n",
    });
    expect(
      noteFromMarkdown("Notes/Ideas.md", "---\nlabels: garden\n---\nIdeas")
        .task,
    ).toBeUndefined();
  });

  it("retains legacy fences and reports malformed YAML", () => {
    expect(
      noteFromMarkdown("A.md", "= yaml =\ntype: task\n= yaml =\nBody").task,
    ).toBeDefined();
    expect(() => noteFromMarkdown("A.md", "---\nx: [\n---\nBody")).toThrow();
  });
});
