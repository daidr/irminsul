import type { H3Event } from "h3";

export function requireAdmin(event: H3Event) {
  const user = requireAuth(event);
  if (!user.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }
  return user;
}
