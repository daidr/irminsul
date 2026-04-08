import type { H3Event } from "h3";

export function requireDeveloper(event: H3Event) {
  const user = requireAuth(event);
  if (!user.isDeveloper && !user.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "Developer access required" });
  }
  return user;
}
