/* ============================================================
   Локальный сервер для проверки сборки:  node tools/serve.js [порт]
   Отдаёт папку dist/ (как на обычном хостинге).
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = parseInt(process.argv[2], 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.log('Сборки нет — сначала: node tools/build.js');
  process.exit(1);
}

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(DIST, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => {
  console.log('Сайт собран и раздаётся локально:');
  console.log('  http://127.0.0.1:' + PORT + '/            — обычная версия');
  console.log('  http://127.0.0.1:' + PORT + '/index.single.html — всё в одном файле');
  console.log('Остановить: Ctrl+C');
});
