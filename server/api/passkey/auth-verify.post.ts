import { getLogger } from "@logtape/logtape";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { SessionData } from "~~/server/utils/session";

const logger = getLogger(["irminsul", "passkey"]);

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    credential?: AuthenticationResponseJSON;
    challengeId?: string;
  }>(event);

  if (!body?.credential || !body?.challengeId) {
    return { success: false, error: "缺少验证数据" };
  }

  const { credential, challengeId } = body;

  // Find user by credentialId
  const credentialId = credential.id;
  const user = await findUserByPasskeyCredentialId(credentialId);
  if (!user) {
    logger.debug`Passkey login failed: no user found for credentialId ${credentialId}`;
    return { success: false, error: "通行密钥验证失败" };
  }

  // Find the specific passkey record
  const passkey = user.passkeys.find((pk) => pk.credentialId === credentialId);
  if (!passkey) {
    logger.debug`Passkey login failed: credential ${credentialId} not in user ${user.uuid} passkeys`;
    return { success: false, error: "通行密钥验证失败" };
  }

  // Cross-check userHandle if provided (userHandle is Base64URL-encoded UTF-8 of uuid)
  if (credential.response.userHandle) {
    const decoded = new TextDecoder().decode(base64URLToUint8Array(credential.response.userHandle));
    if (decoded !== user.uuid) {
      logger.debug`Passkey login failed: userHandle mismatch for user ${user.uuid}, got ${decoded}`;
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
    logger.debug`Passkey login verification threw for user ${user.uuid}: ${e}`;
    return { success: false, error: "通行密钥验证失败" };
  }

  if (!verified.verified) {
    logger.debug`Passkey login verification returned not verified for user ${user.uuid}`;
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

  return { success: true };
});
