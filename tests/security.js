/* ============================================================
   Тесты защиты ОБЗВОНА (v4.0) — попытки обхода:
   DevTools, горячие клавиши, копирование, печать, фрейминг,
   удаление водяного знака, правка localStorage, автотесты,
   захват экрана, вторая вкладка, подмена часов.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const appCode = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

const s = suite('SECURITY (попытки обхода защиты)');

function key(win, code, opts = {}) {
  const ev = new win.KeyboardEvent('keydown', {
    code, key: opts.key || code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift,
    bubbles: true, cancelable: true
  });
  win.document.dispatchEvent(ev);
  return ev;
}

/* поднимает сессию, чтобы нарушения фиксировались */
async function session(pass = 'test-pass') {
  const t = boot({ pass, adminPass: 'admin-test-pass' });
  await sleep(60);
  t.win.document.getElementById('passInput').value = pass;
  t.win.document.getElementById('btnAuth').click();
  await sleep(30);
  /* обход калибровки по логотипу — только для тех. администратора (v5.0) */
  t.win.document.getElementById('adminPass').value = 'admin-test-pass';
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(30);
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
  await sleep(30);
  t.win.document.getElementById('btnStart').click();
  await sleep(80);
  return t;
}

/* ============================================================ */

s.test('F12 блокируется и попадает в журнал', async () => {
  const t = await session();
  const before = t.win.Monitor.state.score;
  const ev = key(t.win, 'F12', { key: 'F12' });
  await sleep(40);
  eq(ev.defaultPrevented, true, 'F12 не перехвачен');
  assert(t.win.Monitor.state.score > before, 'штраф за F12 не начислен');
  assert(t.win.Monitor.state.viol.some((v) => v.type === 'devtools'), 'нет записи о DevTools');
  t.close();
});

s.test('Ctrl+Shift+I / J / C (инструменты разработчика) блокируются', async () => {
  const t = await session();
  const before = t.win.Monitor.state.score;
  ['KeyI', 'KeyJ', 'KeyC'].forEach((c) => key(t.win, c, { ctrl: true, shift: true, key: 'i' }));
  await sleep(40);
  assert(t.win.Monitor.state.score >= before + 21, 'штрафы за DevTools не начислены');
  eq(t.win.Monitor.state.blockedKeys >= 3, true, 'счётчик заблокированных клавиш не растёт');
  t.close();
});

s.test('исходник, сохранение, печать и буфер обмена заблокированы', async () => {
  const t = await session();
  const codes = [['KeyU', 'u'], ['KeyS', 's'], ['KeyP', 'p'], ['KeyC', 'c'], ['KeyV', 'v']];
  codes.forEach(([c, k]) => key(t.win, c, { ctrl: true, key: k }));
  await sleep(40);
  eq(t.win.Monitor.state.copyAttempts >= 2, true, 'буфер обмена не защищён');
  assert(t.win.Monitor.state.viol.some((v) => v.type === 'blocked'), 'нет записей о заблокированных клавишах');
  t.close();
});

s.test('новая вкладка, закрытие вкладки и переключение вкладок блокируются', async () => {
  const t = await session();
  const before = t.win.Monitor.state.score;
  key(t.win, 'KeyT', { ctrl: true, key: 't' });
  key(t.win, 'KeyW', { ctrl: true, key: 'w' });
  key(t.win, 'Tab', { ctrl: true, key: 'Tab' });
  await sleep(40);
  assert(t.win.Monitor.state.score >= before + 16, 'штрафы за переключение вкладок не начислены');
  t.close();
});

s.test('копирование, выделение, перетаскивание и контекстное меню отключены', async () => {
  const t = await session();
  const evs = ['copy', 'cut', 'dragstart', 'selectstart', 'contextmenu'];
  let blocked = 0;
  for (const type of evs) {
    const ev = new t.win.Event(type, { bubbles: true, cancelable: true });
    t.win.document.body.dispatchEvent(ev);
    if (ev.defaultPrevented) blocked++;
  }
  eq(blocked, evs.length, 'часть событий не перехвачена');
  t.close();
});

s.test('PrintScreen очищает буфер и фиксируется', async () => {
  const t = await session();
  const wrote = [];
  t.win.navigator.clipboard = { writeText: (x) => wrote.push(x) };
  key(t.win, 'PrintScreen', { key: 'PrintScreen' });
  await sleep(40);
  eq(wrote.length, 1, 'буфер не очищен');
  assert(t.win.Monitor.state.viol.some((v) => v.type === 'shot'), 'нет записи о снимке экрана');
  t.close();
});

s.test('попытка печати страницы фиксируется', async () => {
  const t = await session();
  t.win.document.dispatchEvent(new t.win.Event('beforeprint', { bubbles: true, cancelable: true }));
  await sleep(40);
  assert(t.win.Monitor.state.viol.some((v) => v.type === 'print'), 'нет записи о печати');
  t.close();
});

s.test('страница не открывается во фрейме (защита от clickjacking)', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  const frame = t.win.document.createElement('iframe');
  t.win.document.body.appendChild(frame);
  const fw = frame.contentWindow;
  fw.eval(appCode + '\n//# sourceURL=app-in-frame.js');
  await sleep(60);
  const html = frame.contentDocument.documentElement.innerHTML;
  assert(/Встраивание страницы запрещено/.test(html), 'фрейм не заблокирован');
  t.close();
});

