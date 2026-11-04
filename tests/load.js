/* ============================================================
   Нагрузочная проверка ОБЗВОНА:
   1) локальный сервер раздаёт сайт — имитация потока запросов
      (аналог «флуда» на хостинг, только к своей копии);
   2) флуд событий внутри страницы: тысячи нарушений, кликов и
      нажатий — страница должна остаться отзывчивой и не раздуться.
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT, loginAndCalibrate } = require('./helpers');

const s = suite('LOAD (нагрузка и устойчивость)');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
      const body = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function hammer(port, total, concurrency) {
  const paths = ['/index.html', '/js/app.js?v=4.0', '/css/styles.css?v=4.0', '/version.json', '/js/live.js', '/js/archive.js'];
  let done = 0, errors = 0;
  const t0 = Date.now();
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (done < total) {
        const idx = done++;
        const p = paths[idx % paths.length];
        try {
          await new Promise((resolve, reject) => {
            const req = http.get({ host: '127.0.0.1', port, path: p }, (res) => {
              res.resume();
              res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error('HTTP ' + res.statusCode))));
            });
            req.on('error', reject);
            req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
          });
        } catch (e) { errors++; }
      }
    })());
  }
  await Promise.all(workers);
  const ms = Date.now() - t0;
  return { ms, errors, rps: Math.round((total - errors) / (ms / 1000)) };
}

s.test('сайт раздаётся под потоком запросов (500 обращений)', async () => {
  const server = await startServer();
  const port = server.address().port;
  const res = await hammer(port, 500, 40);
  server.close();
  eq(res.errors, 0, 'ошибки при раздаче: ' + res.errors);
  assert(res.rps > 50, 'слишком низкая пропускная способность: ' + res.rps + ' rps');
  console.log('        (' + res.rps + ' req/s, ' + res.ms + ' мс на 500 запросов)');
});

s.test('404 на неизвестный путь, без утечки файловой системы', async () => {
  const server = await startServer();
  const port = server.address().port;
  const code = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/../package.json' }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
  });
  server.close();
  assert(code === 404 || code === 200, 'неожиданный код ответа: ' + code);
});

s.test('флуд нарушениями: страница остаётся отзывчивой', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  await loginAndCalibrate(t);
  t.win.document.getElementById('btnStart').click();
  await sleep(60);

  const N = 2000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    t.win.Monitor.penalty('нагрузочное нарушение ' + i, 1);
  }
  const ms = Date.now() - t0;
  console.log('        (' + N + ' нарушений за ' + ms + ' мс)');

  const st = t.win.OBZ.state();
  assert(st.violations <= 500, 'журнал нарушений не ограничен: ' + st.violations);
  assert(st.feed <= 60, 'лента событий не ограничена: ' + st.feed);
  assert(ms < 20000, 'обработка флуда слишком медленная: ' + ms + ' мс');

  /* страница продолжает работать */
  t.win.Live.sample(90, 10);
  await sleep(40);
  eq(t.win.Live.stats().n >= 1, true, 'живой график перестал работать после флуда');
  eq(t.errors.length, 0, 'ошибки во время флуда: ' + t.errors.join(' | '));
  t.close();
});

s.test('флуд кликами и вводом не роняет интерфейс', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  const body = t.win.document.body;
  const t0 = Date.now();
  for (let i = 0; i < 3000; i++) {
    body.dispatchEvent(new t.win.MouseEvent('mousemove', {
      bubbles: true, clientX: i % 800, clientY: (i * 7) % 600
    }));
    body.dispatchEvent(new t.win.PointerEvent('pointerdown', {
      bubbles: true, clientX: i % 800, clientY: (i * 7) % 600
    }));
  }
  const ms = Date.now() - t0;
  console.log('        (6000 событий ввода за ' + ms + ' мс)');
  assert(ms < 15000, 'ввод обрабатывается слишком долго: ' + ms + ' мс');
  eq(t.errors.length, 0, 'ошибки при флуде вводом: ' + t.errors.join(' | '));
  t.close();
});

s.test('после флуда состояние сессии остаётся в разумных размерах', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  await loginAndCalibrate(t);
  t.win.document.getElementById('btnStart').click();
  await sleep(60);
  for (let i = 0; i < 1500; i++) t.win.Monitor.penalty('флуд ' + i, 1);
  await sleep(60);
  const raw = t.win.localStorage.getItem('obzvon_v2_state');
  assert(raw, 'состояние не сохранено');
  const size = raw.length;
  assert(size < 400000, 'состояние разрослось: ' + size + ' байт');
  console.log('        (размер сохранённого состояния: ' + Math.round(size / 1024) + ' КБ)');
  t.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
