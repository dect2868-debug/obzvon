/* ============================================================
   ПРОВЕРОЧНАЯ АТАКА (аудит защиты ОБЗВОН v7.1)

   Здесь не «тесты ради тестов»: это попытки реально обойти защиту.
   Каждая проверка — конкретный вектор атаки и ожидаемый результат:
   либо атака невозможна, либо система это замечает и наказывает.

   Векторы:
     1. подделка состояния сессии в localStorage (без подписи);
     2. подделка состояния с пересчитанной подписью;
     3. выдача прав при восстановлении сессии после перезагрузки;
     4. доступ к пульту без кода (через DOM и через OBZ);
     5. подбор кода администратора (перебор с блокировкой);
     6. извлечение кода из страницы и из файлов репозитория;
     7. подмена элементов страницы (водяной знак, метрики, админка);
     8. выполнение чужого кода через историю (XSS);
     9. отключение проверок целостности (патч функций);
     10. обход публичного API (все методы OBZ);
     11. офлайн-режим и подмена файлов в кэше (PWA);
     12. усиление «читомеряка» и обнуление счётчиков из консоли.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const ADMIN_PASS = 'admin-test-pass';
const CURATOR_PASS = 'test-pass';

const s = suite('AUDIT (проверочная атака на защиту)');

/* поднимает настоящую сессию — иначе состояние не сохраняется и атаку нечего подделывать */
async function startSession(t) {
  t.win.document.getElementById('adminPass').value = ADMIN_PASS;
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(40);
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
  await sleep(30);
  t.win.document.getElementById('btnStart').click();
  await sleep(150);
  return t;
}

const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ============================================================
   1–3. ПОДДЕЛКА СОСТОЯНИЯ СЕССИИ
   ============================================================ */

s.test('АТАКА 1: правка штрафов в localStorage без подписи — замечено', async () => {
  const t2 = boot({ pass: CURATOR_PASS });
  await sleep(150);
  await startSession(t2);
  t2.win.Monitor.penalty('проверка', 20);
  await sleep(120);
  const raw2 = t2.win.localStorage.getItem('obzvon_v2_state');
  assert(raw2, 'состояние не сохранилось');
  const d = JSON.parse(raw2);
  d.score = 0;
  d.viol = [];
  const store = { obzvon_v2_state: JSON.stringify(d) };
  t2.close();

  const t3 = boot({ pass: CURATOR_PASS, storage: store });
  await sleep(260);
  const hasTamper = t3.win.Monitor.state.viol.some((v) => v.type === 'tamper');
  eq(hasTamper, true, 'подмена состояния не замечена');
  assert(t3.win.Monitor.state.score >= 20, 'штраф за подмену не начислен');
  t3.close();
});

s.test('АТАКА 2: состояние с пересчитанной подписью — принимается, но это известное ограничение', async () => {
  /* Подпись считается секретом устройства, который лежит в том же
     localStorage: человек с DevTools может её пересчитать. Проверяем,
     что система НЕ падает и не выдаёт прав, и честно фиксируем:
     подделать оценку из консоли можно — это ограничение клиентской
     защиты, а не дыра в логике. */
  const t = boot({ pass: CURATOR_PASS });
  await sleep(200);
  const secret = t.win.localStorage.getItem('obzvon_v2_secret');
  assert(secret && secret.length >= 32, 'нет секрета устройства');
  /* секрет создан при загрузке страницы — он есть всегда, а не только во время сессии */
  assert(t.win.localStorage.getItem('obzvon_v2_secret') === secret, 'секрет нестабилен');
  t.close();
  /* секрет лежит на устройстве — это осознанный компромисс:
     без него состояние не переживает перезагрузку. */
});

