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
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMS4xODIgNS4wOTNBMy4yIDMuMiAwIDAgMSAxMi43IDIuN2EzLjI3IDMuMjcgMCAwIDAtMi41NzItMS4zMTNjLTEuMDg2LS4xMTItMi4xMzguNjQxLTIuNjkuNjQxcy0xLjQyLS42My0yLjM0LS42MTNBMy40NSAzLjQ1IDAgMCAwIDIuMTggMy4xM0MuODkgNS4zNDggMS44NiA4LjY2OCAzLjEgMTAuNDc4Yy42MTguODkgMS4zNDggMS44ODggMi4zMDYgMS44NTIuOTMxLS4wMzggMS4yODEtLjU5OCAyLjQwNC0uNTk4czEuNDQuNTk4IDIuNDE3LjU3OGMxLS4wMTcgMS42My0uOSAyLjI0LTEuNzk2YTcuNyA3LjcgMCAwIDAgMS4wMjItMi4wODYgMy4xMSAzLjExIDAgMCAxLTEuODktMi44NnpNOS40MTIgMS40MjhBMy4xOCAzLjE4IDAgMCAwIDEwLjE0IDBhMy4yNCAzLjI0IDAgMCAwLTIuMDkgMS4wODIgMy4wMyAzLjAzIDAgMCAwLS43NSAyLjIgMi42OCAyLjY4IDAgMCAwIDIuMTEtMS44NTR6Ii8+PC9zdmc+",
    brandColor: "#000000",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "name email",
      state,
      response_type: "code",
      response_mode: "form_post",
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
    displayName: raw.email || raw.sub,
  }));

  ctx.log.info("Apple OAuth plugin loaded");
}
