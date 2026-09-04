// Password hashing (PBKDF2 via Web Crypto), session tokens, cookie config.

const enc = new TextEncoder();
const PBKDF2_ITERS = 100_000;
const SESSION_DAYS = 30;

export function uid(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hexToBuf(hex) {
  return Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
}

export async function sha256hex(str) {
  return bufToHex(await crypto.subtle.digest("SHA-256", enc.encode(str)));
}

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    key,
    256,
  );
  return { hash: bufToHex(bits), salt: bufToHex(salt) };
}

// Used by the login route to spend the same PBKDF2 time when the email doesn't
// exist, so response timing can't be used to enumerate registered emails.
export const DUMMY_SALT = "00000000000000000000000000000000";

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyPassword(password, hashHex, saltHex) {
  const { hash } = await hashPassword(password, saltHex);
  return timingSafeEqual(hash, hashHex);
}

export async function createSession(db, userId) {
  const token = uid(32);
  const id = await sha256hex(token);
  const t = Date.now();
  await db
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, t, t + SESSION_DAYS * 86_400_000)
    .run();
  return token;
}

export async function getSessionUser(db, token) {
  if (!token) return null;
  const id = await sha256hex(token);
  return (
    (await db
      .prepare(
        `SELECT u.id, u.email, u.name
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ? AND s.expires_at > ?`,
      )
      .bind(id, Date.now())
      .first()) || null
  );
}

export async function destroySession(db, token) {
  if (!token) return;
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256hex(token)).run();
}

export const cookieName = "sid";
export const cookieBase = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
  maxAge: SESSION_DAYS * 86_400,
};
