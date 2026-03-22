export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const body = await readBody<{
    credentialId?: string;
  }>(event);

  if (!body?.credentialId) {
    return { success: false, error: "缺少凭证 ID" };
  }

  const removed = await removePasskey(user.userId, body.credentialId);
  if (!removed) return { success: false, error: "通行密钥不存在" };

  return { success: true };
});
