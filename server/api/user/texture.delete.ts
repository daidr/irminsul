import { z } from "zod";

const bodySchema = z.object({
  type: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

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
