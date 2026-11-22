// «Деканат Next» — концепт личного кабинета студента. Сервер без фреймворков: node:http + node:sqlite.
// Здесь только «адаптер» Node.js: cookie, заголовки безопасности, статика. Вся логика API — в routes.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, openDb, seedIfEmpty } from './db.js';
import { hashPassword, randomToken, rateLimit, resetRate, sha256, verifyPassword } from './auth.js';
import { createApi, SESSION_TTL } from './routes.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.resolve('public');
const reset = process.argv.includes('--reset') || process.argv.includes('--reset-only');

const db = openDb(reset);
if (await seedIfEmpty(db, { hashPassword, randomToken })) console.log('База создана и заполнена вымышленными демо-данными');
if (process.argv.includes('--reset-only')) process.exit(0);

// Секрет для подписи QR студбилета: из переменной окружения или генерируется и хранится в DATA_DIR (не в коде, не в браузере).
const SECRET = process.env.APP_SECRET || (() => {
  const f = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
})();
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, 22);

const api = createApi({ db, verifyPassword, randomToken, sha256, sign, rateLimit, resetRate });

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}), ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
const baseUrl = (req) => process.env.PUBLIC_URL?.replace(/\/$/, '') || `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
const clientIp = (req) => (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim();

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 64 * 1024) return { tooLarge: true }; chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return { badJson: true }; }
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const sessionCookie = (req, token, maxAge) =>
  `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;

// ---------- статика ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const VENDOR = { '/vendor/qrcode.js': path.resolve('node_modules/qrcode-generator/qrcode.js') };
function serveStatic(req, res, pathname) {
  let file = VENDOR[pathname] || path.join(PUBLIC, decodeURIComponent(pathname));
  if (!VENDOR[pathname] && !file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  const ext = path.extname(file);
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/');
    if (!isApi) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Метод не поддерживается' });
      return serveStatic(req, res, url.pathname);
    }
    let body = {};
    if (req.method !== 'GET') {
      // Защита от CSRF: изменяющие запросы — только из нашего фронтенда (свой заголовок + совпадение Origin)
      const origin = req.headers.origin;
      if (req.headers['x-requested-with'] !== 'dekanat' || (origin && new URL(origin).host !== req.headers.host)) return send(res, 403, { error: 'Запрос отклонён' });
      body = await readJson(req);
      if (body.tooLarge) return send(res, 413, { error: 'Слишком большой запрос' });
      if (body.badJson) return send(res, 400, { error: 'Некорректный JSON' });
    }
    const out = await api.handle(req.method, url.pathname, { query: url.searchParams, body, sid: parseCookies(req).sid || null, ip: clientIp(req), baseUrl: baseUrl(req) });
    if (!out) return send(res, 404, { error: 'Не найдено' });
    if (out.raw != null) return send(res, out.status, out.raw, out.headers);
    const headers = {};
    if ('setSession' in out) headers['Set-Cookie'] = sessionCookie(req, out.setSession, out.setSession ? SESSION_TTL / 1000 : 0);
    send(res, out.status, out.body, headers);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Внутренняя ошибка сервера. Попробуйте ещё раз.' });
  }
});
server.listen(PORT, () => console.log(`Деканат Next: http://localhost:${PORT}`));
