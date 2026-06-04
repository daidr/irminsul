export default defineWebApiHandler(async (event) => {
  if (!event.context.user) return { success: true };
  await destroySession(event);
  return { success: true };
});
