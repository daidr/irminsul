export default defineWebApiHandler(async (event) => {
  // Rate limit by IP (login flow precursor)
  const rateLimitFail = await checkWebRateLimit(
    event,
    `web:passkey:auth-options:ip:${extractClientIp(event)}`,
    {
      duration: 60_000,
      max: 10,
      delayAfter: 5,
      timeWait: 2_000,
      fastFail: true,
    },
  );
  if (rateLimitFail) return rateLimitFail;

  try {
    const { options, challengeId } = await generateAuthenticationOpts();
    return { success: true, options, challengeId };
  } catch {
    webError("生成验证选项失败");
  }
});
