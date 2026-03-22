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
    return {
      expired: result.expired,
      verified: result.verified,
    };
  } catch {
    return false;
  }
}
