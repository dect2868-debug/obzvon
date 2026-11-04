/* ============================================================
   Сборщик статистики ОБЗВОН v6.1 (Node-вариант)

   Для тех, у кого нет PHP. Запуск:
     node tools/collector.js 8080

   Сайт шлёт события POST-ом на этот адрес (он должен быть на ТОМ ЖЕ
   домене, что и сайт — иначе запрос закроет CSP).
   В config.json:
     "collect": { "url": "http://127.0.0.1:8080/collect" }

   Данные пишутся в data/stats.json (рядом с tools/).
   Никаких личных данных: только случайный id устройства, тип события
   и время.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data');
const FILE = path.join(DIR, 'stats.json');
const PORT = parseInt(process.argv[2], 10) || 8080;

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      people: (d && typeof d.people === 'object' && d.people) || {},
      events: (d && typeof d.events === 'object' && d.events) || {},
      updatedAt: (d && d.updatedAt) || null,
      last: (d && d.last) || 0
    };
  } catch (e) {
    return { people: {}, events: {}, updatedAt: null, last: 0 };
  }
}

function write(d) {
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(d, null, 2), 'utf8');
  } catch (e) { console.error('не записать:', e.message); }
}

const http = require('http');

http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let in_ = null;
      try { in_ = JSON.parse(body); } catch (e) { in_ = null; }
      if (!in_ || !in_.id || !in_.ev) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'нужен id и ev' }));
        return;
      }
      const id = String(in_.id).replace(/[^a-z0-9]/gi, '').slice(0, 64);
      const ev = String(in_.ev).replace(/[^a-z_.]/gi, '').slice(0, 32);
      if (!id || !ev) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'пустые id или ev' }));
        return;
      }
      const d = read();
      d.people[id] = (d.people[id] || 0) + 1;
      d.events[ev] = (d.events[ev] || 0) + 1;
      d.last = Number(in_.ts) || Date.now();
      d.updatedAt = new Date().toISOString();
      write(d);
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (req.method === 'GET') {
    const d = read();
    let visits = 0;
    Object.keys(d.people).forEach((k) => { visits += Number(d.people[k]) || 0; });
    res.end(JSON.stringify({
      ok: true,
      visitors: Object.keys(d.people).length,
      visits: visits,
      events: d.events,
      updatedAt: d.updatedAt
    }));
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ ok: false }));
}).listen(PORT, '127.0.0.1', () => {
  console.log('Сборщик статистики ОБЗВОН слушает: http://127.0.0.1:' + PORT);
  console.log('Данные: ' + FILE);
  console.log('В config.json укажите: "collect": { "url": "http://127.0.0.1:' + PORT + '/collect" }');
});
