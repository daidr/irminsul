export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const token = (query.token as string) ?? "";

  if (!token) {
    return { tokenValid: false, token: "" };
  }

  const result = await verifyEmailVerificationToken(token);
  if (!result) {
    return { tokenValid: false, token: "" };
  }

  return { tokenValid: true, token };
});
