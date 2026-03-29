import { z } from "zod";

const bodySchema = z.object({
  tokenId: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }
  const { tokenId } = parsed.data;

  if (!tokenId) {
    return { success: false, error: "缺少令牌标识" };
  }

  const userDoc = await findUserByUuid(user.userId);
  if (!userDoc) {
    return { success: false, error: "用户不存在" };
  }

  const matchedToken = userDoc.tokens.find(
    (t) => computeTokenId(t.accessToken) === tokenId,
  );
  if (!matchedToken) {
    return { success: false, error: "无权操作" };
  }

  await removeToken(matchedToken.accessToken);
  return { success: true };
});
