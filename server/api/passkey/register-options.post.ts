export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

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
