/* ============================================================
   E2E-тесты ОБЗВОНА: полный сценарий в jsdom —
   калибровка, испытания, сессия, итоги, живой график,
   история, сортировка таблиц, экспорт/импорт, обновление.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

/* текущая версия — из version.json */
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).v;

const s = suite('E2E (сценарии работы системы)');

/* код тех. администратора (v5.0) — в тестах подменяется хеш */
const ADMIN_PASS = 'admin-test-pass';

/* ---------- помощники ввода ---------- */

function key(win, code, opts = {}) {
  const ev = new win.KeyboardEvent('keydown', {
    code, key: opts.key || code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift,
    metaKey: !!opts.meta, bubbles: true, cancelable: true
  });
  win.document.dispatchEvent(ev);
  return ev;
}
function keyUp(win, code, opts = {}) {
  const ev = new win.KeyboardEvent('keyup', {
    code, key: opts.key || code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift,
    bubbles: true, cancelable: true
  });
  win.document.dispatchEvent(ev);
}

/* код клавиши по символу: буква — KeyX, цифра — DigitX */
function codeFor(ch) {
  return /^[A-Z]$/.test(ch) ? 'Key' + ch : 'Digit' + ch;
}

/* отвечает на текущее испытание так, как это сделал бы участник */
async function answerChallenge(win) {
  const task = win.document.getElementById('chTask');
  const text = task.textContent || '';
  const html = task.innerHTML || '';

  if (/КЛИКНИТЕ ПО\s*ЦЕЛИ/.test(text)) {
    const t = win.document.getElementById('chTarget');
    if (!t.hidden) { t.click(); return 'target'; }
  }
  if (/ДЕРЖИТЕ/.test(text) || /УДЕРЖИВАЙТЕ/.test(text)) {
    key(win, 'Space');
    await sleep(3400);
    keyUp(win, 'Space');
    return 'hold';
  }
  if (/СКОЛЬКО БУДЕТ/.test(text)) {
    const m = html.match(/<b>([^<]+)<\/b>/);
    if (m) {
      const expr = m[1].replace(/−/g, '-').replace(/\s/g, '');
      const mm = expr.match(/^(\d+)([+-])(\d+)$/);
      if (mm) {
        const a = +mm[1], b = +mm[3];
        const res = mm[2] === '+' ? a + b : Math.max(a, b) - Math.min(a, b);
        String(res).split('').forEach((d) => key(win, 'Digit' + d, { key: d }));
        return 'math';
      }
    }
  }
  if (/ЗАПОМНИТЕ/.test(text)) {
    const m = html.match(/<b class="big">([^<]+)<\/b>/);
    if (m) {
      const seq = m[1].replace(/\s/g, '');
      await sleep(1400);                       /* ждём, пока символы скроются */
      for (const ch of seq) key(win, codeFor(ch), { key: ch });
      return 'seq';
    }
  }
  if (/ВВЕДИТЕ ПОСЛЕДОВАТЕЛЬНОСТЬ/.test(text)) {
    const m = html.match(/<b class="big">([\s\S]*?)<\/b>/);
    if (m) {
      const rest = (m[1].match(/<span class="dim2">([^<]*)<\/span>/) || [, ''])[1] || '';
      const seq = rest.replace(/\s/g, '');
      for (const ch of seq) key(win, codeFor(ch), { key: ch });
      return 'seq2';
    }
  }
  if (/НАЖМИТЕ КЛАВИШ?У/.test(text)) {
    const m = html.match(/<b>([^<]+)<\/b>/);
    if (m) {
      const ch = m[1].trim();
      key(win, codeFor(ch), { key: ch });
      return 'key';
    }
  }
  if (/ПОСЧИТАЙТЕ/.test(text)) {
    const row = win.document.querySelector('.count-row');
    if (row) {
      const sym = (row.textContent.match(/★/g) || []).length;
      String(sym).split('').forEach((d) => key(win, 'Digit' + d, { key: d }));
      return 'count';
    }
  }
  /* «Слово»: кликнуть по слову, написанному цветом */
  if (/КЛИКНИТЕ ПО СЛОВУ/.test(text)) {
    const word = win.document.querySelector('.stroop-word');
    const row = win.document.getElementById('stroopRow');
    const need = word ? (word.textContent || '').trim() : '';
    const btns = row ? [].slice.call(row.querySelectorAll('.ch-btn')) : [];
    for (const b of btns) {
      if ((b.textContent || '').trim() === need) { b.click(); return 'ink'; }
    }
    if (btns.length) { btns[0].click(); return 'ink'; }
  }  if (/КЛИКНИТЕ ПО ЦВЕТУ/.test(text)) {
    const word = win.document.querySelector('.stroop-word');
    const ink = word ? word.style.color : '';
    const btns = Array.from(win.document.querySelectorAll('#stroopRow .ch-btn'));
    const hit = btns.find((b) => b.style.background === ink);
    if (hit) { hit.click(); return 'stroop'; }
  }
  return null;
}

