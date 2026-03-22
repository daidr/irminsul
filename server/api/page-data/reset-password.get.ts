export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const token = (query.token as string) ?? "";

  if (!token) {
    return { tokenValid: false, token: "" };
  }

  const result = await verifyPasswordResetToken(token);
  if (!result) {
    return { tokenValid: false, token: "" };
  }

  // Token is valid — pass it to client for form submission
  return { tokenValid: true, token };
});
