import type { H3Event } from "h3";

export function requireAuth(event: H3Event) {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return user;
}
