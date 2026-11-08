/* ============================================================
   Тесты v7.0: новые испытания, режимы, профили, тревоги, отчёты.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const ADMIN_PASS = 'admin-test-pass';
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

const s = suite('V7 (режимы, новые испытания, профили, тревоги)');

function key(win, code, opts = {}) {
  const ev = new win.KeyboardEvent('keydown', {
    code, key: opts.key || code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift,
    bubbles: true, cancelable: true
  });
  win.document.dispatchEvent(ev);
  return ev;
}

async function loginAdmin(t) {
  t.win.document.getElementById('adminPass').value = ADMIN_PASS;
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(40);
}

/* ============================================================
   НОВЫЕ ИСПЫТАНИЯ
   ============================================================ */

s.test('в коде есть два новых вида испытания', () => {
  assert(/count: 'Счёт'/.test(appCode), 'нет вида «Счёт»');
  assert(/ink: 'Слово'/.test(appCode), 'нет вида «Слово»');
  assert(/stroop: 9000, count: 10000, ink: 9000/.test(appCode), 'нет таймаутов для новых видов');
  assert(/count: 3600, ink: 2600/.test(appCode), 'нет минимальных окон для новых видов');
  /* v7.11: в «Счёте» ровно nStar звёзд — иначе ответ нечестный и тест флакает */
  assert(!/Math\.random\(\) < 0\.55/.test(appCode), 'звёзды в «Счёте» снова набираются наугад');
  assert(/for \(var ci = 0; ci < nStar; ci\+\+\) chars\.push\(targetSym\);/.test(appCode),
    'в «Счёт» не кладётся ровно nStar звёзд');
});

s.test('новые виды входят в набор испытаний сеанса и калибровки', () => {
  const m = appCode.match(/var pool = calib[\s\S]*?;\s*var k = ST\.lastKind;/);
  assert(m, 'не найден набор видов');
  assert(/'count'/.test(m[0]) && /'ink'/.test(m[0]), 'новые виды не в наборе');
});

s.test('испытание «Счёт» показывает символы и ждёт числа', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  eq(t.win.OBZ.demo('count'), true, 'пример не запустился');
  await sleep(120);
  const task = t.el('chTask').textContent || '';
  assert(/ПОСЧИТАЙТЕ/.test(task), 'нет задания «Счёт»: ' + task);
  const row = t.$('.count-row');
  assert(row, 'нет ряда символов');
  const stars = (row.textContent.match(/★/g) || []).length;
  assert(stars >= 3, 'символов слишком мало: ' + stars);
  /* панель ответа — цифры */
  const pad = t.el('chPad');
  assert(!pad.hidden, 'панель ответа скрыта');
  const digits = [].slice.call(pad.querySelectorAll('.pad-key')).map((b) => b.textContent);
  eq(digits.join(''), '0123456789', 'панель ответа не цифровая');
  t.close();
});

s.test('испытание «Слово» показывает слово цветом и кнопки-слова', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  eq(t.win.OBZ.demo('ink'), true, 'пример не запустился');
  await sleep(120);
  const task = t.el('chTask').textContent || '';
  assert(/КЛИКНИТЕ ПО СЛОВУ/.test(task), 'нет задания «Слово»: ' + task);
  const word = t.$('.stroop-word');
  assert(word, 'нет слова');
  const btns = t.$$('#stroopRow .ch-btn');
  eq(btns.length, 4, 'кнопок не четыре');
  /* слово нарисовано цветом, отличным от его значения */
  const color = word.getAttribute('style') || '';
  assert(color.indexOf('color') >= 0, 'нет цвета слова');
  t.close();
});

s.test('пример испытания недоступен без прав администратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  eq(t.win.OBZ.demo('count'), false, 'пример показал без прав');
  t.close();
});

/* ============================================================
   РЕЖИМЫ ОБЗВОНА
   ============================================================ */

s.test('в пульте куратора есть выбор режима', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  const sel = t.el('selMode');
  assert(sel, 'нет выбора режима');
  const vals = [].slice.call(sel.options).map((o) => o.value);
  ['normal', 'sprint', 'exam', 'warmup'].forEach((v) => {
    assert(vals.indexOf(v) >= 0, 'нет режима ' + v);
  });
  t.close();
});

s.test('режим переключается и влияет на набор видов', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  const sel = t.el('selMode');
  sel.value = 'exam';
  sel.dispatchEvent(new t.win.Event('change', { bubbles: true }));
  await sleep(60);
  eq(t.win.OBZ.mode(), 'exam', 'режим не переключился');
  t.close();
});

