/* ============================================================
   Тесты v8.0: модерация + большие обновления живой динамики

   1) Модуль модерации считает риск сессии и находит признаки
      «слишком ровного» поведения.
   2) Очередь модерации: запись, решение модератора, счётчики.
   3) Без кода тех. администратора очередь не отдаётся.
   4) В админке есть очередь с кнопками «Зачёт / Повтор / Запрет».
   5) В живой динамике — обратный отсчёт до следующего испытания
      и линия реакции.
   6) В итогах обзвона — разбивка по видам испытаний и вердикт
      модерации.
   7) Перерыв участника — пауза без штрафа.
   8) Excel-выгрузка содержит листы «Испытания» и «Модерация».
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT, loginAndCalibrate } = require('./helpers');

const s = suite('V8.0 (модерация и живые фишки)');
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const liveCode = fs.readFileSync(path.join(ROOT, 'js', 'live.js'), 'utf8');
const moderCode = fs.readFileSync(path.join(ROOT, 'js', 'moder.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

s.test('модуль модерации считает риск и находит признаки', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  assert(t.win.Moder, 'модуль moder.js не загружен');
  t.win.Moder.reset();
  for (let i = 0; i < 8; i++) t.win.Moder.push(true, 150, 'key');
  const chk = t.win.Moder.check();
  assert(chk.risk >= 25, 'риск не вычислен: ' + chk.risk);
  assert(chk.flags.length >= 1, 'признаки подозрения не найдены');
  const names = chk.flags.map((f) => f.name).join(' ');
  assert(/Сверхскорость/.test(names), 'нет признака «Сверхскорость»: ' + names);
  assert(/Идеальная серия/.test(names), 'нет признака «Идеальная серия»: ' + names);
  eq(chk.level, 'высокий', 'уровень риска определён неверно');
  t.close();
});

s.test('нормальная сессия риска не вызывает', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.win.Moder.reset();
  /* обычная живая сессия: разброс реакции, провалы, нарушение */
  const ms = [420, 610, 380, 900, 520, 1500, 460, 700, 330, 880];
  ms.forEach((v, i) => t.win.Moder.push(i % 4 !== 3, v, 'key'));
  t.win.Moder.noteViolation();
  t.win.Moder.setConc(78);
  const chk = t.win.Moder.check();
  assert(chk.risk < 25, 'обычная сессия сочтена подозрительной: риск ' + chk.risk);
  eq(chk.level, 'низкий', 'уровень риска обычной сессии неверный');
  t.close();
});

s.test('очередь модерации: запись, решение и счётчики', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.win.Moder.reset();
  const before = t.win.Moder.stats().pending;
  for (let i = 0; i < 8; i++) t.win.Moder.push(true, 150, 'key');
  const item = t.win.Moder.submit({ sessionId: 'OBZ-TEST-1' });
  assert(item && item.id, 'сессия не попала в очередь модерации');
  eq(t.win.Moder.stats().pending, before + 1, 'в очереди не появилась новая запись');
  const dec = t.win.Moder.decide(item.id, 'повтор');
  assert(dec && dec.decision === 'повтор', 'решение модератора не записано');
  eq(t.win.Moder.stats().pending, before, 'после решения запись осталась в ожидании');
  assert(t.win.Moder.stats().decided >= 1, 'решённая запись не учтена');
  t.close();
});

s.test('очередь модерации закрыта без кода тех. администратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  const m = t.win.OBZ.moderation();
  eq(m.authed, false, 'очередь отдана без входа');
  eq(m.queue.length, 0, 'очередь видна без кода');
  eq(t.win.OBZ.moderate('X', 'зачёт'), false, 'решение принято без кода');
  t.close();
});

s.test('в админке очередь с кнопками решения', async () => {
  const t = boot({ pass: 'test-pass' });
  await loginAndCalibrate(t, undefined, 'admin-test-pass');
  t.win.Moder.reset();
  for (let i = 0; i < 8; i++) t.win.Moder.push(true, 150, 'key');
  t.win.Moder.submit({ sessionId: 'OBZ-ADMIN-1' });
  t.el('btnModerRefresh').click();
  await sleep(40);
  const box = t.el('adminModer').innerHTML;
  assert(/btn-moder/.test(box), 'в очереди нет кнопок решения');
  assert(/Зачёт/.test(box) && /Запрет/.test(box), 'нет кнопок «Зачёт»/«Запрет»');
  const q = t.win.OBZ.moderation().queue;
  assert(q.length >= 1, 'очередь пуста');
  eq(t.win.OBZ.moderate(q[0].id, 'зачёт'), true, 'решение не принято');
  assert(/решение: зачёт/.test(t.el('adminModer').innerHTML), 'решение не показано в очереди');
  t.close();
});

