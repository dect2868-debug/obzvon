/* ============================================================
   Стресс-тест ОБЗВОНА (тестовая «дудос»-нагрузка)
   ВАЖНО: нагрузка идёт ТОЛЬКО на локальную копию сайта, которая
   поднята здесь же, на вашей машине. На живой сайт (GitHub Pages)
   запросы не идут: это инфраструктура GitHub, и нагрузка на неё —
   DoS-атака на чужой хостинг.
   Две части:
     1) сетевая нагрузка — поток HTTP-запросов к локальной копии;
     2) нагрузка внутри страницы — десятки тысяч событий и нарушений.
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { boot, sleep, ROOT, loginAndCalibrate } = require('./helpers');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
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

/* поток запросов с ограничением параллелизма */
async function flood(port, total, concurrency, label) {
  const paths = ['/index.html', '/js/app.js?v=4.2', '/css/styles.css?v=4.2', '/version.json',
                 '/js/live.js', '/js/archive.js', '/js/health.js', '/js/monitor.js'];
  let done = 0, errors = 0, bytes = 0;
  const lat = [];
  const t0 = Date.now();
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (done < total) {
        const idx = done++;
        const p = paths[idx % paths.length];
        const ts = Date.now();
        try {
          await new Promise((resolve, reject) => {
            const req = http.get({ host: '127.0.0.1', port, path: p }, (res) => {
              let n = 0;
              res.on('data', (c) => { n += c.length; });
              res.on('end', () => {
                bytes += n; lat.push(Date.now() - ts);
                res.statusCode === 200 ? resolve() : reject(new Error('HTTP ' + res.statusCode));
              });
            });
            req.on('error', reject);
            req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
          });
        } catch (e) { errors++; }
      }
    })());
  }
  await Promise.all(workers);
  const ms = Date.now() - t0;
  lat.sort((a, b) => a - b);
  const pct = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] : 0);
  const rps = Math.round((total - errors) / (ms / 1000));
  console.log('\n  [' + label + ']');
  console.log('    запросов:        ' + total + ' (параллелизм ' + concurrency + ')');
  console.log('    время:           ' + ms + ' мс');
  console.log('    пропускная:      ' + rps + ' req/s');
  console.log('    ошибок:          ' + errors);
  console.log('    отдано:           ' + (bytes / 1048576).toFixed(1) + ' МБ');
  console.log('    задержка p50/p95: ' + pct(0.5) + ' / ' + pct(0.95) + ' мс');
  return { total, errors, ms, rps, p50: pct(0.5), p95: pct(0.95) };
}

/* нагрузка внутри страницы */
async function pageFlood(events, violations) {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  await loginAndCalibrate(t);
  await sleep(10);
  t.el('btnStart').click();
  await sleep(80);

  const t0 = Date.now();
  for (let i = 0; i < events; i++) {
    t.win.document.body.dispatchEvent(new t.win.MouseEvent('mousemove', {
      bubbles: true, clientX: i % 1200, clientY: (i * 13) % 800
    }));
  }
  const tEvents = Date.now() - t0;

  const t1 = Date.now();
  for (let i = 0; i < violations; i++) t.win.Monitor.penalty('стресс ' + i, 1);
  const tViol = Date.now() - t1;

  const t2 = Date.now();
  t.win.Live.sample(90, 5);
  const tLive = Date.now() - t2;

  const raw = t.win.localStorage.getItem('obzvon_v2_state') || '';
  const heap = (() => {
    try { return t.win.performance && t.win.performance.memory
      ? +(t.win.performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null; } catch (e) { return null; }
  })();
  const errs = t.errors.slice();
  const feed = t.win.OBZ.state().feed;
  const violLog = t.win.Monitor.state.viol.length;
  t.close();

  console.log('\n  [нагрузка внутри страницы]');
  console.log('    событий ввода:    ' + events + ' за ' + tEvents + ' мс (' +
    (tEvents / events).toFixed(3) + ' мс/событие)');
  console.log('    нарушений:        ' + violations + ' за ' + tViol + ' мс (' +
    (tViol / violations).toFixed(3) + ' мс/нарушение)');
  console.log('    отклик графика:   ' + tLive + ' мс');
  console.log('    лента событий:    ' + feed + ' записей (ограничена)');
  console.log('    журнал нарушений: ' + violLog + ' записей (ограничен)');
  console.log('    состояние в LS:   ' + Math.round(raw.length / 1024) + ' КБ');
  if (heap !== null) console.log('    JS-heap:           ' + heap + ' МБ');
  console.log('    ошибок страницы:  ' + errs.length + (errs.length ? ' — ' + errs.slice(0, 2).join(' | ') : ''));
  return { events, violations, tEvents, tViol, errs: errs.length, feed, violLog, stateKB: Math.round(raw.length / 1024) };
}

(async () => {
  console.log('================================================');
  console.log('СТРЕСС-ТЕСТ ОБЗВОНА (нагрузка на локальную копию)');
  console.log('================================================');

  const server = await startServer();
  const port = server.address().port;
  const r1 = await flood(port, 1000, 50, 'волна 1 — умеренная (1000 запросов)');
  const r2 = await flood(port, 5000, 150, 'волна 2 — сильная (5000 запросов)');
  const r3 = await flood(port, 3000, 300, 'волна 3 — пиковая (3000 запросов, 300 параллельно)');
  server.close();

  const p = await pageFlood(50000, 5000);

  console.log('\n------------------------------------------------');
  console.log('ИТОГ');
  console.log('  сетевая нагрузка: ' + (r1.total + r2.total + r3.total) + ' запросов, ошибок: ' +
    (r1.errors + r2.errors + r3.errors));
  console.log('  пиковая скорость:  ' + Math.max(r1.rps, r2.rps, r3.rps) + ' req/s, задержка p95: ' +
    Math.max(r1.p95, r2.p95, r3.p95) + ' мс');
  console.log('  нагрузка в странице: ' + p.events + ' событий за ' + p.tEvents + ' мс, нарушений ' +
    p.violations + ' за ' + p.tViol + ' мс');
  console.log('  устойчивость:      журналы ограничены (' + p.feed + '/' + p.violLog +
    '), состояние ' + p.stateKB + ' КБ, ошибок ' + p.errs);
  console.log('------------------------------------------------');

  const ok = (r1.errors + r2.errors + r3.errors) === 0 && p.errs === 0 && p.feed <= 60 && p.violLog <= 500;
  console.log(ok ? 'РЕЗУЛЬТАТ: сайт выдержал нагрузку без потерь' : 'РЕЗУЛЬТАТ: есть проблемы (см. выше)');
  process.exit(ok ? 0 : 1);
})();