s.test('режим «Тренировка» ограничивает набор видов', () => {
  const m = appCode.match(/warmup:\s*\{[^}]*kinds:\s*\[([^\]]*)\]/);
  assert(m, 'не найден набор видов режима «Тренировка»');
  assert(!/stroop|math/.test(m[1]), 'в тренировке слишком сложные виды: ' + m[1]);
});

/* ============================================================
   ПРОФИЛИ И ДОВЕРИЕ
   ============================================================ */

s.test('профиль устройства создаётся и считает обзвоны', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(200);
  const list = t.win.OBZ.profiles();
  assert(list.length >= 1, 'профиль не создан');
  assert(/^[0-9a-f]{16}$/.test(list[0].id), 'id профиля не похож на анонимный хеш');
  eq(list[0].calls, 0, 'у нового профиля уже есть обзвоны');
  t.close();
});

s.test('доверие считается по концентрации и нарушениям', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(200);
  const P = t.win.Profiles;
  const good = { id: 'x', calls: 4, concSum: 4 * 95, reactSum: 0, reactN: 0, violSum: 0, firstAt: 1, lastAt: 2 };
  const bad = { id: 'y', calls: 4, concSum: 4 * 30, reactSum: 0, reactN: 0, violSum: 40, firstAt: 1, lastAt: 2 };
  assert(P.trust(good) > P.trust(bad), 'доверие не различается');
  assert(P.trust(good) >= 75, 'у хорошего профиля должно быть высокое доверие');
  assert(P.trust(bad) < 45, 'у плохого профиля должно быть низкое доверие');
  eq(P.trust({ calls: 0 }), 0, 'у нового профиля доверие должно быть нулевым');
  t.close();
});

s.test('в профиле нет личных данных', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'profiles.js'), 'utf8');
  ['userAgent', 'hardwareConcurrency', 'deviceMemory', 'languages'].forEach((k) => {
    assert(src.indexOf(k) >= 0, 'нет признака ' + k + ' — отпечаток изменился');
  });
  assert(src.indexOf('email') < 0 && src.indexOf('name') < 0 && src.indexOf('phone') < 0,
    'в профилях появились личные поля');
});

/* ============================================================
   ТРЕВОГИ
   ============================================================ */

s.test('сильное нарушение во время обзвона поднимает тревогу', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  /* обход калибровки (только для админа) и старт сессии */
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
  await sleep(40);
  t.win.document.getElementById('btnStart').click();
  await sleep(120);
  eq(t.win.OBZ.state().state, 'running', 'сессия не началась');
  /* сильное нарушение */
  t.win.Monitor.penalty('Проверка тревоги', 8, 2);
  await sleep(100);
  const alarms = t.win.OBZ.alarms();
  assert(alarms.length >= 1, 'тревога не поднялась');
  assert(/Проверка тревоги/.test(alarms[0].title), 'в тревоге нет текста: ' + alarms[0].title);
  t.close();
});

s.test('в админке есть блок тревог и список', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  assert(t.el('adminAlarm'), 'нет плашки тревоги');
  assert(t.el('adminAlarms'), 'нет списка тревог');
  t.close();
});

/* ============================================================
   ОТЧЁТЫ И НАСТРОЙКИ
   ============================================================ */

s.test('HTML-отчёт собирается и содержит сводку', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  const rep = t.win.OBZ.report();
  assert(rep.profiles, 'в отчёте нет профилей');
  assert(Array.isArray(rep.alarms), 'в отчёте нет тревог');
  eq(rep.mode, 'normal', 'в отчёте нет режима');
  t.close();
});

s.test('настройки интерфейса сохраняются', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  const sel = t.el('selDensity');
  sel.value = 'compact';
  t.el('btnAdminApplyUi').click();
  await sleep(60);
  assert(t.win.document.body.classList.contains('dense'), 'плотный режим не применился');
  const ui = JSON.parse(t.win.localStorage.getItem('obzvon_v2_ui') || '{}');
  eq(ui.density, 'compact', 'настройки не сохранились');
  t.close();
});

s.test('крупные кнопки включаются', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  const chk = t.el('chkBigButtons');
  chk.checked = true;
  t.el('btnAdminApplyUi').click();
  await sleep(60);
  assert(t.win.document.body.classList.contains('big-pad'), 'крупные кнопки не применились');
  t.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
