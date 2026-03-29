import { z } from "zod";

const bodySchema = z.object({
  order: z.array(z.string()).optional(),
});

export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "参数格式错误" });
  }
  if (!parsed.data.order) {
    throw createError({ statusCode: 400, message: "body.order must be a string array" });
  }
  const manager = getPluginManager();
  await manager.updateOrder(parsed.data.order);
  return { ok: true };
});
