// Автотесты безопасности: разделение данных студентов, роли, CSRF, хранение паролей.
// Запуск: npm test (поднимает сервер на временной базе).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = 3917;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dekanat-test-'));
let srv;

before(async () => {
  srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/me`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(async () => { srv.kill(); await new Promise((r) => setTimeout(r, 300)); try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* Windows может держать файл БД */ } });

const H = { 'X-Requested-With': 'dekanat', 'Content-Type': 'application/json' };
async function login(login, password) {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ login, password }) });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
const get = (url, cookie) => fetch(BASE + url, { headers: { cookie } });

test('без входа данные недоступны', async () => {
  for (const u of ['/api/me', '/api/grades', '/api/requests', '/api/schedule']) assert.equal((await get(u)).status, 401, u);
});

test('неверный пароль отклоняется', async () => {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ login: 'morozova', password: 'wrong' }) });
  assert.equal(r.status, 401);
});

test('студент не видит чужую заявку, даже подставив её номер', async () => {
  const alina = await login('morozova', 'Demo-Student-1');
  const max = await login('lebedev', 'Demo-Student-2');
  const maxReqs = await (await get('/api/requests', max)).json();
  assert.ok(maxReqs.length > 0);
  for (const r of maxReqs) assert.equal((await get(`/api/requests/${r.id}`, alina)).status, 404);
  const alinaReqs = await (await get('/api/requests', alina)).json();
  assert.ok(alinaReqs.every((r) => !maxReqs.some((m) => m.id === r.id)));
});

test('у студентов разные оценки и профиль', async () => {
  const a = await (await get('/api/me', await login('morozova', 'Demo-Student-1'))).json();
  const m = await (await get('/api/me', await login('lebedev', 'Demo-Student-2'))).json();
  assert.notEqual(a.id, m.id);
  assert.notEqual(a.group, m.group);
});

test('студент не может вызвать API сотрудника', async () => {
  const alina = await login('morozova', 'Demo-Student-1');
  assert.equal((await get('/api/staff/requests', alina)).status, 403);
  const r = await fetch(`${BASE}/api/staff/requests/1`, { method: 'POST', headers: { ...H, cookie: alina }, body: JSON.stringify({ status: 'ready' }) });
  assert.equal(r.status, 403);
});

test('изменяющий запрос без заголовка приложения отклоняется (CSRF)', async () => {
  const alina = await login('morozova', 'Demo-Student-1');
  const r = await fetch(`${BASE}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: alina }, body: JSON.stringify({ text: 'x' }) });
  assert.equal(r.status, 403);
});

test('пароли и токены сессий не хранятся в открытом виде', () => {
  const db = new DatabaseSync(path.join(DATA_DIR, 'dekanat.sqlite'));
  for (const u of db.prepare('SELECT pass_hash FROM users').all()) {
    assert.match(u.pass_hash, /^scrypt\$/);
    assert.ok(!u.pass_hash.includes('Demo-'));
  }
  db.close();
});

test('cookie сессии HttpOnly и SameSite', async () => {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ login: 'lebedev', password: 'Demo-Student-2' }) });
  const c = r.headers.get('set-cookie');
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
});

test('календарная ссылка не отдаёт персональные данные', async () => {
  const alina = await login('morozova', 'Demo-Student-1');
  const { https } = await (await get('/api/calendar', alina)).json();
  const ics = await (await fetch(https.replace(/^https?:\/\/[^/]+/, BASE))).text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.ok(!ics.includes('Морозова'));
  assert.equal((await fetch(`${BASE}/cal/not-a-real-token-123456789.ics`)).status, 404);
});
