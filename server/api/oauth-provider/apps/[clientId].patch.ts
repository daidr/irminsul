import { z } from "zod";
import { VALID_SCOPES } from "../../../types/oauth-provider.types";
import { BUILTIN_ICON_NAMES } from "~~/shared/builtin-icon-names";

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  redirectUris: z.array(z.string().url()).min(1).max(10).optional(),
  scopes: z
    .array(z.enum(VALID_SCOPES as [string, ...string[]]))
    .min(1)
    .optional(),
  icon: z
    .object({
      name: z.enum(BUILTIN_ICON_NAMES as unknown as [string, ...string[]]),
      hue: z.number().int().min(0).max(360),
    })
    .nullable()
    .optional(),
});

export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);
  const clientId = getRouterParam(event, "clientId");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "Missing clientId" });
  }

  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: "App not found" });
  }

  if (app.ownerId !== user.userId && !user.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "Invalid request body" });
  }

  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No fields to update" });
  }

  await updateOAuthApp(clientId, data);
  return { success: true };
});