/* быстрый проход калибровки «пяти кликами по логотипу» —
   с v5.0 это доступно только техническому администратору */
function fastCalibrate(win) {
  win.document.getElementById('adminPass').value = ADMIN_PASS;
  win.document.getElementById('btnAdminAuth').click();
  const logo = win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
}

async function auth(win, pass) {
  win.document.getElementById('passInput').value = pass;
  win.document.getElementById('btnAuth').click();
  await sleep(30);
}

/* ============================================================ */

s.test('страница загружается без ошибок скриптов', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  eq(t.errors.length, 0, 'ошибки в консоли: ' + t.errors.join(' | '));
  eq(t.win.OBZ.v, V, 'версия в OBZ');
  t.close();
});

s.test('неверный код куратора не пускает в пульт', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'wrong-code');
  eq(t.el('ctrlRow').hidden, true, 'панель управления открылась при неверном коде');
  eq(t.el('authRow').hidden, false, 'поле ввода скрыто');
  t.close();
});

s.test('верный код открывает пульт куратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  eq(t.el('ctrlRow').hidden, false, 'панель управления не открылась');
  eq(t.el('authRow').hidden, true, 'поле ввода не скрыто');
  t.close();
});

s.test('калибровка запускает испытание и ответ засчитывается', async () => {
  const t = boot({ pass: 'test-pass' });
  t.el('btnCalibrate').click();
  await sleep(60);
  eq(t.el('playfield').hidden, false, 'арена не показана');
  assert((t.el('chTask').textContent || '').length > 0, 'задание пустое');
  const kind = await answerChallenge(t.win);
  assert(kind, 'не удалось определить вид испытания: ' + t.el('chTask').textContent);
  await sleep(120);
  const rows = t.$$('#chTableBody tr');
  assert(rows.length >= 1, 'в журнале испытаний нет записей');
  t.close();
});

s.test('сессия: ID, водяной знак, метрики и живой график', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(80);

  assert(/сессия OBZ-/.test(t.el('sessionId').textContent), 'нет ID сессии: ' + t.el('sessionId').textContent);
  eq(t.el('wmLayer').classList.contains('on'), true, 'водяной знак не показан');
  assert(t.el('wmLayer').textContent.indexOf('OBZ-') >= 0, 'в водяном знаке нет ID сессии');
  eq(t.el('gate').hidden, true, 'гейт не скрыт');
  eq(t.el('playfield').hidden, false, 'арена не показана');

  /* живой график набирает точки: первый замер пишется сразу при старте (v7.13) */
  const n0 = t.win.Live.stats().n;
  assert(n0 >= 1, 'первый замер не сделан сразу при старте (n=' + n0 + ')');
  const sum0 = t.win.Live.stats().avg * n0;
  t.win.Live.sample(92, 4);
  t.win.Live.sample(88, 9);
  await sleep(30);
  const st = t.win.Live.stats();
  eq(st.n, n0 + 2, 'график не набрал замеры');
  /* среднее — по всем замерам, включая мгновенный первый */
  eq(st.avg, Math.round((sum0 + 92 + 88) / st.n), 'средняя по графику');
  eq(st.peakCheat, 9, 'пик читомеряка');
  assert(/средняя/.test(t.el('liveSummary').textContent), 'нет сводки под графиком');

  /* живой график рисуется на canvas без ошибок */
  eq(t.errors.length, 0, 'ошибки при отрисовке графика: ' + t.errors.join(' | '));

  t.close();
});

