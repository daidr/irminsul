export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  await removeAllTokens(user.userId);
  return { success: true };
});
