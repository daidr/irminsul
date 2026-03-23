import fs from "node:fs";
import crypto from "node:crypto";

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
  const log = createLogger({ category: "secrets" });
  if (fs.existsSync(SECRETS_PATH)) {
    const raw = fs.readFileSync(SECRETS_PATH, "utf-8");
    const parsed = Bun.YAML.parse(raw) as Partial<Secrets>;

    if (parsed.altcha_hmac_key_signature_secret && parsed.altcha_hmac_signature_secret) {
      log.set({ action: "loadSecrets", source: SECRETS_PATH, status: "loaded" });
      _secrets = parsed as Secrets;
      log.emit();
      return;
    }

    log.set({ warning: "secrets_file_incomplete" });
  }

  const generated: Secrets = {
    altcha_hmac_key_signature_secret: generateSecret(),
    altcha_hmac_signature_secret: generateSecret(),
  };

  fs.writeFileSync(SECRETS_PATH, Bun.YAML.stringify(generated), "utf-8");
  _secrets = generated;
  log.set({ action: "loadSecrets", source: SECRETS_PATH, status: "generated" });
  log.emit();
}

export const secrets: Secrets = new Proxy({} as Secrets, {
  get(_target, prop: string) {
    if (!_secrets) {
      throw new Error("Secrets not initialized. Call loadSecrets() first (plugin 07).");
    }
    return _secrets[prop as keyof Secrets];
  },
});