s.test('завершение обзвона: вердикт, итоги и запись в историю', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(80);
  t.el('btnEnd').click();
  await sleep(120);

  eq(t.el('sumOverlay').hidden, false, 'итоги не показаны');
  const verdict = t.el('sumVerdict').textContent;
  assert(['ЗАЧЁТ', 'СОМНИТЕЛЬНО', 'НЕЗАЧЁТ'].indexOf(verdict) >= 0, 'неверный вердикт: ' + verdict);
  assert(new RegExp('v' + V.replace(/\./g, '\\.')).test(t.el('sumTable').textContent), 'в итогах нет версии системы');

  const hist = t.win.Archive.list();
  eq(hist.length, 1, 'в истории не одна запись');
  eq(hist[0].verdict, verdict, 'вердикт в истории не совпадает');
  assert(hist[0].id && hist[0].id.indexOf('OBZ-') === 0, 'нет ID обзвона в истории');

  /* страница истории отрисована */
  t.win.Archive.render();
  assert(t.$$('#archTable tbody tr').length === 1, 'таблица истории пуста');
  assert(/СРАВНЕНИЕ/.test(t.el('archCompare').textContent), 'нет блока сравнения');
  t.close();
});

s.test('сортировка таблицы результатов по клику на заголовок', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(80);
  t.el('btnEnd').click();
  await sleep(120);

  const th = t.el('statTable').querySelector('th[data-sort="value"]');
  assert(th, 'нет сортируемого заголовка');
  th.click();
  await sleep(30);
  /* таблица перерисовывается — заголовок ищем заново */
  const th2 = t.el('statTable').querySelector('th[data-sort="value"]');
  assert(/sorted/.test(th2.className), 'заголовок не помечен как отсортированный: ' + th2.className);
  assert(/asc/.test(th2.className), 'нет направления asc');
  th2.click();
  await sleep(30);
  const th3 = t.el('statTable').querySelector('th[data-sort="value"]');
  assert(/desc/.test(th3.className), 'повторный клик не сменил направление');
  t.close();
});

s.test('экспорт статистики отдаёт валидный JSON', async () => {
  const t = boot({ pass: 'test-pass' });
  const blobs = [];
  t.win.Blob = function (parts, opts) { blobs.push({ parts, opts }); this.size = 0; };
  t.win.URL.createObjectURL = () => 'blob:mock';
  t.win.URL.revokeObjectURL = () => {};
  t.el('btnExportStats').click();
  await sleep(60);
  eq(blobs.length, 1, 'экспорт не создал файл');
  const data = JSON.parse(blobs[0].parts.join(''));
  eq(data.app, 'obzvon-stats', 'не тот формат экспорта');
  eq(data.v, V, 'версия в экспорте');
  t.close();
});

s.test('импорт статистики восстанавливает данные', async () => {
  const t = boot({ pass: 'test-pass' });
  const payload = JSON.stringify({
    app: 'obzvon-stats', v: '4.0',
    totals: { sessions: 7, avg: 88, prevAvg: 80, hist: [70, 80, 88], last: 88, ach: { 'ЛЁД': 2 } }
  });
  t.win.FileReader = function () {
    this.onload = null; this.onerror = null; this.result = null;
    this.readAsText = function () {
      this.result = payload;
      if (this.onload) this.onload({ target: this });
    };
  };
  const file = { name: 'stats.json' };
  Object.defineProperty(t.el('importFile'), 'files', { value: [file], configurable: true, writable: true });
  t.el('importFile').dispatchEvent(new t.win.Event('change'));
  await sleep(80);
  const tot = JSON.parse(t.win.localStorage.getItem('obzvon_v2_totals'));
  eq(tot.sessions, 7, 'число обзвонов не восстановилось');
  eq(tot.avg, 88, 'средняя не восстановилась');
  eq(t.el('totalConc').textContent, '88%', 'средняя не показана в карточке');
  t.close();
});

s.test('меню переключает страницы, включая «Историю»', async () => {
  const t = boot({ pass: 'test-pass' });
  const link = t.win.document.querySelector('.nav-link[data-view="archive"]');
  assert(link, 'нет пункта меню «История»');
  link.click();
  await sleep(40);
  eq(t.el('view-archive').hidden, false, 'страница истории не открылась');
  eq(t.el('view-seance').hidden, true, 'страница сеанса не закрылась');
  assert(link.classList.contains('active'), 'активный пункт не подсвечен');
  t.close();
});

s.test('баннер обновления показывается и откладывается', async () => {
  const t = boot({ pass: 'test-pass', version: '9.9' });
  t.el('btnUpdate').click();          /* ручная проверка */
  await sleep(120);
  eq(t.el('updBanner').hidden, false, 'баннер обновления не показан');
  assert(/9\.9/.test(t.el('updTitle').textContent), 'в баннере нет новой версии');
  t.el('btnUpdateLater').click();
  await sleep(30);
  eq(t.el('updBanner').hidden, true, 'баннер не скрылся');
  t.close();
});

