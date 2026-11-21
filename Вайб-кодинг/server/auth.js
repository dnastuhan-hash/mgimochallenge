import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Пароль → «scrypt$N$r$p$соль$хеш». Открытый пароль нигде не хранится. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Фиктивный хеш: проверяем его, если логин не найден, — чтобы время ответа не выдавало, существует ли пользователь.
let dummyHash = null;
export async function verifyPassword(password, stored) {
  if (!stored) {
    dummyHash ??= await hashPassword('dummy-password');
    stored = dummyHash;
    await verifyPassword(password, stored);
    return false;
  }
  const [alg, N, r, p, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64url');

/** Простой ограничитель попыток входа (в памяти процесса). */
const attempts = new Map();
export function rateLimit(key, limit = 8, windowMs = 5 * 60_000) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.start > windowMs) {
    attempts.set(key, { start: now, count: 1 });
    return { ok: true };
  }
  rec.count++;
  if (rec.count > limit) return { ok: false, retryAfter: Math.ceil((rec.start + windowMs - now) / 1000) };
  return { ok: true };
}
export const resetRate = (key) => attempts.delete(key);
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now - v.start > 10 * 60_000) attempts.delete(k);
}, 60_000).unref();
