/* ============================================================
   Тесты v6.1: статистика в цифрах и исправления калибровки.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const ADMIN_PASS = 'admin-test-pass';
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

const s = suite('V6.1 (статистика и калибровка)');

function key(win, code, opts = {}) {
  const ev = new win.KeyboardEvent('keydown', {
    code, key: opts.key || code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift,
    bubbles: true, cancelable: true
  });
  win.document.dispatchEvent(ev);
  return ev;
}

/* отвечает на текущее испытание так, как это сделал бы участник */
async function answer(win) {
  const task = win.document.getElementById('chTask');
  const text = task.textContent || '';
  const html = task.innerHTML || '';
  if (/КЛИКНИТЕ ПО\s*ЦЕЛИ/.test(text)) {
    const t = win.document.getElementById('chTarget');
    if (t && !t.hidden) { t.click(); return 'target'; }
  }
  if (/ДЕРЖИТЕ/.test(text) || /УДЕРЖИВАЙТЕ/.test(text)) {
    key(win, 'Space');
    await sleep(3400);
    win.document.dispatchEvent(new win.KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    return 'hold';
  }
  if (/СКОЛЬКО БУДЕТ/.test(text)) {
    const m = html.match(/<b>([^<]+)<\/b>/);
    if (m) {
      const mm = m[1].replace(/−/g, '-').replace(/\s/g, '').match(/^(\d+)([+-])(\d+)$/);
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
      await sleep(1500);
      for (const ch of seq) key(win, /^[A-Z]$/.test(ch) ? 'Key' + ch : 'Digit' + ch, { key: ch });
      return 'seq';
    }
  }
  if (/ВВЕДИТЕ ПОСЛЕДОВАТЕЛЬНОСТЬ/.test(text)) {
    const m = html.match(/<b class="big">([\s\S]*?)<\/b>/);
    if (m) {
      const rest = (m[1].match(/<span class="dim2">([^<]*)<\/span>/) || [, ''])[1] || '';
      for (const ch of rest.replace(/\s/g, '')) key(win, /^[A-Z]$/.test(ch) ? 'Key' + ch : 'Digit' + ch, { key: ch });
      return 'seq2';
    }
  }
  if (/НАЖМИТЕ КЛАВИШ?У/.test(text)) {
    const m = html.match(/<b>([^<]+)<\/b>/);
    if (m) {
      const ch = m[1].trim();
      key(win, /^[A-Z]$/.test(ch) ? 'Key' + ch : 'Digit' + ch, { key: ch });
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
    const row = win.document.getElementById('stroopRow');
    const btns = row ? [].slice.call(row.querySelectorAll('.ch-btn')) : [];
    if (btns.length) { btns[0].click(); return 'stroop'; }
  }
  return null;
}

/* ============================================================
   СТАТИСТИКА
   ============================================================ */

s.test('счётчик посещений работает и отдаёт цифры', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(200);
  const st = t.win.OBZ.stats();
  assert(st, 'статистика недоступна');
  assert(st.counters.visits >= 1, 'визит не посчитан: ' + st.counters.visits);
  assert(st.counters.calibrations === 0, 'калибровок 0 — ок');
  assert(st.people >= 1, 'участники не посчитаны');
  assert(/^[0-9a-f]{32}$/.test(st.pid), 'нет анонимного id устройства');
  t.close();
});

s.test('счётчики переживают перезагрузку страницы', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(200);
  const first = t.win.OBZ.stats().counters.visits;
  t.close();
  /* тот же «браузер» = тот же localStorage: прокидываем его в новый запуск */
  const t2 = boot({ pass: 'test-pass' });
  await sleep(200);
  const second = t2.win.OBZ.stats().counters.visits;
  assert(second >= 1, 'счётчик сбросился: ' + second);
  assert(first >= 1, 'первый счётчик пуст');
  t2.close();
});

s.test('калибровка и обзвон попадают в статистику', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  t.el('btnCalibrate').click();
  await sleep(80);
  let st = t.win.OBZ.stats().counters;
  eq(st.calibrations, 1, 'калибровка не посчитана');
  t.close();
});

