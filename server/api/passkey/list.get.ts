export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const passkeys = await getPasskeys(user.userId);
  return {
    success: true,
    passkeys: passkeys.map((pk) => ({
      credentialId: pk.credentialId,
      label: pk.label,
      backupEligible: pk.backupEligible,
      backupState: pk.backupState,
      createdAt: pk.createdAt instanceof Date ? pk.createdAt.toISOString() : String(pk.createdAt),
      lastUsedAt:
        pk.lastUsedAt instanceof Date ? pk.lastUsedAt.toISOString() : String(pk.lastUsedAt),
    })),
  };
});
