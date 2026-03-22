import type { H3Event } from "h3";

const SESSION_COOKIE_NAME = "irmin_session";
const SESSION_PREFIX = "session";
const SESSION_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
const TOKEN_SEPARATOR = ".";

export interface SessionData {
  userId: string; // user uuid
  email: string;
  gameId: string;
  ip: string;
  ua: string;
  loginAt: number; // Unix timestamp ms
}

/** Redis key: irmin:session:<userId>:<sessionId> */
function sessionKey(userId: string, sessionId: string): string {
  return buildRedisKey(SESSION_PREFIX, userId, sessionId);
}

function generateSessionId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Encode userId + sessionId into a single cookie token */
function encodeToken(userId: string, sessionId: string): string {
  return `${userId}${TOKEN_SEPARATOR}${sessionId}`;
}

/** Decode cookie token back to userId + sessionId, returns null if malformed */
function decodeToken(token: string): { userId: string; sessionId: string } | null {
  const idx = token.indexOf(TOKEN_SEPARATOR);
  if (idx <= 0 || idx === token.length - 1) return null;
  return { userId: token.slice(0, idx), sessionId: token.slice(idx + 1) };
}

export async function createSession(event: H3Event, data: SessionData): Promise<void> {
  const redis = getRedisClient();
  const sessionId = generateSessionId();
  const key = sessionKey(data.userId, sessionId);
  await redis.send("SET", [
    key,
    JSON.stringify(data),
    "EX",
    SESSION_EXPIRY_SECONDS.toString(),
  ]);
  const token = encodeToken(data.userId, sessionId);
  setCookie(event, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    path: "/",
    maxAge: SESSION_EXPIRY_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
  });
}

export async function getSessionData(event: H3Event): Promise<SessionData | null> {
  const token = getCookie(event, SESSION_COOKIE_NAME);
  if (!token) return null;
  const parsed = decodeToken(token);
  if (!parsed) return null;
  const redis = getRedisClient();
  const key = sessionKey(parsed.userId, parsed.sessionId);
  const raw = (await redis.send("GET", [key])) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

export async function destroySession(event: H3Event): Promise<void> {
  const token = getCookie(event, SESSION_COOKIE_NAME);
  if (!token) return;
  const parsed = decodeToken(token);
  if (parsed) {
    const redis = getRedisClient();
    const key = sessionKey(parsed.userId, parsed.sessionId);
    await redis.send("DEL", [key]);
  }
  deleteCookie(event, SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
  });
}

export async function getCurrentSessionId(event: H3Event): Promise<string | null> {
  const token = getCookie(event, SESSION_COOKIE_NAME);
  if (!token) return null;
  const parsed = decodeToken(token);
  return parsed ? parsed.sessionId : null;
}

/** Delete all sessions for a given user via SCAN */
export async function destroyAllSessions(userId: string): Promise<number> {
  const redis = getRedisClient();
  const pattern = buildRedisKey(SESSION_PREFIX, userId, "*");
  let cursor = "0";
  let deleted = 0;
  do {
    const result = (await redis.send("SCAN", [cursor, "MATCH", pattern, "COUNT", "100"])) as [
      string,
      string[],
    ];
    cursor = result[0];
    const keys = result[1];
    if (keys.length > 0) {
      await redis.send("DEL", keys);
      deleted += keys.length;
    }
  } while (cursor !== "0");
  return deleted;
}

/** 列出用户的所有活跃会话 */
export async function getAllSessions(
  userId: string,
): Promise<{ sessionId: string; data: SessionData }[]> {
  const redis = getRedisClient();
  const pattern = buildRedisKey(SESSION_PREFIX, userId, "*");
  const prefix = buildRedisKey(SESSION_PREFIX, userId, "");
  const sessions: { sessionId: string; data: SessionData }[] = [];
  let cursor = "0";
  do {
    const result = (await redis.send("SCAN", [cursor, "MATCH", pattern, "COUNT", "100"])) as [
      string,
      string[],
    ];
    cursor = result[0];
    const keys = result[1];
    if (keys.length > 0) {
      const values = (await redis.send("MGET", keys)) as (string | null)[];
      for (let i = 0; i < keys.length; i++) {
        const raw = values[i];
        if (raw) {
          const sessionId = keys[i].slice(prefix.length);
          sessions.push({ sessionId, data: JSON.parse(raw) as SessionData });
        }
      }
    }
  } while (cursor !== "0");
  return sessions;
}

/** 删除指定用户的单个会话（通过 sessionId） */
export async function destroySessionById(userId: string, sessionId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = sessionKey(userId, sessionId);
  const result = (await redis.send("DEL", [key])) as number;
  return result > 0;
}

/** 删除用户的所有其他会话（保留当前 sessionId） */
export async function destroyOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const redis = getRedisClient();
  const pattern = buildRedisKey(SESSION_PREFIX, userId, "*");
  const currentKey = sessionKey(userId, currentSessionId);
  let cursor = "0";
  let deleted = 0;
  do {
    const result = (await redis.send("SCAN", [cursor, "MATCH", pattern, "COUNT", "100"])) as [
      string,
      string[],
    ];
    cursor = result[0];
    const keys = result[1].filter((k) => k !== currentKey);
    if (keys.length > 0) {
      await redis.send("DEL", keys);
      deleted += keys.length;
    }
  } while (cursor !== "0");
  return deleted;
}