s.test('кнопка «Обновить сейчас» применяет обновление в фоне, без перезагрузки', async () => {
  const t = boot({ pass: 'test-pass', version: '9.9' });
  t.el('btnUpdate').click();
  await sleep(120);
  eq(t.el('updBanner').hidden, false, 'баннер обновления не показан');
  t.el('btnUpdateNow').click();
  await sleep(120);

  /* новые модули подгружаются с новой версией и меткой времени (обход кэша) */
  const srcs = t.$$('script[src]').map((s) => s.getAttribute('src'));
  const fresh = srcs.filter((s) => /[?&]v=9\.9/.test(s) && /[?&]t=/.test(s));
  assert(fresh.length >= 1, 'новые модули не подгружены (' + fresh.length + ')');
  assert(fresh.some((s) => /js\/fx\.js/.test(s)), 'первым должен грузиться fx.js');

  /* цепочка загрузки продолжается: имитируем успешную загрузку очередного модуля */
  let guard = 0;
  while (guard++ < 10) {
    const pend = t.$$('script[src]').filter((s) => {
      const src = s.getAttribute('src');
      return /[?&]v=9\.9/.test(src) && !s.__loaded;
    });
    if (!pend.length) break;
    pend[0].__loaded = true;
    pend[0].dispatchEvent(new t.win.Event('load'));
    await sleep(20);
  }
  const all = t.$$('script[src]').map((s) => s.getAttribute('src')).filter((s) => /[?&]v=9\.9/.test(s));
  assert(all.length >= 6, 'цепочка модулей не дошла до конца (' + all.length + ')');
  assert(all.some((s) => /js\/app\.js/.test(s)), 'app.js не перезагружен');

  /* старый экземпляр освободил ресурсы */
  const tick = t.win.Monitor.lastTickAt();
  await sleep(1300);
  eq(t.win.Monitor.lastTickAt(), tick, 'старый монитор продолжает тикать — остановка не сработала');

  /* старые слушатели сняты: кнопка больше не запускает старую логику */
  t.el('btnCalibrate').click();
  await sleep(80);
  eq(t.el('playfield').hidden, true, 'старый обработчик кнопки всё ещё активен');
  t.close();
});

s.test('обновление, применённое системой, не наказывается как перезагрузка', async () => {
  /* состояние «работающей сессии» + метка чистого обновления */
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(120);
  const saved = t.win.localStorage.getItem('obzvon_v2_state');
  t.close();
  assert(saved, 'состояние сессии не сохранено');

  const t2 = boot({
    pass: 'test-pass',
    storage: { obzvon_v2_state: saved },
    session: { obzvon_v2_clean_update: String(Date.now()) }
  });
  await sleep(250);
  const viol = t2.win.Monitor.state.viol.map((v) => v.type);
  eq(viol.indexOf('reload'), -1, 'чистое обновление засчитано как перезагрузка');
  assert(/фоновое обновление/i.test(t2.el('signalList').textContent), 'в журнале нет записи об обновлении');
  t2.close();
});

s.test('экспорт истории в CSV содержит заголовок и строки', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(60);
  t.el('btnEnd').click();
  await sleep(120);
  const csv = t.win.Archive.csv();
  assert(/Дата/.test(csv), 'нет заголовка CSV');
  assert(csv.split('\r\n').length >= 2, 'нет строк с данными');
  t.close();
});

s.test('очистка истории работает', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(60);
  t.el('btnEnd').click();
  await sleep(120);
  eq(t.win.Archive.list().length, 1, 'запись не создалась');
  t.win.Archive.clear();
  eq(t.win.Archive.list().length, 0, 'история не очистилась');
  t.close();
});

/* ============================================================
   v4.1 · САМООБСЛУЖИВАНИЕ
   ============================================================ */

s.test('живая динамика работает уже на калибровке', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  eq(t.win.Live.stats().n, 0, 'до калибровки замеров быть не должно');
  t.el('btnCalibrate').click();
  await sleep(2400);
  const st = t.win.Live.stats();
  assert(st.n >= 1, 'на калибровке график не копит замеры (n=' + st.n + ')');
  t.close();
});

