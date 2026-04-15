import { z } from "zod";

const bodySchema = z.object({
  type: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  // Rate limit by user
  try {
    await checkRateLimit(event, `web:texture-delete:uid:${user.userId}`, {
      duration: 60_000,
      max: 20,
      delayAfter: 10,
      timeWait: 1_000,
      fastFail: true,
    });
  } catch (err) {
    if (err instanceof YggdrasilError && err.httpStatus === 429) {
      return { success: false, error: "请求过于频繁，请稍后再试" };
    }
    throw err;
  }

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }
  const textureType = parsed.data.type;

  if (textureType !== "skin" && textureType !== "cape") {
    return { success: false, error: "无效的材质类型" };
  }

  try {
    await processTextureDelete(event, {
      uuid: user.userId,
      textureType,
    });

    const config = useRuntimeConfig();
    const defaultHash = config.yggdrasilDefaultSkinHash || "";
    const fallbackSkinHash = textureType === "skin" ? defaultHash || undefined : undefined;

    return { success: true, fallbackSkinHash };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "删除失败",
    };
  }
});
