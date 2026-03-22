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

function loadSecrets(): Secrets {
  if (fs.existsSync(SECRETS_PATH)) {
    const raw = fs.readFileSync(SECRETS_PATH, "utf-8");
    const parsed = Bun.YAML.parse(raw) as Partial<Secrets>;

    if (parsed.altcha_hmac_key_signature_secret && parsed.altcha_hmac_signature_secret) {
      logger.info`Secrets loaded from ${SECRETS_PATH}`;
      return parsed as Secrets;
    }

    logger.warn`Secrets file incomplete, regenerating...`;
  }

  const secrets: Secrets = {
    altcha_hmac_key_signature_secret: generateSecret(),
    altcha_hmac_signature_secret: generateSecret(),
  };

  fs.writeFileSync(SECRETS_PATH, Bun.YAML.stringify(secrets), "utf-8");
  logger.info`Secrets generated and saved to ${SECRETS_PATH}`;
  return secrets;
}

export const secrets = loadSecrets();
