/* ============================================================
   Тесты v7.13: старт обзвона ровно через 4 секунды
   и починка «живой динамики»

   1) Первое испытание сеанса приходит ТОЧНО через 4000 мс —
      даже при «медленном» Math.random (раньше было 4–8 с).
   2) График получает первый замер мгновенно при старте —
      линия рисуется сразу, а не через 1–2 секунды ожидания.
   3) Live тянет значения из своего источника и самозапускается
      с тика монитора; canvas восстанавливается после потери
      контекста; NaN-точка не убивает линию.
   4) Живая лента событий получает подписи нарушений и испытаний
      (раньше там вечно висело «событий пока нет»).
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const s = suite('V7.13 (старт через 4 с, живая динамика)');
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const liveCode = fs.readFileSync(path.join(ROOT, 'js', 'live.js'), 'utf8');

s.test('первое испытание — ровно через 4 с даже при «медленном» Math.random', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  const realRnd = t.win.Math.random;
  /* старый nextDelay дал бы rnd(4000,8000) ≈ 8000 мс — тест бы провалился */
  t.win.Math.random = () => 0.999999;
  t.el('btnGateStart').click();
  t.win.Math.random = realRnd;
  eq(t.win.OBZ.state().state, 'running', 'сессия не запустилась');
  await sleep(4600);
  const task = (t.el('chTask').textContent || '').trim();
  assert(task && task !== 'ожидание…',
    'испытание не появилось за 4.6 с (старый темп дал бы ~8 с): ' + task);
  t.el('btnEnd').click();
  await sleep(60);
  t.close();
});

s.test('график получает первый замер сразу при старте', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  eq(t.win.Live.stats().n, 0, 'до старта замеров быть не должно');
  t.el('btnGateStart').click();
  await sleep(120);
  eq(t.win.Live.running(), true, 'график не запустился');
  assert(t.win.Live.stats().n >= 1,
    'первый замер не сделан сразу после старта (n=' + t.win.Live.stats().n + ')');
  t.el('btnEnd').click();
  await sleep(50);
  t.close();
});

s.test('живая лента событий показывает реальные события', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  eq((t.el('liveTicker').textContent || '').trim(), 'событий пока нет',
    'до сессии лента должна быть пустой');
  t.el('btnGateStart').click();
  await sleep(80);
  /* нарушение: F12 блокируется монитором и попадает в ленту */
  const ev = new t.win.KeyboardEvent('keydown', {
    code: 'F12', key: 'F12', bubbles: true, cancelable: true
  });
  t.win.document.dispatchEvent(ev);
  await sleep(80);
  const ticker = (t.el('liveTicker').textContent || '').trim();
  assert(!/событий пока нет/.test(ticker),
    'лента событий не обновилась после нарушения: ' + ticker);
  t.el('btnEnd').click();
  await sleep(50);
  t.close();
});

s.test('Live тянется сам: источник, самозапуск, canvas, NaN (исходник)', () => {
  assert(/Live\.start\(liveSource\)/.test(appCode), 'Live не получает источник данных');
  assert(!/Live\.start\(\s*\)/.test(appCode), 'остался старт Live без источника');
  assert(/if \(!Live\.running\(\)\) Live\.start\(liveSource\)/.test(appCode),
    'нет самозапуска графика с тика монитора');
  assert(/Live\.mark\('viol', item\.label\)/.test(appCode),
    'подпись нарушения не доходит до живой ленты');
  assert(/Live\.mark\(ok \? 'ok' : 'fail', /.test(appCode),
    'подпись испытания не доходит до живой ленты');
  assert(/function pullSource\(\)/.test(liveCode), 'у Live нет своего источника значений');
  assert(/contextlost/.test(liveCode) && /contextrestored/.test(liveCode),
    'нет восстановления после потери контекста canvas');
  assert(/samples\.length < 1/.test(liveCode),
    'график всё ещё ждёт 2 замеров вместо рисования по первому');
  assert(/if \(!isFinite\(c\)\) c = last\.c/.test(liveCode),
    'нет защиты от NaN-точек в графике');
  assert(/первое испытание сеанса/.test(appCode) && /\? 4000 : nextDelay\(\)/.test(appCode),
    'первое испытание больше не приходит ровно через 4 с');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
