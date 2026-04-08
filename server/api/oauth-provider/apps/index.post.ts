import { z } from "zod";
import { VALID_SCOPES } from "../../../types/oauth-provider.types";

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  type: z.enum(["confidential", "public"]),
  redirectUris: z.array(z.string().url()).min(1).max(10),
  scopes: z.array(z.enum(VALID_SCOPES as [string, ...string[]])).min(1),
});

export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "Invalid request body" });
  }

  const { name, description, type, redirectUris, scopes } = parsed.data;

  const clientId = generateClientId();
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;

  if (type === "confidential") {
    clientSecret = generateClientSecret();
    clientSecretHash = await Bun.password.hash(clientSecret, "argon2id");
  }

  const now = new Date();
  await insertOAuthApp({
    clientId,
    clientSecretHash,
    type,
    name,
    description,
    redirectUris,
    scopes,
    ownerId: user.userId,
    approved: false,
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return { success: true, clientId, clientSecret };
});
