import type { SyncReport } from "@abele/sync-core";

/** Metadata only; copied outcomes retain both the head and the copy identifiers. */
export interface ConflictEvent {
  outcome: "merged" | "copied";
  path: string;
  fileId: string;
  versionId: string;
  conflictPath?: string;
  conflictFileId?: string;
  conflictVersionId?: string;
}
export function conflictEvents(report: SyncReport): ConflictEvent[] {
  return (report.push.committed?.results ?? []).flatMap(
    (result): ConflictEvent[] => {
      if (result.status !== "merged" && result.status !== "conflict") return [];
      return [
        {
          outcome: result.status === "merged" ? "merged" : "copied",
          path: result.path,
          fileId: result.file_id,
          versionId: result.version_id,
          ...(result.status === "conflict"
            ? {
                conflictPath: result.conflict_path,
                conflictFileId: result.conflict_file_id,
                conflictVersionId: result.conflict_version_id,
              }
            : {}),
        },
      ];
    },
  );
}
