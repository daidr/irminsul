import type { BanRecord } from "../types/user.schema";
import type { BanSnapshot } from "./plugin/types";

export function toBanSnapshot(ban: BanRecord): BanSnapshot {
  return {
    start: ban.start.getTime(),
    ...(ban.end !== undefined && { end: ban.end.getTime() }),
    ...(ban.reason !== undefined && { reason: ban.reason }),
    ...(ban.revokedAt !== undefined && {
      revokedAt: ban.revokedAt.getTime(),
      revokedBy: ban.revokedBy,
    }),
  };
}
