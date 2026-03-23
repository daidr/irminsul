import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { PasskeyRecord } from "~~/server/types/user.schema";

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  const user = requireAuth(event);

  const body = await readBody<{
    credential?: RegistrationResponseJSON;
  }>(event);

  if (!body?.credential) {
    return { success: false, error: "缺少凭证数据" };
  }

  const userDoc = await findUserByUuid(user.userId);
  if (!userDoc) {
    return { success: false, error: "用户不存在" };
  }

  let verified;
  try {
    verified = await verifyRegistration(userDoc.uuid, body.credential);
  } catch (e) {
    log.error(e as Error, { step: "passkey_register_verify", userId: userDoc.uuid });
    return { success: false, error: "验证失败，请重试" };
  }

  if (!verified.verified || !verified.registrationInfo) {
    log.set({ passkey: { registrationFailure: true, userId: userDoc.uuid, verified: verified.verified } });
    return { success: false, error: "验证失败，请重试" };
  }

  const { credential: cred, credentialBackedUp, credentialDeviceType } = verified.registrationInfo;
  const backupEligible = credentialDeviceType === "multiDevice";
  const ua = getHeader(event, "user-agent") || "";

  const existingLabels = (userDoc.passkeys || []).map((pk) => pk.label);
  const rawLabel = inferPasskeyLabel(ua, backupEligible, body.credential.authenticatorAttachment);
  const label = deduplicateLabel(rawLabel, existingLabels);

  const now = new Date();
  const passkey: PasskeyRecord = {
    credentialId: cred.id,
    publicKey: uint8ArrayToBase64URL(cred.publicKey),
    counter: cred.counter,
    transports: cred.transports,
    label,
    backupEligible,
    backupState: credentialBackedUp,
    createdAt: now,
    lastUsedAt: now,
  };

  const added = await addPasskey(userDoc.uuid, passkey);
  if (!added) {
    return { success: false, error: "通行密钥数量已达上限" };
  }

  return {
    success: true,
    passkey: {
      credentialId: passkey.credentialId,
      label: passkey.label,
      backupEligible: passkey.backupEligible,
      backupState: passkey.backupState,
      createdAt: passkey.createdAt.toISOString(),
      lastUsedAt: passkey.lastUsedAt.toISOString(),
    },
  };
});
