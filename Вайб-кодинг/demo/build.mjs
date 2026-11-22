// Сборка статической демо-версии для GitHub Pages: node demo/build.mjs  →  папка dist-demo/
// В неё копируются фронтенд (public/), общие серверные модули (server/*.js без Node-зависимостей),
// «сервер в браузере» (demo/browser-server.js) и библиотеки (sql.js, qrcode-generator).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-demo');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });

fs.mkdirSync(path.join(out, 'server'));
for (const f of ['schema.js', 'routes.js', 'logic.js', 'ics.js', 'time.js']) fs.copyFileSync(path.join(root, 'server', f), path.join(out, 'server', f));
fs.mkdirSync(path.join(out, 'demo'));
fs.copyFileSync(path.join(root, 'demo', 'browser-server.js'), path.join(out, 'demo', 'browser-server.js'));

fs.mkdirSync(path.join(out, 'vendor'));
const vendor = {
  'qrcode.js': 'node_modules/qrcode-generator/qrcode.js',
  'sql-wasm.js': 'node_modules/sql.js/dist/sql-wasm.js',
  'sql-wasm.wasm': 'node_modules/sql.js/dist/sql-wasm.wasm',
};
for (const [to, from] of Object.entries(vendor)) fs.copyFileSync(path.join(root, from), path.join(out, 'vendor', to));

// На GitHub Pages нельзя задать заголовки — политика безопасности задаётся мета-тегом.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">`;
const DEMO_SCRIPTS = '<script src="vendor/sql-wasm.js" defer></script>\n  <script type="module" src="demo/browser-server.js"></script>\n  ';
for (const page of ['index.html', 'verify.html']) {
  const file = path.join(out, page);
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${CSP}`);
  // «сервер» должен подключиться раньше скриптов интерфейса
  html = html.replace(page === 'index.html' ? '<script src="core.js"' : '<script src="verify.js"', (m) => DEMO_SCRIPTS + m);
  fs.writeFileSync(file, html);
}
// verify.js — обычный скрипт; в демо он должен дождаться модуля, поэтому подключаем его отложенно (defer уже стоит).
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Демо собрано: ${out}`);
