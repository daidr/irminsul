import { createChallenge, verifySolution, pbkdf2 } from "altcha/lib";
import type { Challenge, Solution } from "altcha/lib";

export async function createAltchaChallenge() {
  return createChallenge({
    algorithm: "PBKDF2/SHA-256",
    cost: 5_000,
    expiresAt: Date.now() / 1000 + 5 * 60,
    deriveKey: pbkdf2.deriveKey,
    hmacKeySignatureSecret: secrets.altcha_hmac_key_signature_secret,
    hmacSignatureSecret: secrets.altcha_hmac_signature_secret,
  });
}

export async function verifyAltchaPayload(payload: string): Promise<
  | false
  | {
      expired: boolean;
      verified: boolean;
    }
> {
  try {
    const { challenge, solution } = JSON.parse(atob(payload)) as {
      challenge: Challenge;
      solution: Solution;
    };
    const result = await verifySolution({
      challenge,
      deriveKey: pbkdf2.deriveKey,
      hmacKeySignatureSecret: secrets.altcha_hmac_key_signature_secret,
      hmacSignatureSecret: secrets.altcha_hmac_signature_secret,
      solution,
    });

    if (!result.verified) {
      return { expired: false, verified: false };
    }

    if (result.expired) {
      return { expired: true, verified: true };
    }

    // Replay protection: mark this challenge as consumed using atomic SET NX EX.
    // The key expires after 300s (matching the 5-minute challenge validity window).
    // If SET NX returns null, the challenge was already consumed.
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(payload);
    const payloadHash = hasher.digest("hex");
    const redis = getRedisClient();
    const key = buildRedisKey("altcha", payloadHash);
    const setResult = await redis.send("SET", [key, "1", "NX", "EX", "300"]);

    if (setResult === null) {
      // Challenge already consumed — treat as verification failure
      return { expired: false, verified: false };
    }

    return {
      expired: result.expired,
      verified: result.verified,
    };
  } catch {
    return false;
  }
}
