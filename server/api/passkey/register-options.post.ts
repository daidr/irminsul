export default defineWebApiHandler(async (event) => {
  const user = requireAuth(event);

  // Rate limit by user (already authenticated)
  const rateLimitFail = await checkWebRateLimit(
    event,
    `web:passkey:register-options:uid:${user.userId}`,
    {
      duration: 60_000,
      max: 10,
      delayAfter: 5,
      timeWait: 2_000,
      fastFail: true,
    },
  );
  if (rateLimitFail) return rateLimitFail;

  const userDoc = await findUserByUuid(user.userId);
  if (!userDoc) {
    webError("用户不存在");
  }

  if (userDoc.passkeys && userDoc.passkeys.length >= 10) {
    webError("通行密钥数量已达上限（10 个）");
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
