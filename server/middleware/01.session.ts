export default defineEventHandler(async (event) => {
  const sessionData = await getSessionData(event);
  if (!sessionData) return;

  const userDoc = await findUserForSession(sessionData.userId);
  const defaultSkinHash = useRuntimeConfig(event).yggdrasilDefaultSkinHash;
  const skinHash = userDoc?.skin?.hash || defaultSkinHash || undefined;

  const bans = (userDoc?.bans ?? []).map((ban) => ({
    id: ban.id,
    start: ban.start.getTime(),
    end: ban.end?.getTime(),
    reason: ban.reason,
    operatorId: ban.operatorId,
    revokedAt: ban.revokedAt?.getTime(),
  }));

  const emailVerified = userDoc?.emailVerified ?? false;
  const requireEmailVerification = getSetting("auth.requireEmailVerification");

  event.context.user = {
    ...sessionData, // userId, email, gameId, ip, ua, loginAt
    skinHash,
    skinSlim: userDoc?.skin?.type === 1,
    hasCustomSkin: !!userDoc?.skin?.hash,
    capeHash: userDoc?.cape?.hash ?? undefined,
    registerAt: userDoc?.time.register.getTime() ?? null,
    bans,
    isAdmin: userDoc?.isAdmin === true,
    emailVerified,
    needsEmailVerification: !!requireEmailVerification && !emailVerified,
    oauthBindings: (userDoc?.oauthBindings ?? []).map((b) => ({
      provider: b.provider,
      providerId: b.providerId,
      displayName: b.displayName,
      boundAt: b.boundAt.getTime(),
    })),
  };

  event.context.sessionId = await getCurrentSessionId(event);
});
