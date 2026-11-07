/* ============================================================
   Тесты v7.9: самостоятельный старт обзвона, калибровка скрыта

   1) Участник начинает обзвон сам — кнопкой в гейте,
      без кода куратора и без калибровки.
   2) Пульт, админка и служебные API по-прежнему закрыты без кода.
   3) Калибровка убрана из интерфейса (кнопка, статус, настройка),
      но сама механика сохранена.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const s = suite('V7.9 (самостоятельный старт, без калибровки)');
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

s.test('участник начинает обзвон сам — без кода куратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  eq(t.el('ctrlRow').hidden, true, 'пульт открыт без кода');
  eq(t.el('btnGateStart').disabled, false, 'кнопка самостоятельного старта заблокирована');
  t.el('btnGateStart').click();
  await sleep(80);
  eq(t.win.OBZ.state().state, 'running', 'обзвон не начался без куратора');
  eq(t.el('gate').hidden, true, 'гейт не скрыт после старта');
  assert(/OBZ-/.test(t.el('sessionId').textContent || ''),
    'ID сессии не назначен: ' + t.el('sessionId').textContent);
  /* завершает сам участник — без подтверждения куратора */
  t.el('btnEndSelf').click();
  await sleep(120);
  eq(t.win.OBZ.state().state, 'ended', 'сессия не завершилась по кнопке участника');
  eq(t.el('sumOverlay').hidden, false, 'итоги обзвона не показаны');
  t.el('btnSumClose').click();
  await sleep(60);
  eq(t.win.OBZ.state().state, 'idle', 'после итогов сессия не сброшена');
  eq(t.el('gate').hidden, false, 'гейт не вернулся после итогов');
  eq(t.el('btnGateStart').disabled, false, 'повторный самостоятельный старт заблокирован');
  t.close();
});

s.test('без кода закрыты пульт, админка и служебные API', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  t.el('btnGateStart').click();
  await sleep(80);
  eq(t.el('authRow').hidden, false, 'строка входа скрыта без кода');
  eq(t.el('adminBody').hidden, true, 'админка открыта без кода');
  eq(t.win.OBZ.role(), null, 'роль выдана без кода');
  eq(t.win.OBZ.demo('key'), false, 'демо-испытание доступно без прав');
  t.close();
});

s.test('калибровка скрыта из интерфейса, механика сохранена', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  eq(t.el('btnCalibrate').hidden, true, 'кнопка калибровки видна участнику');
  eq(t.el('calibStatus').hidden, true, 'статус калибровки виден участнику');
  const lbl = t.el('selCalib').closest('label');
  eq(!!lbl && lbl.hidden, true, 'настройка калибровки видна в пульте');
  /* механика по-прежнему работает, если её вызвать программно */
  t.el('btnCalibrate').click();
  await sleep(60);
  eq(t.win.OBZ.state().state, 'calib', 'механика калибровки сломана');
  assert((t.el('chTask').textContent || '').length > 0, 'испытание калибровки не запустилось');
  t.close();
});

s.test('исходник не требует ни входа, ни калибровки для старта', () => {
  assert(!/Сначала войдите в пульт куратора/.test(appCode),
    'в стартe осталась проверка входа в пульт');
  assert(!/Сначала пройдите калибровку/.test(appCode),
    'в старте осталась проверка калибровки');
  assert(/id="btnGateStart"/.test(html), 'нет кнопки самостоятельного старта в гейте');
  assert(/id="btnCalibrate" hidden/.test(html), 'кнопка калибровки не скрыта в разметке');
  assert(/<label class="sel" hidden>калибровка:/.test(html), 'настройка калибровки не скрыта');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