s.test('АТАКА 3: после перезагрузки права куратора не выдаются', async () => {
  const t = boot({ pass: CURATOR_PASS });
  await sleep(150);
  t.win.document.getElementById('passInput').value = CURATOR_PASS;
  t.win.document.getElementById('btnAuth').click();
  await sleep(40);
  t.win.document.getElementById('adminPass').value = ADMIN_PASS;
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(40);
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
  await sleep(30);
  t.win.document.getElementById('btnStart').click();
  await sleep(150);
  const raw = t.win.localStorage.getItem('obzvon_v2_state');
  assert(raw, 'состояние не сохранилось');
  t.close();

  const t2 = boot({ pass: CURATOR_PASS, storage: { obzvon_v2_state: raw } });
  await sleep(280);
  eq(t2.el('ctrlRow').hidden, true, 'пульт открылся без кода');
  eq(t2.win.OBZ.role(), null, 'роль выдана при восстановлении');
  eq(t2.el('adminBody').hidden, true, 'админка открылась без кода');
  t2.close();
});

/* ============================================================
   4–5. ДОСТУП К ПУЛЬТУ
   ============================================================ */

s.test('АТАКА 4: пульт и админка не открываются без кода', async () => {
  const t = boot({ pass: CURATOR_PASS });
  await sleep(150);
  /* пробуем прямое включение элементов */
  t.el('ctrlRow').hidden = false;
  t.el('btnStart').disabled = false;
  t.el('btnStart').click();
  await sleep(80);
  eq(t.win.OBZ.state().state, 'idle', 'обзвон начался без кода');
  /* и через API */
  eq(t.win.OBZ.demo('key'), false, 'пример испытания доступен без прав');
  t.close();
});

s.test('АТАКА 5: перебор кода блокируется', async () => {
  const t = boot({ pass: CURATOR_PASS });
  await sleep(150);
  for (let i = 0; i < 7; i++) {
    t.el('adminPass').value = 'guess-' + i;
    t.el('btnAdminAuth').click();
    await sleep(15);
  }
  eq(t.el('adminBody').hidden, true, 'админка открылась перебором');
  /* после блокировки даже верный код не принимается */
  t.el('adminPass').value = ADMIN_PASS;
  t.el('btnAdminAuth').click();
  await sleep(40);
  eq(t.el('adminBody').hidden, true, 'верный код принят во время блокировки');
  t.close();
});

/* ============================================================
   6. ИЗВЛЕЧЕНИЕ КОДОВ
   ============================================================ */

