export default defineEventHandler(async (event) => {
  requireAdmin(event);

  // Stub — AdminUserManageTab is a placeholder ("功能开发中")
  return { success: true, users: [] };
});
