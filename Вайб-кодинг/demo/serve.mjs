// Локальная проверка демо так, как его отдаст GitHub Pages (статика в подпапке /mgimochallenge/).
// Запуск: node demo/serve.mjs  →  http://localhost:4000/mgimochallenge/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-demo');
const PREFIX = '/mgimochallenge';
const PORT = Number(process.env.PORT || 4000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(PREFIX)) { res.writeHead(302, { Location: PREFIX + '/' }); return res.end(); }
  let file = path.join(dir, p.slice(PREFIX.length));
  if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('404 (как на GitHub Pages)'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Демо: http://localhost:${PORT}${PREFIX}/`));