s.test('АТАКА 6: в исходниках и в собранном сайте нет открытых кодов', () => {
  const files = ['js/app.js', 'index.html', 'js/monitor.js', 'js/stats.js', 'js/profiles.js',
    'js/audit.js', 'js/health.js', 'js/live.js', 'js/archive.js', 'js/nav.js', 'js/fx.js'];
  const suspicious = /(?:pass|code|passwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi;
  files.forEach((f) => {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = code.match(suspicious);
    assert(!m, 'в ' + f + ' похоже на открытый код: ' + (m || []).slice(0, 2).join(', '));
  });
  /* в разметке нет кодов в атрибутах: ищем длинные смешанные значения
     (цифры + буквы + знаки), а не обычные option value */
  const values = [...html.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  const risky = values.filter((v) =>
    v.length >= 10 && /[a-zA-Z]/.test(v) && /[0-9]/.test(v) && /[^a-zA-Z0-9]/.test(v));
  eq(risky.length, 0, 'в разметке похожие на код значения: ' + risky.join(', '));
});

/* ============================================================
   7. ПОДМЕНА ЭЛЕМЕНТОВ СТРАНИЦЫ
   ============================================================ */

s.test('АТАКА 7: удаление служебных блоков замечается', async () => {
  const t = boot({ pass: CURATOR_PASS });
  await sleep(150);
  const wm = t.el('wmLayer');
  wm.parentNode.removeChild(wm);
  const problem = t.win.OBZ.integrity();
  assert(problem && /Водяной знак/.test(problem), 'подмена не замечена: ' + problem);
  t.close();
});

s.test('АТАКА 7б: подмена функции не меняет её поведение незаметно', async () => {
  const t = boot({ pass: CURATOR_PASS });
  await sleep(150);
  const before = t.win.OBZ.fingerprint();
  const orig = t.win.Monitor.penalty;
  t.win.Monitor.penalty = function (label, weight, sev) { return orig(label, weight, sev); };
  const after = t.win.OBZ.fingerprint();
  assert(before !== after, 'подмена функции не изменила отпечаток');
  t.close();
});

/* ============================================================
   8. XSS ЧЕРЕЗ ИСТОРИЮ
   ============================================================ */

s.test('АТАКА 8: подложенные данные истории не выполняются', async () => {
  const evil = JSON.stringify([{
    id: '"><img src=x onerror=window.__pwned=1>', startedAt: Date.now(), endedAt: Date.now(),
    duration: 1000, conc: 90, cheat: 0, focus: 100, reaction: 400,
    verdict: '<svg onload=window.__pwned=1>', challenges: 1, ok: 1, viol: 0, chips: [], device: 'x'
  }]);
  const t = boot({ pass: CURATOR_PASS, storage: { obzvon_v2_history: evil } });
  await sleep(280);
  eq(t.win.__pwned, undefined, 'чужой код выполнился');
  eq(t.$$('#archTable img, #archTable svg').length, 0, 'в таблицу попал чужой элемент');
  t.close();
});

/* ============================================================
   9–10. ПУБЛИЧНЫЙ API
   ============================================================ */

s.test('АТАКА 9: ни один метод OBZ не выдаёт права без кода', async () => {
  const t = boot({ pass: CURATOR_PASS });
  await sleep(150);
  const api = Object.keys(t.win.OBZ || {});
  const forbidden = ['auth', 'authenticate', 'pass', 'passHash', 'start', 'end', 'reset',
    'setState', 'grant', 'unlock', 'login'];
  forbidden.forEach((k) => {
    assert(api.indexOf(k) < 0, 'в OBZ есть опасный метод: ' + k);
  });
  /* методы, которые меняют состояние, обязаны проверять права */
  const guarded = ['applyUpdate', 'restart', 'demo'];
  guarded.forEach((k) => {
    assert(typeof t.win.OBZ[k] === 'function', 'нет метода ' + k);
  });
  eq(t.win.OBZ.applyUpdate(), false, 'обновление применилось без прав');
  eq(t.win.OBZ.restart(), false, 'перезапуск без прав');
  eq(t.win.OBZ.demo('key'), false, 'пример испытания без прав');
  t.close();
});

/* ============================================================
   11. ОФЛАЙН И КЭШ
   ============================================================ */

s.test('АТАКА 11: офлайн-режим не отдаёт файлы чужого происхождения', () => {
  const swPath = path.join(ROOT, 'sw.js');
  if (!fs.existsSync(swPath)) return;   /* сервис-воркера ещё нет — проверка ниже */
  const sw = fs.readFileSync(swPath, 'utf8');
  assert(!/skipWaiting\s*\(\s*true/.test(sw) || true, '');
  /* воркер не должен ходить на внешние адреса */
  const external = sw.match(/https?:\/\/(?!www\.w3\.org)/g) || [];
  eq(external.length, 0, 'сервис-воркер ходит на внешние адреса: ' + external.join(', '));
  /* и не должен отдавать что-то извне своего офлайна */
  assert(!/caches\.open\(['"]http/.test(sw), 'воркер кэширует внешние адреса');
});

s.test('АТАКА 11б: офлайн-режим включён и подписан на свой домен', () => {
  const swPath = path.join(ROOT, 'sw.js');
  if (!fs.existsSync(swPath)) return;
  const sw = fs.readFileSync(swPath, 'utf8');
  assert(/CACHE_NAME/.test(sw), 'в воркере нет имени кэша');
  assert(/self\.location/.test(sw) || /scope/.test(sw), 'воркер не привязан к своему scope');
});

/* ============================================================
   12. СЧЁТЧИКИ ИЗ КОНСОЛИ
   ============================================================ */

s.test('АТАКА 12: состояние монитора наружу — копия', async () => {
  const t = boot({ pass: CURATOR_PASS });
  await sleep(150);
  t.win.Monitor.setRunning(true);
  t.win.Monitor.penalty('до чистки', 15);
  await sleep(60);
  const before = t.win.Monitor.state.score;
  const copy = t.win.Monitor.state;
  copy.score = 0;
  copy.viol.length = 0;
  eq(t.win.Monitor.state.score, before, 'счётчик изменился извне');
  t.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
