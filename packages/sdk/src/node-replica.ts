import type { NodeKeyOptions } from "@abele/sync-node";

export class ReplicaConfigurationError extends Error {
  readonly code = "REPLICA_CONFIGURATION";
  constructor() {
    super("Replica directory or connection configuration is incompatible");
    this.name = "ReplicaConfigurationError";
  }
}
export async function openReplica(options: NodeKeyOptions) {
  const { openNodeReplica, NodeReplicaConfigError } =
    await import("@abele/sync-node");
  try {
    return await openNodeReplica(options);
  } catch (error) {
    if (error instanceof NodeReplicaConfigError)
      throw new ReplicaConfigurationError();
    throw error;
  }
}
