export default defineEventHandler(async () => {
  try {
    const { options, challengeId } = await generateAuthenticationOpts();
    return { success: true, options, challengeId };
  } catch {
    return { success: false, error: "生成验证选项失败" };
  }
});