s.test('удаление водяного знака обнаруживается проверкой целостности', async () => {
  const t = await session();
  const wm = t.win.document.getElementById('wmLayer');
  wm.parentNode.removeChild(wm);
  const problem = t.win.OBZ.integrity();
  assert(problem && /Водяной знак/.test(problem), 'целостность не зафиксирована: ' + problem);
  const before = t.win.Monitor.state.score;
  t.win.OBZ.guard();
  await sleep(40);
  assert(t.win.Monitor.state.score > before, 'штраф за удаление водяного знака не начислен');
  t.close();
});

s.test('подмена ключевой функции кода меняет контрольную сумму', async () => {
  const t = await session();
  const fp1 = t.win.OBZ.fingerprint();
  const orig = t.win.Monitor.penalty;
  t.win.Monitor.penalty = function (label, weight, sev) { return orig(label, weight, sev); };
  const fp2 = t.win.OBZ.fingerprint();
  assert(fp1 !== fp2, 'контрольная сумма не изменилась после подмены функции');
  const before = t.win.Monitor.state.score;
  t.win.OBZ.guard();
  await sleep(40);
  assert(t.win.Monitor.state.score > before, 'вмешательство в код не наказано');
  t.close();
});

s.test('правка localStorage (чистка штрафов) обнаруживается подписью', async () => {
  const t = await session();
  /* сначала «заработаем» штраф, чтобы правка была осмысленной */
  key(t.win, 'F12', { key: 'F12' });
  await sleep(40);
  const key1 = 'obzvon_v2_state';
  const raw = t.win.localStorage.getItem(key1);
  assert(raw, 'состояние сессии не сохранено');
  const d = JSON.parse(raw);
  assert(d.sig, 'в состоянии нет подписи');
  d.score = 0;                 /* «почистили» штрафы вручную */
  d.viol = [];
  d.elapsed = 999999;          /* «отмотали» время сессии */
  const tampered = JSON.stringify(d);
  const store = {}; store[key1] = tampered;
  t.close();

  const t2 = boot({ pass: 'test-pass', storage: store });
  await sleep(200);
  const st = t2.win.OBZ.state();
  eq(st.state, 'running', 'сессия не восстановилась');
  eq(st.integrityOk, false, 'целостность не нарушена — подмена не замечена');
  const hasTamper = t2.win.Monitor.state.viol.some((v) => v.type === 'tamper');
  eq(hasTamper, true, 'нет записи о подмене данных сессии');
  assert(t2.win.Monitor.state.score >= 20, 'штраф за подмену не начислен');
  t2.close();
});

s.test('автотест/бот-окружение обнаруживается', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  t.win.__playwright__ = { version: 'fake' };
  t.win.Monitor.setRunning(true);
  t.win.Monitor.guards.detectAutomation();
  await sleep(40);
  assert(t.win.Monitor.state.viol.some((v) => v.type === 'automation'), 'автотест не обнаружен');
  t.close();
});

s.test('navigator.webdriver обнаруживается', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  try { Object.defineProperty(t.win.navigator, 'webdriver', { value: true, configurable: true }); } catch (e) {}
  t.win.Monitor.setRunning(true);
  t.win.Monitor.guards.detectAutomation();
  await sleep(40);
  assert(t.win.Monitor.state.viol.some((v) => v.type === 'automation'), 'webdriver не обнаружен');
  t.close();
});

s.test('захват экрана через WebRTC фиксируется', async () => {
  const t = await session();
  const before = t.win.Monitor.state.score;
  try { await t.win.navigator.mediaDevices.getDisplayMedia(); } catch (e) {}
  await sleep(60);
  assert(t.win.Monitor.state.score > before, 'захват экрана не зафиксирован');
  assert(t.win.Monitor.state.viol.some((v) => v.type === 'webrtc'), 'нет записи о WebRTC');
  t.close();
});

s.test('страница во второй вкладке обнаруживается', async () => {
  const t = await session();
  /* имитируем живую «чужую» вкладку */
  t.win.localStorage.setItem('obzvon_v2_tab_ZZZZ', String(Date.now()));
  const before = t.win.Monitor.state.score;
  t.win.Monitor.guards.tabHeartbeat();
  await sleep(40);
  assert(t.win.Monitor.state.score > before, 'вторая вкладка не зафиксирована');
  assert(t.win.Monitor.state.viol.some((v) => v.type === 'tab'), 'нет записи о второй вкладке');
  t.close();
});

s.test('подмена системных часов обнаруживается', async () => {
  const t = await session();
  const realNow = t.win.Date.now;
  t.win.Date.now = function () { return realNow.call(t.win.Date) + 600000; };
  const before = t.win.Monitor.state.score;
  t.win.Monitor.guards.clockGuard();
  await sleep(40);
  assert(t.win.Monitor.state.score > before, 'подмена часов не зафиксирована');
  assert(t.win.Monitor.state.viol.some((v) => v.type === 'clock'), 'нет записи о подмене часов');
  t.win.Date.now = realNow;
  t.close();
});

s.test('в открытом API нет доступа к коду куратора и к проверкам', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(60);
  const api = Object.keys(t.win.OBZ || {});
  ['auth', 'authenticate', 'pass', 'passHash', 'start', 'end', 'reset', 'setState']
    .forEach((k) => assert(api.indexOf(k) < 0, 'в OBZ есть опасный метод: ' + k));
  /* в исходниках нет открытого кода куратора — только хеш */
  const src = appCode;
  const m = src.match(/passHash:\s*'([^']+)'/);
  assert(m, 'нет passHash');
  eq(m[1].length, 64, 'passHash должен быть sha256 (64 символа)');
  t.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
