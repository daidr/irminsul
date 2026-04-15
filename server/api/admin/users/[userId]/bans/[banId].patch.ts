import { z } from "zod";

const bodySchema = z.object({
  end: z.string().nullable().optional(),
  reason: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }
  const { end, reason } = parsed.data;

  if (reason !== undefined && reason.length > 500) {
    return { success: false, error: "封禁理由不能超过 500 个字符" };
  }

  let endDate: Date | null | undefined;
  if (end === null) {
    endDate = null; // make permanent
  } else if (end !== undefined) {
    endDate = new Date(end);
    if (Number.isNaN(endDate.getTime())) {
      return { success: false, error: "截止时间格式无效" };
    }
    // No future-time check here: editing historical records may need past dates
  }

  const result = await editBan(userId, banId, {
    end: endDate,
    reason,
  });

  if (result.success && "old" in result) {
    const oldSnap = toBanSnapshot(result.old);
    const newSnap = toBanSnapshot(result.new);
    // Only emit hook if there's an actual change (explicit field comparison)
    if (
      oldSnap.start !== newSnap.start ||
      oldSnap.end !== newSnap.end ||
      oldSnap.reason !== newSnap.reason ||
      oldSnap.revokedAt !== newSnap.revokedAt ||
      oldSnap.revokedBy !== newSnap.revokedBy
    ) {
      emitUserHook("user:ban-edited", {
        uuid: result.user.uuid,
        email: result.user.email,
        gameId: result.user.gameId,
        banId,
        operator: admin.userId,
        timestamp: Date.now(),
        old: oldSnap,
        new: newSnap,
      });
    }
  }

  return result.success ? { success: true } : { success: false, error: result.error };
});
