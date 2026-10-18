import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("reading-notes exposes help without a connection", () => {
  expect(
    execFileSync(
      process.execPath,
      ["examples/reading-notes/index.js", "--help"],
      {
        encoding: "utf8",
      },
    ),
  ).toContain("--prefix");
});

it("reads Markdown through the replica and parses task values", async () => {
  // @ts-expect-error JavaScript example intentionally has no declaration file.
  const { readNotes } = await import("../../examples/reading-notes/index.js");
  const notes = await readNotes(
    {
      list: async () => [
        { path: "Notes/Water.md" },
        { path: "Notes/photo.png" },
      ],
      readText: async () =>
        "---\ntype: task\ndate: 2026-04-03\ndateTime: '09:45'\nlabels: [garden]\n---\nWater seedlings.\n",
    },
    "Notes/",
  );
  expect(notes).toHaveLength(1);
  expect(notes[0].task.labels).toEqual(["garden"]);
  expect(notes[0].task.date.format("YYYY-MM-DD HH:mm")).toBe(
    "2026-04-03 09:45",
  );
  expect(notes[0].body).toBe("Water seedlings.\n");
});
