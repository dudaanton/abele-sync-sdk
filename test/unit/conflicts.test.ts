import { expect, it } from "vitest";
import type { SyncReport } from "@abele/sync-core";
import { conflictEvents } from "../../packages/sdk/src/conflicts.js";

it("projects merged and copied outcomes without server payloads", () => {
  const result = {
    path: "Example.md",
    file_id: "file",
    version_id: "version",
    sha: "hash",
    size: 3,
    mtime: 1,
    contents: "private bytes",
  };
  const report = {
    push: {
      committed: {
        results: [
          { ...result, status: "applied" },
          { ...result, status: "merged" },
          {
            ...result,
            status: "conflict",
            conflict_path: "Example (conflict).md",
            conflict_file_id: "copy",
            conflict_version_id: "copy-version",
          },
          { status: "rejected", message: "private details" },
        ],
      },
    },
  } as unknown as SyncReport;
  expect(conflictEvents(report)).toEqual([
    {
      outcome: "merged",
      path: "Example.md",
      fileId: "file",
      versionId: "version",
    },
    {
      outcome: "copied",
      path: "Example.md",
      fileId: "file",
      versionId: "version",
      conflictPath: "Example (conflict).md",
      conflictFileId: "copy",
      conflictVersionId: "copy-version",
    },
  ]);
  expect(conflictEvents({ push: { committed: null } } as SyncReport)).toEqual(
    [],
  );
});
