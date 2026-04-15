export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  // Rate limit by user (already authenticated)
  try {
    await checkRateLimit(event, `web:passkey:register-options:uid:${user.userId}`, {
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

  const userDoc = await findUserByUuid(user.userId);
  if (!userDoc) {
    return { success: false, error: "用户不存在" };
  }

  if (userDoc.passkeys && userDoc.passkeys.length >= 10) {
    return { success: false, error: "通行密钥数量已达上限（10 个）" };
  }

  const existingPasskeys = (userDoc.passkeys || []).map((pk) => ({
    credentialId: pk.credentialId,
    transports: pk.transports,
  }));

  const options = await generateRegistrationOpts(
    userDoc.uuid,
    userDoc.email,
    userDoc.gameId,
    existingPasskeys,
  );

  return { success: true, options };
});