s.test('в живой динамике есть обратный отсчёт до следующего испытания', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.el('btnGateStart').click();
  await sleep(1400);
  const txt = (t.el('liveNext').textContent || '').trim();
  assert(/следующее через \d+ с/.test(txt), 'нет обратного отсчёта: ' + txt);
  t.el('btnEnd').click();
  await sleep(50);
  t.close();
});

s.test('живая динамика помнит реакцию и рисует третью линию', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.win.Live.sample(50, 0, 420);
  await sleep(30);
  const samples = t.win.Live.data().samples;
  assert(samples.length >= 1, 'замеров нет');
  eq(samples[samples.length - 1].r, 420, 'реакция не записана в замер');
  assert(/r \/ 20/.test(liveCode), 'линия реакции не рисуется');
  assert(/РЕАК/.test(liveCode), 'реакция не показывается в шапке панели');
  t.close();
});

s.test('в итогах обзвона есть разбивка по видам и вердикт модерации', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.el('btnGateStart').click();
  await sleep(4300);            /* первое испытание уже показано */
  t.el('btnEndSelf').click();   /* завершение (в тесте без подтверждения) */
  await sleep(150);
  const kinds = (t.el('sumKinds').textContent || '');
  assert(/ВЕРНО/i.test(kinds), 'нет таблицы по видам испытаний: ' + kinds.slice(0, 90));
  const mod = (t.el('sumModer').textContent || '');
  assert(/Риск сессии/i.test(mod), 'нет блока модерации в итогах: ' + mod.slice(0, 90));
  t.close();
});

s.test('перерыв участника — пауза без штрафа', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.el('btnGateStart').click();
  await sleep(200);
  const before = t.win.Monitor.state.score;
  t.el('btnBreak').click();
  await sleep(80);
  eq(t.win.OBZ.state().state, 'paused', 'перерыв не поставил обзвон на паузу');
  eq(t.win.Monitor.state.score, before, 'перерыв добавил штраф');
  t.el('btnResume').click();
  await sleep(60);
  eq(t.win.OBZ.state().state, 'running', 'обзвон не продолжился после перерыва');
  t.close();
});

s.test('Excel-выгрузка содержит листы «Испытания» и «Модерация»', async () => {
  const t = boot({ pass: 'test-pass' });
  await loginAndCalibrate(t, undefined, 'admin-test-pass');
  let sheets = null;
  t.win.Excel.download = function (sh) { sheets = sh; return true; };
  const ok = t.win.OBZ.exportExcel();
  eq(ok, true, 'выгрузка не удалась');
  const names = sheets.map((x) => x.name);
  assert(names.indexOf('Испытания') >= 0, 'нет листа «Испытания»: ' + names.join(', '));
  assert(names.indexOf('Модерация') >= 0, 'нет листа «Модерация»: ' + names.join(', '));
  t.close();
});

s.test('модуль подключён, разметка и правила на месте (исходник)', () => {
  assert(html.includes('js/moder.js'), 'модуль модерации не подключён к странице');
  assert(sw.includes('./js/moder.js'), 'модуль модерации не добавлен в офлайн-кэш');
  assert(/id="adminModer"/.test(html), 'в админке нет блока модерации');
  assert(/id="sumModer"/.test(html), 'в итогах нет блока модерации');
  assert(/id="sumKinds"/.test(html), 'в итогах нет таблицы по видам испытаний');
  assert(/id="liveNext"/.test(html), 'в живой динамике нет обратного отсчёта');
  assert(/id="btnBreak"/.test(html), 'нет кнопки перерыва');
  assert(/id="btnLink"/.test(html), 'нет кнопки «Ссылка на сессию»');
  assert(/superfast/.test(moderCode) && /perfect/.test(moderCode) && /fastfail/.test(moderCode),
    'в правилах модерации не все признаки');
  assert(/Moder\.submit\(/.test(appCode), 'модерация не подключена к итогам обзвона');
  assert(/Moder\.decide\(/.test(appCode), 'нет принятия решений модератора');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
