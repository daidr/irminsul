/**
 * Apple OAuth Plugin
 *
 * Apple Sign In 不提供标准的 userInfo 端点，用户信息从 id_token (JWT) 中解析。
 * client_secret 需要动态生成为 ES256 签名的 JWT。
 *
 * 语义复用：oauth:exchange-token 返回的 accessToken 实际是 id_token 原始值，
 * oauth:fetch-profile 从中解码用户信息。这是插件内部约定的协议。
 */

/** 将 PEM 格式私钥转为 CryptoKey */
async function importPrivateKey(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** Base64url 编码 */
function base64url(data) {
  if (typeof data === "string") {
    data = new TextEncoder().encode(data);
  }
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 解码 Base64url */
function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

/** 生成 Apple client_secret JWT（有效期 ~6 个月） */
async function generateClientSecret(teamId, clientId, keyId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 15776000,
    aud: "https://appleid.apple.com",
    sub: clientId,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );

  const signatureB64 = base64url(signature);
  return `${signingInput}.${signatureB64}`;
}

/** 解析 JWT payload（不验证签名，仅解码） */
function decodeJwtPayload(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  return JSON.parse(base64urlDecode(parts[1]));
}

export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "apple",
    name: "Apple",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='0.82em' height='1em' viewBox='0 0 256 315'%3E%3Cpath fill='%23fff' d='M213.803 167.03c.442 47.58 41.74 63.413 42.197 63.615c-.35 1.116-6.599 22.563-21.757 44.716c-13.104 19.153-26.705 38.235-48.13 38.63c-21.05.388-27.82-12.483-51.888-12.483c-24.061 0-31.582 12.088-51.51 12.871c-20.68.783-36.428-20.71-49.64-39.793c-27-39.033-47.633-110.3-19.928-158.406c13.763-23.89 38.36-39.017 65.056-39.405c20.307-.387 39.475 13.662 51.889 13.662c12.406 0 35.699-16.895 60.186-14.414c10.25.427 39.026 4.14 57.503 31.186c-1.49.923-34.335 20.044-33.978 59.822M174.24 50.199c10.98-13.29 18.369-31.79 16.353-50.199c-15.826.636-34.962 10.546-46.314 23.828c-10.173 11.763-19.082 30.589-16.678 48.633c17.64 1.365 35.66-8.964 46.64-22.262'/%3E%3C/svg%3E",
    brandColor: "#000000",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
    });
    return { url: `https://appleid.apple.com/auth/authorize?${params}` };
  });

  ctx.hook("oauth:exchange-token", async ({ code, redirectUri }) => {
    const clientSecret = await generateClientSecret(
      config.teamId,
      config.clientId,
      config.keyId,
      config.privateKey,
    );

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: clientSecret,
    });

    const res = await ctx.fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Apple token exchange failed (${res.status}): ${text}`);
    }

    const data = await res.json();

    // 将 id_token 作为 accessToken 传递给 fetch-profile 阶段
    return {
      accessToken: data.id_token,
      tokenType: "id_token",
    };
  });

  ctx.hook("oauth:fetch-profile", ({ accessToken }) => {
    // accessToken 实际上是 id_token JWT，解码 payload 即可获取用户信息
    return decodeJwtPayload(accessToken);
  });

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.sub),
    displayName: raw.sub,
  }));

  ctx.log.info("Apple OAuth plugin loaded");
}