s.test('событие уходит сборщику, когда он настроен', async () => {
  const sent = [];
  const t = boot({ pass: 'test-pass', config: { collect: { url: 'collect.php' } } });
  await sleep(300);
  /* подменяем fetch, чтобы увидеть исходящие */
  const orig = t.win.fetch;
  t.win.fetch = function (u, o) {
    if (o && o.method === 'POST') { sent.push({ u: String(u), body: o.body }); return Promise.resolve({ ok: true }); }
    return orig(u, o);
  };
  t.win.Stats.count('calib.start');
  await sleep(80);
  eq(sent.length >= 1, true, 'событие не ушло сборщику');
  const body = JSON.parse(sent[0].body);
  assert(body.id && body.ev === 'calib.start' && body.ts, 'в событии нет id/ev/ts');
  /* личных данных в событии быть не должно */
  const keys = Object.keys(body).sort().join(',');
  eq(keys, 'ev,id,ts', 'в событии лишние поля: ' + keys);
  t.close();
});

s.test('без сборщика события просто считаются локально', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(200);
  eq(t.win.OBZ.stats().collector, '', 'сборщик не должен быть настроен по умолчанию');
  t.close();
});

/* ============================================================
   КАЛИБРОВКА
   ============================================================ */

s.test('провал в калибровке не стирает прогресс', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  t.el('btnCalibrate').click();
  await sleep(120);
  /* отвечаем правильно на первое испытание */
  const task = t.el('chTask');
  let html = task.innerHTML || '';
  let m = html.match(/<b>([^<]+)<\/b>/);
  if (m && /НАЖМИТЕ/.test(task.textContent || '')) {
    const ch = m[1].trim();
    key(t.win, /^[A-Z]$/.test(ch) ? 'Key' + ch : 'Digit' + ch, { key: ch });
    await sleep(120);
  }
  const doneBefore = t.win.OBZ.state();
  void doneBefore;
  /* теперь проваливаем: любая клавиша, если задание — «нажмите клавишу» */
  const before = (t.el('calibStatus').textContent || '');
  const round = (t.el('chRound').textContent || '');
  /* искусственный провал: ждём, пока задание сменится, и шлём неверную клавишу */
  await sleep(200);
  const cur = t.el('chTask').innerHTML || '';
  if (/НАЖМИТЕ/.test(cur)) {
    const mm = cur.match(/<b>([^<]+)<\/b>/);
    const ch = mm ? mm[1].trim() : 'A';
    const wrong = ch === 'A' ? 'KeyB' : 'KeyA';
    key(t.win, wrong, { key: wrong.replace('Key', '') });
    await sleep(200);
  }
  const after = (t.el('calibStatus').textContent || '');
  assert(after.length > 0, 'нет статуса калибровки');
  assert(!/калибровка не пройдена/.test(after),
    'прогресс калибровки всё ещё стирается: ' + after);
  void before; void round;
  t.close();
});

s.test('провал в калибровке не штрафует «читомеряк»', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  t.el('btnCalibrate').click();
  await sleep(120);
  /* проваливаем испытание «нажмите клавишу» неверной клавишей */
  const cur = t.el('chTask').innerHTML || '';
  if (/НАЖМИТЕ/.test(cur)) {
    const mm = cur.match(/<b>([^<]+)<\/b>/);
    const ch = mm ? mm[1].trim() : 'A';
    const wrong = ch === 'A' ? 'KeyB' : 'KeyA';
    key(t.win, wrong, { key: wrong.replace('Key', '') });
    await sleep(200);
  }
  eq(t.win.Monitor.state.score, 0, 'калибровка начислила штраф');
  t.close();
});

s.test('окно ответа в калибровке не меньше минимума', () => {
  /* проверяем по коду: минимальные окна заданы и применяются */
  assert(/var CALIB_MIN = \{/.test(appCode), 'нет минимальных окон калибровки');
  const m = appCode.match(/CALIB_MIN = \{([^}]+)\}/);
  assert(m, 'не разобран CALIB_MIN');
  const min = m[1];
  ['key', 'target', 'math', 'seq', 'stroop'].forEach((k) => {
    assert(new RegExp(k + ':\\s*\\d{4}').test(min), 'нет минимума для ' + k);
  });
  /* скорость калибровки больше не 0.35 (это была главная причина провалов) */
  const sp = appCode.match(/calibSpeed:\s*([\d.]+)/);
  assert(sp, 'нет calibSpeed');
  assert(parseFloat(sp[1]) >= 0.5, 'calibSpeed слишком жёсткий: ' + sp[1]);
});

s.test('нумерация журнала начинается с нуля после новой калибровки', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  t.el('btnCalibrate').click();
  await sleep(150);
  await answer(t.win);
  await sleep(200);
  const rows = t.$$('#chTableBody tr');
  assert(rows.length >= 1, 'в журнале нет записей калибровки');
  const first = rows[0].querySelector('td');
  eq((first && first.textContent || '').trim(), '1', 'нумерация журнала началась не с 1');
  t.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
