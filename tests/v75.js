/* ============================================================
   Тесты v7.5: антилаги и целостность разметки

   1) Сломанные атрибуты: value="5 data-policy= — класс баг, который
      всплывал предупреждением в консоли. Проверяем весь
      отрендеренный DOM после входа админа.
   2) Антилаг таблиц: updateMetrics() не должен перестраивать
      innerHTML таблиц, если данные не менялись (иначе — reflow
      каждую секунду во время обзвона).
   ============================================================ */
'use strict';

const { boot, suite, assert, eq, sleep, loginAndCalibrate } = require('./helpers');

const ADMIN_PASS = 'admin-test-pass';
const s = suite('V7.5 (антилаги и разметка)');

async function bootAdmin() {
  const t = boot({ pass: 'test-pass' });
  await sleep(200);
  await loginAndCalibrate(t, undefined, ADMIN_PASS);
  await sleep(100);
  return t;
}

s.test('сломанных атрибутов в отрендеренном DOM нет', async () => {
  const t = await bootAdmin();
  const bad = [];
  const els = t.win.document.querySelectorAll('input, select, button, textarea');
  els.forEach((el) => {
    if (el.type === 'number' && el.value && /[^0-9eE.+-]/.test(el.value)) {
      bad.push(el.id + '=' + JSON.stringify(el.value));
    }
    const raw = el.getAttribute('value');
    if (raw && /\s[a-z-]+=$/.test(raw)) bad.push(el.id + ' attr=' + JSON.stringify(raw));
  });
  eq(bad.length, 0, 'сломанные атрибуты: ' + bad.join('; '));
  t.close();
});

s.test('панель политик: у number-полей числовые value', async () => {
  const t = await bootAdmin();
  const inputs = t.win.document.querySelectorAll('#adminPolicies input[type="number"]');
  assert(inputs.length > 0, 'панель политик пуста — вход не отработал');
  inputs.forEach((el) => {
    const raw = el.getAttribute('value') || '';
    assert(/^\d+$/.test(raw), 'value политики не число: ' + JSON.stringify(raw) + ' (id=' + el.id + ')');
    assert(el.getAttribute('data-policy'), 'у поля нет data-policy: ' + el.id);
  });
  t.close();
});

s.test('updateMetrics не перестраивает таблицы без изменений', async () => {
  const t = await bootAdmin();
  const stat = t.el('statTable');
  const chBody = t.el('chTableBody');
  assert(stat, 'нет таблицы статистики');

  /* считаем реальные перестройки DOM через MutationObserver */
  let statRebuilds = 0, chRebuilds = 0;
  const obs = new t.win.MutationObserver((muts) => {
    muts.forEach((m) => {
      if (m.target === stat || stat.contains(m.target)) statRebuilds++;
      if (m.target === chBody || chBody.contains(m.target)) chRebuilds++;
    });
  });
  obs.observe(stat, { childList: true, subtree: true });
  obs.observe(chBody, { childList: true, subtree: true });

  /* первый вызов имеет право перестроить (первичная отрисовка) */
  t.win.OBZ.metrics ? t.win.OBZ.metrics() : null;
  await sleep(50);
  statRebuilds = 0; chRebuilds = 0;

  /* данные не менялись → перестроек быть не должно */
  for (let i = 0; i < 3; i++) t.win.OBZ.metrics();
  await sleep(80);
  eq(statRebuilds, 0, 'таблица статистики перестроилась без изменений: ' + statRebuilds);
  eq(chRebuilds, 0, 'журнал испытаний перестроился без изменений: ' + chRebuilds);
  obs.disconnect();
  t.close();
});

s.test('таблица обновляется при изменении данных/сортировки', async () => {
  const t = await bootAdmin();
  t.el('btnStart').click();
  await sleep(80);
  t.win.OBZ.metrics();   /* первичная отрисовка после старта */
  await sleep(40);
  const stat = t.el('statTable');
  const before = stat.innerHTML;
  assert(/Смены вкладок/.test(before), 'таблица без сессии не показывает показатели');
  /* Monitor.state — геттер-копия, поэтому меняем сортировку: она
     меняет разметку, и кэш обязан её пропустить */
  const th = stat.querySelector('th[data-sort="value"]');
  assert(th, 'нет сортируемого заголовка');
  th.click();
  await sleep(50);
  const after = stat.innerHTML;
  assert(after !== before, 'таблица не обновилась после изменения (кэш залип)');
  assert(/sorted/.test(after), 'после клика нет пометки сортировки');
  t.el('btnEnd').click();
  await sleep(50);
  t.close();
});

s.test('setVal не делает принудительный reflow на каждый показатель', () => {
  /* проверяем исходник: в setVal нет void offsetWidth */
  const fs = require('fs');
  const path = require('path');
  const { ROOT } = require('./helpers');
  const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const m = /function setVal\(el, text\)[\s\S]*?\n  \}/.exec(src);
  assert(m, 'function setVal не найдена');
  assert(!/offsetWidth/.test(m[0]), 'setVal всё ещё делает принудительный reflow');
  assert(/requestAnimationFrame/.test(m[0]), 'setVal не использует rAF для flash');
});

s.test('кэш таблиц объявлен и используется', () => {
  const fs = require('fs');
  const path = require('path');
  const { ROOT } = require('./helpers');
  const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert(/lastTables\s*=\s*\{\s*stat:/.test(src), 'кэш lastTables не объявлен');
  const n = (src.match(/lastTables\.(stat|ch|chStat)/g) || []).length;
  assert(n >= 6, 'кэш объявлен, но почти не используется: ' + n + ' упоминаний');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
