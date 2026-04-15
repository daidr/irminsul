export default defineEventHandler(async (event) => {
  // Rate limit by IP (login flow precursor)
  try {
    await checkRateLimit(event, `web:passkey:auth-options:ip:${extractClientIp(event)}`, {
      duration: 60_000,
      max: 10,
      delayAfter: 5,
      timeWait: 2_000,
      fastFail: true,
    });
  } catch (err) {
    if (err instanceof YggdrasilError && err.httpStatus === 429) {
      return { success: false, error: "请求过于频繁，请稍后再试" };
    }
    throw err;
  }

  try {
    const { options, challengeId } = await generateAuthenticationOpts();
    return { success: true, options, challengeId };
  } catch {
    return { success: false, error: "生成验证选项失败" };
  }
});
