import { z } from "zod";

const bodySchema = z.object({
  sessionId: z.string().optional(),
});

export default defineWebApiHandler(async (event) => {
  const user = requireAuth(event);
  const currentSessionId = event.context.sessionId as string | null;

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    webError("参数格式错误");
  }
  const { sessionId } = parsed.data;

  if (!sessionId) {
    webError("缺少会话标识");
  }

  if (sessionId === currentSessionId) {
    webError("不能删除当前会话");
  }

  await destroySessionById(user.userId, sessionId);
  return { success: true };
});