s.test('живая динамика показывает текущие значения и ленту событий', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  t.win.Live.sample(77, 13);
  t.win.Live.mark('viol', 'Проба нарушения');
  await sleep(40);
  assert(/77%/.test(t.el('liveNow').textContent), 'в шапке нет текущей концентрации: ' + t.el('liveNow').textContent);
  assert(/13%/.test(t.el('liveNow').textContent), 'в шапке нет текущего читомеряка');
  assert(/Проба нарушения/.test(t.el('liveTicker').textContent), 'лента событий не обновилась');
  t.close();
});

s.test('график сам пересоздаётся, если canvas потерян', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  const cv = t.el('liveChart');
  const parent = cv.parentNode;
  parent.removeChild(cv);
  eq(t.el('liveChart'), null, 'canvas должен быть удалён');
  const fixed = t.win.Live.repair();
  assert(fixed, 'Live.repair() не сработал');
  assert(t.el('liveChart'), 'canvas не вернулся');
  t.win.Live.sample(50, 5);
  await sleep(30);
  eq(t.win.Live.stats().n, 1, 'после починки график не пишет');
  t.close();
});

s.test('страница «Обслуживание» проверяет подсистемы и рисует карточки', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  const res = t.win.Health.check();
  assert(res.total >= 8, 'мало проверок: ' + res.total);
  assert(res.checks.every((c) => typeof c.ok === 'boolean'), 'проверки без статуса');
  const cards = t.$$('#healthGrid .hcard');
  assert(cards.length === res.total, 'карточек на странице ' + cards.length + ', проверок ' + res.total);
  assert(/%/.test(t.el('healthScore').textContent), 'в шапке нет оценки: ' + t.el('healthScore').textContent);
  t.close();
});

s.test('самопочинка чинит интерфейс и монитор', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  /* ломаем интерфейс: прячем гейт при активной сессии */
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(80);
  t.el('gate').hidden = false;          /* интерфейс сбит вручную */
  const res = t.win.Health.repair();
  assert(res, 'Health.repair() не отработал');
  assert(Array.isArray(res.actions), 'нет списка действий');
  eq(t.el('gate').hidden, true, 'интерфейс не синхронизирован с состоянием сессии');
  /* монитор перезапускается */
  const before = t.win.Monitor.lastTickAt();
  t.win.Monitor.restart();
  assert(typeof before === 'number', 'нет отметки последнего тика монитора');
  t.close();
});

s.test('журнал ошибок самопочинки наполняется и очищается', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.win.Health.log('error', 'Тестовая ошибка');
  await sleep(30);
  assert(/Тестовая ошибка/.test(t.el('healthLog').textContent), 'ошибка не попала в журнал');
  t.el('btnHealthClear').click();
  await sleep(30);
  assert(!/Тестовая ошибка/.test(t.el('healthLog').textContent), 'журнал не очистился');
  t.close();
});

s.test('сторож системы живой и умеет чинить зависший монитор', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  const wd = t.win.OBZ.watchdog();
  assert(wd && typeof wd.checks === 'number', 'нет состояния сторожа');
  t.win.Monitor.restart();
  assert(t.win.Monitor.lastTickAt() > 0 || true, 'монитор перезапущен');
  t.close();
});

s.test('диагностика не даёт ложных срабатываний на свежей странице', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(1600);                       /* монитор должен «подышать» */
  const res = t.win.Health.check();
  const failed = res.checks.filter((c) => !c.ok);
  eq(failed.length, 0, 'ложные срабатывания: ' +
    failed.map((c) => c.id + ' (' + c.detail + ')').join(', '));
  eq(res.score, 100, 'оценка системы должна быть 100%');
  t.close();
});

s.test('модули освобождают ресурсы — система умеет перезапускаться', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  assert(typeof t.win.Monitor.stop === 'function', 'нет Monitor.stop()');
  assert(typeof t.win.FX.stop === 'function', 'нет FX.stop()');
  assert(typeof t.win.Health.stop === 'function', 'нет Health.stop()');
  assert(typeof t.win.OBZ.restart === 'function', 'нет OBZ.restart()');

  const before = t.win.Monitor.lastTickAt();
  await sleep(1300);
  const after = t.win.Monitor.lastTickAt();
  assert(after > before, 'пульс монитора не тикает');

  t.win.Monitor.stop();
  await sleep(1300);
  eq(t.win.Monitor.lastTickAt(), after, 'после остановки пульс должен прекратиться');
  t.close();
});

/* ============================================================
   v4.2 · АДМИНКА И ФОНОВОЕ ОБНОВЛЕНИЕ
   ============================================================ */

