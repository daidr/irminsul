import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { useLogger } from "evlog";
import type { SessionData } from "~~/server/utils/session";

const bodySchema = z.object({
  credential: z.record(z.string(), z.any()).optional(),
  challengeId: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }

  if (!parsed.data.credential || !parsed.data.challengeId) {
    return { success: false, error: "缺少验证数据" };
  }

  const credential = parsed.data.credential as AuthenticationResponseJSON;
  const { challengeId } = parsed.data;

  // Find user by credentialId
  const credentialId = credential.id;
  const user = await findUserByPasskeyCredentialId(credentialId);
  if (!user) {
    log.set({ passkey: { failure: "no_user_found", credentialId } });
    return { success: false, error: "通行密钥验证失败" };
  }

  // Find the specific passkey record
  const passkey = user.passkeys.find((pk) => pk.credentialId === credentialId);
  if (!passkey) {
    log.set({ passkey: { failure: "credential_not_in_user", credentialId, userId: user.uuid } });
    return { success: false, error: "通行密钥验证失败" };
  }

  // Cross-check userHandle if provided (userHandle is Base64URL-encoded UTF-8 of uuid)
  if (credential.response.userHandle) {
    const decoded = new TextDecoder().decode(base64URLToUint8Array(credential.response.userHandle));
    if (decoded !== user.uuid) {
      log.set({ passkey: { failure: "user_handle_mismatch", userId: user.uuid } });
      return { success: false, error: "通行密钥验证失败" };
    }
  }

  // Verify authentication
  let verified;
  try {
    verified = await verifyAuthentication(challengeId, credential, {
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: passkey.counter,
      transports: passkey.transports,
    });
  } catch (e) {
    log.error(e as Error, { step: "passkey_verify", userId: user.uuid });
    return { success: false, error: "通行密钥验证失败" };
  }

  if (!verified.verified) {
    log.set({ passkey: { failure: "verification_not_passed", userId: user.uuid } });
    return { success: false, error: "通行密钥验证失败" };
  }

  // Update passkey counter and lastUsedAt
  await updatePasskeyUsage(user.uuid, credentialId, verified.authenticationInfo.newCounter);

  const clientIp = extractClientIp(event);
  const ua = getHeader(event, "user-agent") || "unknown";

  // Update last login
  await updateLastLogin(user.uuid, clientIp);

  // Create session
  const sessionData: SessionData = {
    userId: user.uuid,
    email: user.email,
    gameId: user.gameId,
    ip: clientIp,
    ua,
    loginAt: Date.now(),
  };

  await createSession(event, sessionData);

  emitUserHook("user:login", {
    uuid: user.uuid,
    email: user.email,
    gameId: user.gameId,
    ip: clientIp,
    method: "passkey",
    timestamp: Date.now(),
  });

  return { success: true };
});
