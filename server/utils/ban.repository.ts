import type { BanRecord } from "../types/user.schema";
import { isBanActive } from "../types/user.schema";
import { getUserCollection } from "./user.repository";

export interface BanOpUserContext {
  uuid: string;
  email: string;
  gameId: string;
}

export async function addBan(
  userUuid: string,
  opts: { end?: Date; reason?: string },
  operatorUuid: string,
): Promise<
  | { success: true; banId: string; ban: BanRecord; user: BanOpUserContext }
  | { success: false; error: string }
> {
  const ban: BanRecord = {
    id: crypto.randomUUID(),
    start: new Date(),
    operatorId: operatorUuid,
    ...(opts.end && { end: opts.end }),
    ...(opts.reason && { reason: opts.reason }),
  };

  const doc = await getUserCollection().findOneAndUpdate(
    { uuid: userUuid },
    { $push: { bans: ban } },
    { returnDocument: "after", projection: { uuid: 1, email: 1, gameId: 1 } },
  );

  if (!doc) {
    return { success: false, error: "用户不存在" };
  }
  return {
    success: true,
    banId: ban.id,
    ban,
    user: { uuid: doc.uuid, email: doc.email, gameId: doc.gameId },
  };
}

export async function revokeBan(
  userUuid: string,
  banId: string,
  operatorUuid: string,
): Promise<
  | { success: true; ban: BanRecord; user: BanOpUserContext }
  | { success: false; error: string }
> {
  const now = new Date();
  const doc = await getUserCollection().findOneAndUpdate(
    {
      uuid: userUuid,
      bans: {
        $elemMatch: {
          id: banId,
          revokedAt: { $exists: false },
          start: { $lte: now },
          $or: [{ end: { $exists: false } }, { end: { $gt: now } }],
        },
      },
    },
    {
      $set: {
        "bans.$.revokedAt": now,
        "bans.$.revokedBy": operatorUuid,
      },
    },
    { returnDocument: "before", projection: { uuid: 1, email: 1, gameId: 1, bans: 1 } },
  );

  if (!doc) {
    return { success: false, error: "该封禁已被撤销、已过期或不存在" };
  }

  const ban = doc.bans.find((b) => b.id === banId)!;
  return {
    success: true,
    ban,
    user: { uuid: doc.uuid, email: doc.email, gameId: doc.gameId },
  };
}

export async function editBan(
  userUuid: string,
  banId: string,
  opts: { end?: Date | null; reason?: string },
): Promise<
  | { success: true; old: BanRecord; new: BanRecord; user: BanOpUserContext }
  | { success: true }
  | { success: false; error: string }
> {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, unknown> = {};

  if (opts.end === null) {
    $unset["bans.$.end"] = "";
  } else if (opts.end !== undefined) {
    $set["bans.$.end"] = opts.end;
  }

  if (opts.reason !== undefined) {
    $set["bans.$.reason"] = opts.reason;
  }

  const update: Record<string, unknown> = {};
  if (Object.keys($set).length > 0) update.$set = $set;
  if (Object.keys($unset).length > 0) update.$unset = $unset;

  if (Object.keys(update).length === 0) {
    return { success: true };
  }

  const doc = await getUserCollection().findOneAndUpdate(
    { uuid: userUuid, "bans.id": banId },
    update,
    { returnDocument: "before", projection: { uuid: 1, email: 1, gameId: 1, bans: 1 } },
  );

  if (!doc) {
    return { success: false, error: "封禁记录不存在" };
  }

  const oldBan = doc.bans.find((b) => b.id === banId)!;

  // Construct new ban from old + applied changes
  const newBan: BanRecord = { ...oldBan };
  if (opts.end === null) {
    delete newBan.end;
  } else if (opts.end !== undefined) {
    newBan.end = opts.end;
  }
  if (opts.reason !== undefined) {
    newBan.reason = opts.reason;
  }

  return {
    success: true,
    old: oldBan,
    new: newBan,
    user: { uuid: doc.uuid, email: doc.email, gameId: doc.gameId },
  };
}

export async function removeBan(
  userUuid: string,
  banId: string,
): Promise<
  | { success: true; removed: BanRecord; wasActive: boolean; user: BanOpUserContext }
  | { success: false; error: string }
> {
  const user = await getUserCollection().findOne(
    { uuid: userUuid },
    { projection: { uuid: 1, email: 1, gameId: 1, bans: 1 } },
  );

  const ban = user?.bans?.find((b) => b.id === banId);
  if (!ban) {
    return { success: false, error: "封禁记录不存在" };
  }

  const result = await getUserCollection().updateOne(
    { uuid: userUuid },
    { $pull: { bans: { id: banId } } },
  );

  if (result.modifiedCount === 0) {
    return { success: false, error: "封禁记录不存在" };
  }

  return {
    success: true,
    removed: ban,
    wasActive: isBanActive(ban),
    user: { uuid: user!.uuid, email: user!.email, gameId: user!.gameId },
  };
}

export async function getUserBans(userUuid: string): Promise<BanRecord[]> {
  const user = await getUserCollection().findOne(
    { uuid: userUuid },
    { projection: { bans: 1 } },
  );
  return user?.bans ?? [];
}
