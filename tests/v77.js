/* ============================================================
   Тесты v7.7: обзвон сразу, калибровка необязательна

   1) После входа куратора кнопка «Начать обзвон» активна
      без калибровки — сессия стартует сразу.
   2) Механика калибровки сохранена: кнопка в гейте работает.
   3) Фишка «ЧИСТАЯ КАЛИБРОВКА» и статистика калибровок завязаны
      на факт реальной калибровки (calibTried), а не на
      необязательный статус calibrated.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const s = suite('V7.7 (обзвон без калибровки)');
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

async function loginCurator(t) {
  t.win.document.getElementById('passInput').value = 'test-pass';
  t.win.document.getElementById('btnAuth').click();
  await sleep(40);
}

s.test('после входа кнопка «Начать обзвон» активна без калибровки', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginCurator(t);
  eq(t.el('ctrlRow').hidden, false, 'пульт не открылся');
  eq(t.el('btnStart').disabled, false, 'кнопка старта заблокирована без калибровки');
  t.close();
});

s.test('обзвон стартует сразу — без калибровки', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginCurator(t);
  t.el('btnStart').click();
  await sleep(80);
  eq(t.win.OBZ.state().state, 'running', 'сессия не началась без калибровки');
  assert(/OBZ-/.test(t.el('sessionId').textContent || ''),
    'ID сессии не назначен: ' + t.el('sessionId').textContent);
  t.el('btnEnd').click();
  await sleep(60);
  t.close();
});

s.test('калибровка по-прежнему доступна вручную', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  t.el('btnCalibrate').click();
  await sleep(60);
  eq(t.el('playfield').hidden, false, 'арена калибровки не показана');
  eq(t.win.OBZ.state().state, 'calib', 'калибровка не запустилась');
  assert((t.el('chTask').textContent || '').length > 0, 'задание калибровки пустое');
  t.close();
});

s.test('по умолчанию калибровка не требуется (исходник)', () => {
  assert(/calibrated:\s*true/.test(appCode), 'calibrated по умолчанию не true');
  assert(!/calibrated:\s*false/.test(appCode), 'где-то остался calibrated: false');
  assert(/calibTried/.test(appCode), 'нет флага реальной калибровки calibTried');
  /* фишка «ЧИСТАЯ КАЛИБРОВКА» — только если калибровка реально была */
  assert(/ST\.calibTried && ST\.calibFails === 0/.test(appCode),
    'фишка «ЧИСТАЯ КАЛИБРОВКА» не привязана к calibTried');
  /* статистика профилей тоже считает только реальные калибровки */
  assert(/calibrated: !!ST\.calibTried/.test(appCode),
    'Profiles.onSession получает не тот признак калибровки');
});

s.test('текст гейта и справки больше не требуют калибровку', () => {
  const gate = html.match(/id="gateText">([^<]*)</);
  assert(gate, 'нет текста гейта');
  assert(/калибровка необязательна/.test(gate[1]), 'гейт не говорит о необязательности: ' + gate[1]);
  assert(!/пройдите длинную проверку/.test(gate[1]), 'гейт всё ещё требует длинную проверку');
  assert(/она больше не обязательна/.test(html), 'справка всё ещё требует калибровку перед обзвоном');
  /* кнопка калибровки осталась в DOM и помечена как необязательная */
  assert(/id="btnCalibrate"/.test(html), 'кнопка калибровки удалена из разметки');
  assert(/необязательно/.test(appCode), 'syncCalibBtn не помечает калибровку как необязательную');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
