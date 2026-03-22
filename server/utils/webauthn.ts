import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  GenerateRegistrationOptionsOpts,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import type { PasskeyRecord } from "~~/server/types/user.schema";

// --- Config ---

const CHALLENGE_TTL_SECONDS = 5 * 60; // 5 minutes

function getRpId(): string {
  const config = useRuntimeConfig();
  return config.webauthnRpId || "localhost";
}

function getRpName(): string {
  const config = useRuntimeConfig();
  return config.public.siteName || "Irminsul";
}

function getOrigin(): string {
  const config = useRuntimeConfig();
  return config.webauthnOrigin || `https://${getRpId()}`;
}

// --- Challenge Store (Redis) ---

function challengeKey(id: string): string {
  return buildRedisKey("webauthn", "challenge", id);
}

export async function storeChallenge(id: string, challenge: string): Promise<void> {
  const redis = getRedisClient();
  await redis.send("SET", [
    challengeKey(id),
    challenge,
    "EX",
    CHALLENGE_TTL_SECONDS.toString(),
  ]);
}

export async function consumeChallenge(id: string): Promise<string | null> {
  const redis = getRedisClient();
  const key = challengeKey(id);
  return (await redis.send("GETDEL", [key])) as string | null;
}

// --- Registration ---

export async function generateRegistrationOpts(
  userId: string,
  userEmail: string,
  userGameId: string,
  existingPasskeys: Pick<PasskeyRecord, "credentialId" | "transports">[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const opts: GenerateRegistrationOptionsOpts = {
    rpName: getRpName(),
    rpID: getRpId(),
    userName: userEmail,
    userDisplayName: userGameId,
    userID: isoUint8Array.fromUTF8String(userId),
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  };

  const options = await generateRegistrationOptions(opts);

  // Store challenge
  await storeChallenge(userId, options.challenge);

  return options;
}

export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
): Promise<VerifiedRegistrationResponse> {
  const expectedChallenge = await consumeChallenge(userId);
  if (!expectedChallenge) {
    throw new Error("Challenge expired or not found");
  }

  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: getOrigin(),
    expectedRPID: getRpId(),
  });
}

// --- Authentication ---

export async function generateAuthenticationOpts(): Promise<{
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeId: string;
}> {
  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: "preferred",
    // Empty allowCredentials for discoverable credentials (passkey login)
  });

  const challengeId = crypto.randomUUID();
  await storeChallenge(challengeId, options.challenge);

  return { options, challengeId };
}

export async function verifyAuthentication(
  challengeId: string,
  response: AuthenticationResponseJSON,
  credential: { credentialId: string; publicKey: string; counter: number; transports?: string[] },
): Promise<VerifiedAuthenticationResponse> {
  const expectedChallenge = await consumeChallenge(challengeId);
  if (!expectedChallenge) {
    throw new Error("Challenge expired or not found");
  }

  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: getOrigin(),
    expectedRPID: getRpId(),
    credential: {
      id: credential.credentialId,
      publicKey: base64URLToUint8Array(credential.publicKey) as Uint8Array<ArrayBuffer>,
      counter: credential.counter,
      transports: credential.transports as AuthenticatorTransport[] | undefined,
    },
  });
}

// --- Label Generation ---

export function inferPasskeyLabel(
  ua: string,
  backupEligible: boolean,
  authenticatorAttachment?: string,
): string {
  if (authenticatorAttachment === "cross-platform") {
    return "安全密钥";
  }

  // Platform authenticator — infer from UA
  if (/Windows/.test(ua)) return "Windows Hello";
  if (/iPhone|iPad|Macintosh|Mac OS/.test(ua)) {
    return backupEligible ? "iCloud 钥匙串" : "Touch ID";
  }
  if (/Android/.test(ua)) {
    return backupEligible ? "Google 密码管理器" : "Android";
  }

  return "安全密钥";
}

export function deduplicateLabel(label: string, existingLabels: string[]): string {
  if (!existingLabels.includes(label)) return label;
  let i = 2;
  while (existingLabels.includes(`${label} #${i}`)) i++;
  return `${label} #${i}`;
}

// --- Helpers ---

export function base64URLToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64URL(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
