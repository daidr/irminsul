import { z } from "zod";

export const authenticateBodySchema = z.object({
  username: z.string(),
  password: z.string(),
  clientToken: z.string().optional(),
  requestUser: z.boolean().optional(),
  agent: z
    .object({
      name: z.string(),
      version: z.number(),
    })
    .optional(),
});
export type AuthenticateBody = z.infer<typeof authenticateBodySchema>;

export const refreshBodySchema = z.object({
  accessToken: z.string(),
  clientToken: z.string().optional(),
  requestUser: z.boolean().optional(),
  selectedProfile: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const validateBodySchema = z.object({
  accessToken: z.string(),
  clientToken: z.string().optional(),
});
export type ValidateBody = z.infer<typeof validateBodySchema>;

export const invalidateBodySchema = z.object({
  accessToken: z.string(),
  clientToken: z.string().optional(),
});
export type InvalidateBody = z.infer<typeof invalidateBodySchema>;

export const signoutBodySchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type SignoutBody = z.infer<typeof signoutBodySchema>;

export const joinBodySchema = z.object({
  accessToken: z.string(),
  selectedProfile: z.string(),
  serverId: z.string(),
});
export type JoinBody = z.infer<typeof joinBodySchema>;

export const hasJoinedQuerySchema = z.object({
  username: z.string(),
  serverId: z.string(),
  ip: z.string().optional(),
});
export type HasJoinedQuery = z.infer<typeof hasJoinedQuerySchema>;

export const profileParamsSchema = z.object({
  uuid: z.string(),
});
export type ProfileParams = z.infer<typeof profileParamsSchema>;

export const batchProfilesBodySchema = z.array(z.string());
export type BatchProfilesBody = z.infer<typeof batchProfilesBodySchema>;

export const textureParamsSchema = z.object({
  uuid: z.string(),
  textureType: z.string(),
});
export type TextureParams = z.infer<typeof textureParamsSchema>;

export const uploadTextureBodySchema = z.object({
  model: z.string().optional(),
  // Note: File validation is handled at the route level via multipart parsing
});
export type UploadTextureBody = z.infer<typeof uploadTextureBodySchema>;
