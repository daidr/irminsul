export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const body = await readBody<{
    credentialId?: string;
    newLabel?: string;
  }>(event);

  const { credentialId, newLabel } = body || {};

  if (!credentialId || !newLabel) {
    return { success: false, error: "参数不完整" };
  }

  const trimmed = newLabel.trim();
  if (!trimmed) return { success: false, error: "名称不能为空" };
  if (trimmed.length > 50) return { success: false, error: "名称最长 50 个字符" };

  const updated = await renamePasskey(user.userId, credentialId, trimmed);
  if (!updated) return { success: false, error: "通行密钥不存在" };

  return { success: true };
});