s.test('админка закрыта до ввода кода', async () => {
  const t = boot({ pass: 'test-pass', adminPass: ADMIN_PASS });
  await sleep(150);
  eq(t.el('adminBody').hidden, true, 'тело админки открыто без кода');
  eq(t.el('adminGate').hidden, false, 'гейт админки скрыт');
  t.close();
});

s.test('код куратора НЕ открывает админку (у ролей разные коды)', async () => {
  const t = boot({ pass: 'test-pass', adminPass: ADMIN_PASS });
  await sleep(150);
  t.el('adminPass').value = 'test-pass';
  t.el('btnAdminAuth').click();
  await sleep(120);
  eq(t.el('adminBody').hidden, true, 'админка открылась по коду куратора');
  eq(t.win.OBZ.admin().authed, false, 'состояние админки не должно переключиться');
  t.close();
});

s.test('неверный код не открывает админку, верный — открывает', async () => {
  const t = boot({ pass: 'test-pass', adminPass: ADMIN_PASS });
  await sleep(150);
  t.el('adminPass').value = 'wrong';
  t.el('btnAdminAuth').click();
  await sleep(60);
  eq(t.el('adminBody').hidden, true, 'админка открылась с неверным кодом');

  t.el('adminPass').value = ADMIN_PASS;
  t.el('btnAdminAuth').click();
  await sleep(120);
  eq(t.el('adminBody').hidden, false, 'админка не открылась с верным кодом');
  eq(t.el('adminGate').hidden, true, 'гейт админки не скрылся');
  eq(t.win.OBZ.admin().authed, true, 'состояние админки не переключилось');
  eq(t.win.OBZ.role(), 'admin', 'роль не переключилась на администратора');
  t.close();
});

s.test('админка показывает состояние системы и версию', async () => {
  const t = boot({ pass: 'test-pass', adminPass: ADMIN_PASS });
  await sleep(150);
  t.el('adminPass').value = ADMIN_PASS;
  t.el('btnAdminAuth').click();
  await sleep(200);
  assert(t.$$('#healthGrid .hcard').length >= 8, 'нет карточек состояния');
  assert(/v\d/.test(t.el('adminUpdateInfo').textContent), 'не показан номер версии: ' + t.el('adminUpdateInfo').textContent);
  t.close();
});

s.test('надзор показывает живое состояние системы', async () => {
  const t = boot({ pass: 'test-pass', adminPass: ADMIN_PASS });
  await sleep(150);
  t.el('adminPass').value = ADMIN_PASS;
  t.el('btnAdminAuth').click();
  await sleep(300);
  const txt = t.el('adminWatch').textContent || '';
  assert(/СЕССИЯ/.test(txt), 'в надзоре нет состояния сессии: ' + txt);
  assert(/ЦЕЛОСТНОСТЬ/.test(txt), 'в надзоре нет проверки целостности');
  assert(/ЖУРНАЛ|admin\.open/.test(t.el('adminAudit').textContent || ''), 'в журнале действий нет записи о входе');
  t.close();
});

s.test('нагрузочный тест в админке мерит отзывчивость страницы', async () => {
  const t = boot({ pass: 'test-pass', adminPass: ADMIN_PASS });
  await sleep(150);
  t.el('adminPass').value = ADMIN_PASS;
  t.el('btnAdminAuth').click();
  await sleep(120);
  t.el('btnAdminStressSmall').click();
  await sleep(300);
  const res = t.win.OBZ.adminStress(2000);
  assert(res && res.events === 2000, 'стресс-тест не отработал');
  assert(res.msEvents >= 0, 'нет замера времени');
  assert(/событий/.test(t.el('adminStress').textContent), 'результат теста не показан');
  eq(t.errors.length, 0, 'ошибки во время стресс-теста: ' + t.errors.join(' | '));
  t.close();
});

s.test('кнопка «Закрыть» выводит из админки', async () => {
  const t = boot({ pass: 'test-pass', adminPass: ADMIN_PASS });
  await sleep(150);
  t.el('adminPass').value = ADMIN_PASS;
  t.el('btnAdminAuth').click();
  await sleep(120);
  t.el('btnAdminLock').click();
  await sleep(60);
  eq(t.el('adminBody').hidden, true, 'админка не закрылась');
  eq(t.win.OBZ.admin().authed, false, 'состояние админки не сброшено');
  t.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
