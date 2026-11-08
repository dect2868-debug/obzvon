/* ============================================================
   Тесты v7.11: быстрый темп обзвона — без долгого ожидания

   1) Первое испытание приходит сразу после старта (≈4 с),
      а не через ~19–20 с, как было до v7.11.
   2) Темп ускорен во всех режимах, разгон первых испытаний
      (×1.35–1.45) убран.
   3) Тексты (тост, справка, README) называют реальный темп.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const s = suite('V7.11 (быстрый темп обзвона)');
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

s.test('первое испытание приходит быстро — не через 19 секунд', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  const realRnd = t.win.Math.random;
  t.win.Math.random = () => 0;   /* фиксируем минимум: первый интервал = 4000 мс */
  t.el('btnGateStart').click();
  t.win.Math.random = realRnd;
  eq(t.win.OBZ.state().state, 'running', 'сессия не запустилась');
  await sleep(4600);
  const task = (t.el('chTask').textContent || '').trim();
  assert(task && task !== 'ожидание…',
    'испытание не появилось за 4.6 с (старый темп ~19 с): ' + task);
  t.el('btnEnd').click();
  await sleep(60);
  t.close();
});

s.test('темп ускорен во всех режимах, разгон первых убран (исходник)', () => {
  assert(/delay: \[4000, 8000\]/.test(appCode), 'обычный режим не ускорен');
  assert(/delay: \[2500, 5500\]/.test(appCode), 'спринт не ускорен');
  assert(/delay: \[3500, 7500\]/.test(appCode), 'экзамен не ускорен');
  assert(/delay: \[6000, 12000\]/.test(appCode), 'тренировка не ускорена');
  assert(!/1\.45/.test(appCode), 'остался разгон первых испытаний ×1.45');
  assert(!/CH_SEANCE <= 3/.test(appCode), 'остался отдельный разгон первых 3 испытаний');
  assert(/function nextDelay\(\)[\s\S]{0,240}return rnd\(d\[0\], d\[1\]\);/.test(appCode),
    'nextDelay больше не задаёт ровный быстрый темп');
});

s.test('тексты называют реальный темп (4–8 секунд)', () => {
  assert(/каждые 4–8 секунд/.test(appCode), 'тост при старте не обновлён');
  assert(!/10–25/.test(appCode), 'в коде остались старые «10–25 секунд»');
  assert(/каждые 4–8 секунд/.test(html), 'справка не обновлена');
  assert(!/10–25/.test(html), 'в справке остались старые «10–25 секунд»');
  assert(/4–8 секунд/.test(readme), 'README не обновлён');
  assert(!/6–20 секунд/.test(readme), 'в README остались старые «6–20 секунд»');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
