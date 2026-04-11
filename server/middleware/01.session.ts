export default defineEventHandler(async (event) => {
  const sessionData = await getSessionData(event);
  if (!sessionData) return;

  // Try cache first, fall back to MongoDB
  let userDoc = await getCachedSessionUser(sessionData.userId);
  if (!userDoc) {
    userDoc = await findUserForSession(sessionData.userId);
    if (userDoc) {
      await setCachedSessionUser(sessionData.userId, userDoc);
    }
  }

  const defaultSkinHash = useRuntimeConfig(event).yggdrasilDefaultSkinHash;
  const skinHash = userDoc?.skin?.hash || defaultSkinHash || undefined;

  const bans = (userDoc?.bans ?? []).map((ban) => ({
    id: ban.id,
    start: new Date(ban.start).getTime(),
    end: ban.end ? new Date(ban.end).getTime() : undefined,
    reason: ban.reason,
    operatorId: ban.operatorId,
    revokedAt: ban.revokedAt ? new Date(ban.revokedAt).getTime() : undefined,
  }));

  const emailVerified = userDoc?.emailVerified ?? false;
  const requireEmailVerification = getSetting("auth.requireEmailVerification");

  event.context.user = {
    ...sessionData, // userId, email, gameId, ip, ua, loginAt
    skinHash,
    skinSlim: userDoc?.skin?.type === 1,
    hasCustomSkin: !!userDoc?.skin?.hash,
    capeHash: userDoc?.cape?.hash ?? undefined,
    registerAt: userDoc?.time.register ? new Date(userDoc.time.register).getTime() : null,
    bans,
    isAdmin: userDoc?.isAdmin === true,
    isDeveloper: userDoc?.isDeveloper ?? false,
    emailVerified,
    needsEmailVerification: !!requireEmailVerification && !emailVerified,
    oauthBindings: (userDoc?.oauthBindings ?? []).map((b) => ({
      provider: b.provider,
      providerId: b.providerId,
      displayName: b.displayName,
      boundAt: new Date(b.boundAt).getTime(),
    })),
  };

  event.context.sessionId = await getCurrentSessionId(event);
});
