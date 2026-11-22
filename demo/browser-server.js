// Демо-режим для GitHub Pages: тот же серверный код (server/routes.js, logic.js, schema.js) работает прямо в браузере.
// База — SQLite, скомпилированный в WebAssembly (sql.js), хранится в localStorage этого браузера.
// Запросы фронтенда к /api/... перехватываются и обрабатываются здесь же — без внешнего сервера.
//
// ВАЖНО: это демонстрационный режим. Настоящая защита (HttpOnly-cookie, хеши на сервере, разделение данных
// на стороне сервера) работает в серверной версии: npm start. См. README.
import { SCHEMA, seedIfEmpty } from '../server/schema.js';
import { createApi } from '../server/routes.js';

window.DEKANAT_DEMO = true;
Object.groupBy ??= (arr, fn) => arr.reduce((acc, x) => ((acc[fn(x)] ??= []).push(x), acc), Object.create(null));

const SITE = new URL('.', location.href.split('#')[0].split('?')[0]).href.replace(/\/$/, ''); // корень сайта (учитывает подпапку Pages)
const KEYS = { db: 'dekanat-demo-db-v1', sid: 'dekanat-demo-sid', secret: 'dekanat-demo-secret' };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* приватный режим */ } },
};

// ---------- криптография на WebCrypto ----------
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const ITER = 120_000;
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
/** Пароль → «pbkdf2$итерации$соль$хеш». Открытый пароль не хранится даже в демо. */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, ITER))}`;
}
async function verifyPassword(password, stored) {
  if (!stored) { await pbkdf2(password, new Uint8Array(16), ITER); return false; }
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2') return false;
  const got = b64url(await pbkdf2(password, fromB64url(salt), Number(iter)));
  let r = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) r |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return r === 0;
}
let hmacKey;
async function sign(s) {
  if (!hmacKey) {
    let secret = store.get(KEYS.secret);
    if (!secret) { secret = randomToken(32); store.set(KEYS.secret, secret); }
    hmacKey = await crypto.subtle.importKey('raw', fromB64url(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  return b64url(await crypto.subtle.sign('HMAC', hmacKey, enc.encode(s))).slice(0, 22);
}
const attempts = new Map();
function rateLimit(key, limit = 8, windowMs = 5 * 60_000) {
  const now = Date.now(), rec = attempts.get(key);
  if (!rec || now - rec.start > windowMs) { attempts.set(key, { start: now, count: 1 }); return { ok: true }; }
  return ++rec.count > limit ? { ok: false, retryAfter: Math.ceil((rec.start + windowMs - now) / 1000) } : { ok: true };
}
const resetRate = (key) => attempts.delete(key);

// ---------- адаптер sql.js под интерфейс node:sqlite (prepare().all/get/run) ----------
let dirty = false;
function wrap(sdb) {
  const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  const all = (sql, p) => {
    const st = sdb.prepare(sql);
    try { st.bind(norm(p)); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
  };
  return {
    exec: (sql) => { sdb.exec(sql); dirty = true; },
    prepare: (sql) => ({
      all: (...p) => all(sql, p),
      get: (...p) => all(sql, p)[0],
      run: (...p) => {
        const st = sdb.prepare(sql);
        try { st.bind(norm(p)); st.step(); } finally { st.free(); }
        dirty = true;
        return { changes: sdb.getRowsModified(), lastInsertRowid: sdb.exec('SELECT last_insert_rowid()')[0].values[0][0] };
      },
    }),
  };
}

let sdb, api;
function persist() {
  if (!dirty) return;
  dirty = false;
  const bytes = sdb.export();
  sdb.exec('PRAGMA foreign_keys = ON;'); // export() переоткрывает базу
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  store.set(KEYS.db, btoa(bin));
}
async function init() {
  const SQL = await window.initSqlJs({ locateFile: (f) => `${SITE}/vendor/${f}` });
  const saved = store.get(KEYS.db);
  let fresh = true;
  if (saved) {
    try { sdb = new SQL.Database(Uint8Array.from(atob(saved), (c) => c.charCodeAt(0))); fresh = false; } catch { sdb = null; }
  }
  if (!sdb) sdb = new SQL.Database();
  sdb.exec('PRAGMA foreign_keys = ON;');
  const db = wrap(sdb);
  if (fresh) { db.exec(SCHEMA); await seedIfEmpty(db, { hashPassword, randomToken }); dirty = true; persist(); }
  api = createApi({ db, verifyPassword, randomToken, sha256, sign, rateLimit, resetRate });
}
const ready = init();

/** Сбросить демо-данные этого браузера к исходным. */
window.dekanatDemoReset = () => { Object.values(KEYS).forEach(store.del); location.reload(); };

// ---------- перехват запросов к API ----------
const realFetch = window.fetch.bind(window);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
window.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const i = url.pathname.search(/\/(api|cal)\//);
  if (url.origin !== location.origin || i < 0) return realFetch(input, opts);
  try { await ready; } catch (e) { console.error(e); return json(500, { error: 'Не удалось запустить демо-базу в этом браузере. Обновите страницу.' }); }
  const method = (opts.method || 'GET').toUpperCase();
  let body = {};
  if (opts.body) { try { body = JSON.parse(opts.body); } catch { return json(400, { error: 'Некорректный JSON' }); } }
  const out = await api.handle(method, url.pathname.slice(i), { query: url.searchParams, body, sid: store.get(KEYS.sid), ip: 'browser', baseUrl: SITE });
  persist();
  if (!out) return json(404, { error: 'Не найдено' });
  if ('setSession' in out) { if (out.setSession) store.set(KEYS.sid, out.setSession); else store.del(KEYS.sid); }
  if (out.raw != null) return new Response(out.raw, { status: out.status, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
  // В демо нет сервера, который мог бы отдавать подписку календарям Google/Яндекс, — помечаем это для интерфейса
  if (url.pathname.endsWith('/api/calendar') && out.status === 200) out.body = { ...out.body, demo: true };
  return json(out.status, out.body);
};
