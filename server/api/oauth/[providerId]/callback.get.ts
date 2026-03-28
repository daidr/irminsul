export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  return handleOAuthCallback(event, {
    code: query.code as string,
    state: query.state as string,
    error: query.error as string | undefined,
  });
});
