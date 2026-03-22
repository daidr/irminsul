import fs from "node:fs";
import crypto from "node:crypto";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["irminsul", "secrets"]);

const SECRETS_PATH = "./irminsul-data/auto-generate/secrets.yaml";

interface Secrets {
  altcha_hmac_key_signature_secret: string;
  altcha_hmac_signature_secret: string;
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

let _secrets: Secrets | null = null;

export function loadSecrets(): void {
  if (fs.existsSync(SECRETS_PATH)) {
    const raw = fs.readFileSync(SECRETS_PATH, "utf-8");
    const parsed = Bun.YAML.parse(raw) as Partial<Secrets>;

    if (parsed.altcha_hmac_key_signature_secret && parsed.altcha_hmac_signature_secret) {
      logger.info`Secrets loaded from ${SECRETS_PATH}`;
      _secrets = parsed as Secrets;
      return;
    }

    logger.warn`Secrets file incomplete, regenerating...`;
  }

  const generated: Secrets = {
    altcha_hmac_key_signature_secret: generateSecret(),
    altcha_hmac_signature_secret: generateSecret(),
  };

  fs.writeFileSync(SECRETS_PATH, Bun.YAML.stringify(generated), "utf-8");
  logger.info`Secrets generated and saved to ${SECRETS_PATH}`;
  _secrets = generated;
}

export const secrets: Secrets = new Proxy({} as Secrets, {
  get(_target, prop: string) {
    if (!_secrets) {
      throw new Error("Secrets not initialized. Call loadSecrets() first (plugin 07).");
    }
    return _secrets[prop as keyof Secrets];
  },
});
