/* ============================================================
   Тесты v5.0: роли и права, надзор, аудит, удалённая конфигурация,
   закрытые дыры (выдача прав при восстановлении, обход калибровки,
   подмена счётчиков, XSS в истории, формулы в CSV).
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const ADMIN_PASS = 'admin-test-pass';
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

const s = suite('ROLES (v5.0: роли, надзор, дыры)');

/* ---------- helpers ---------- */

async function loginCurator(t) {
  t.win.document.getElementById('passInput').value = 'test-pass';
  t.win.document.getElementById('btnAuth').click();
  await sleep(30);
}
async function loginAdmin(t) {
  t.win.document.getElementById('adminPass').value = ADMIN_PASS;
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(40);
}

/* ============================================================
   РОЛИ И ПРАВА
   ============================================================ */

s.test('код куратора не открывает админку', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.win.document.getElementById('adminPass').value = 'test-pass';
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(60);
  eq(t.el('adminBody').hidden, true, 'админка открылась по коду куратора');
  eq(t.win.OBZ.role(), null, 'роль выдана по коду куратора');
  t.close();
});

s.test('код администратора открывает и пульт, и админку', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  await loginAdmin(t);
  eq(t.el('adminBody').hidden, false, 'админка не открылась');
  eq(t.el('ctrlRow').hidden, false, 'пульт куратора не открылся');
  eq(t.win.OBZ.role(), 'admin', 'роль не admin');
  t.close();
});

s.test('в пульте можно войти и по коду администратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.win.document.getElementById('passInput').value = ADMIN_PASS;
  t.win.document.getElementById('btnAuthAdmin').click();
  await sleep(60);
  eq(t.el('ctrlRow').hidden, false, 'пульт не открылся по коду администратора');
  eq(t.win.OBZ.role(), 'admin', 'роль не admin');
  t.close();
});

s.test('счётчики неудачных попыток раздельны: ошибка в админке не блокирует куратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  /* пять неверных попыток в админке */
  for (let i = 0; i < 5; i++) {
    t.win.document.getElementById('adminPass').value = 'wrong-' + i;
    t.win.document.getElementById('btnAdminAuth').click();
    await sleep(10);
  }
  /* вход куратора всё равно работает */
  await loginCurator(t);
  eq(t.el('ctrlRow').hidden, false, 'вход куратора заблокирован из-за ошибок в админке');
  t.close();
});

s.test('неверный код в админке записывается в журнал действий', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.win.document.getElementById('adminPass').value = 'wrong';
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(60);
  const items = t.win.OBZ.audit();
  assert(items.some((i) => i.action === 'auth.fail'), 'нет записи о неудачном входе');
  t.close();
});

/* ============================================================
   ЗАКРЫТЫЕ ДЫРЫ
   ============================================================ */

s.test('восстановление сессии после перезагрузки НЕ выдаёт права куратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  await loginCurator(t);
  t.win.document.getElementById('adminPass').value = ADMIN_PASS;
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(40);
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
  await sleep(30);
  t.win.document.getElementById('btnStart').click();
  await sleep(120);

  const store = {};
  const raw = t.win.localStorage.getItem('obzvon_v2_state');
  assert(raw, 'состояние сессии не сохранено');
  store['obzvon_v2_state'] = raw;
  t.close();

  /* новая «вкладка» с тем же хранилищем */
  const t2 = boot({ pass: 'test-pass', storage: store });
  await sleep(250);
  eq(t2.win.OBZ.state().state, 'running', 'сессия не восстановилась');
  eq(t2.el('ctrlRow').hidden, true, 'пульт куратора открылся без кода');
  eq(t2.win.OBZ.role(), null, 'роль выдана при восстановлении сессии');
  t2.close();
});

s.test('обход калибровки по логотипу недоступен без прав администратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 6; i++) logo.click();
  await sleep(60);
  const st = t.win.OBZ.state();
  assert(!/КАЛИБРОВКА ПРОЙДЕНА/.test(t.el('calibStatus').innerHTML || ''),
    'калибровка пройдена без прав администратора');
  void st;
  t.close();
});

s.test('состояние монитора наружу отдаётся копией — счётчики не подчистить', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  await loginCurator(t);
  const before = t.win.Monitor.state.score;
  const copy = t.win.Monitor.state;
  copy.score = 0;
  copy.viol.length = 0;
  eq(t.win.Monitor.state.score, before, 'изменение копии повлияло на оригинал');
  t.close();
});

s.test('публичный API не даёт применить обновление без прав администратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  eq(t.win.OBZ.applyUpdate(), false, 'обновление применилось без прав');
  eq(t.win.OBZ.update('9.9'), false, 'баннер обновления показался без прав');
  t.close();
});

s.test('в истории нет выполнения чужого кода (XSS)', async () => {
  const evil = JSON.stringify([{
    id: '"><img src=x onerror=alert(1)>',
    startedAt: Date.now(), endedAt: Date.now(), duration: 1000,
    conc: 90, cheat: 0, focus: 100, reaction: 400,
    verdict: '<script>window.__xss=1<\/script>', challenges: 3, ok: 3, viol: 0, chips: [], device: 'test'
  }]);
  const t = boot({ pass: 'test-pass', storage: { obzvon_v2_history: evil } });
  await sleep(250);
  eq(t.win.__xss, undefined, 'чужой код выполнился');
  eq(t.$$('#archTable img').length, 0, 'в таблицу истории попал чужой <img>');
  const html = t.el('archTable').innerHTML;
  assert(html.indexOf('&lt;script&gt;') >= 0 || html.indexOf('&lt;img') >= 0,
    'данные истории не экранированы: ' + html.slice(0, 200));
  t.close();
});

s.test('CSV не содержит формул (защита от = + - @ в начале)', async () => {
  const evil = JSON.stringify([{
    id: '=cmd|calc', startedAt: Date.now(), endedAt: Date.now(), duration: 1000,
    conc: 90, cheat: 0, focus: 100, reaction: 400, verdict: '=HYPERLINK("x")',
    challenges: 3, ok: 3, viol: 0, chips: ['=1+1'], device: 'test'
  }]);
  const t = boot({ pass: 'test-pass', storage: { obzvon_v2_history: evil } });
  await sleep(250);
  const csv = t.win.Archive.csv();
  const lines = csv.split('\r\n').slice(1);
  lines.forEach((line) => {
    line.split(';').forEach((cell) => {
      assert(!/^[=+\-@]/.test(cell), 'в CSV осталась формула: ' + cell);
    });
  });
  t.close();
});

/* ============================================================
   НАДЗОР, АУДИТ, КОНФИГУРАЦИЯ
   ============================================================ */

s.test('журнал действий пишет ключевые события сессии', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  await loginAdmin(t);
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
  await sleep(30);
  t.win.document.getElementById('btnStart').click();
  await sleep(120);
  t.win.document.getElementById('btnEnd').click();
  await sleep(120);
  const acts = t.win.OBZ.audit().map((i) => i.action);
  assert(acts.indexOf('admin.open') >= 0, 'нет записи о входе в админку');
  assert(acts.indexOf('session.start') >= 0, 'нет записи о старте обзвона');
  assert(acts.indexOf('session.end') >= 0, 'нет записи о завершении обзвона');
  t.close();
});

s.test('удалённая конфигурация применяется без перезагрузки кода', async () => {
  const t = boot({
    pass: 'test-pass',
    config: {
      app: 'obzvon-config', v: '5.0',
      threshold: 75, calibCount: 20,
      features: { strict: true, autoUpdate: false },
      banner: 'тестовое объявление'
    }
  });
  await sleep(300);
  const cfg = t.win.OBZ.config();
  assert(cfg && cfg.threshold === 75, 'конфигурация не прочитана');
  eq(t.el('selThreshold').value, '75', 'порог из конфигурации не применён');
  eq(t.el('selCalib').value, '20', 'калибровка из конфигурации не применена');
  t.close();
});

s.test('статус автоподдержки показывается в админке', async () => {
  const t = boot({
    pass: 'test-pass',
    status: { app: 'obzvon-status', v: '5.0', result: 'ok', at: '2026-11-04T00:00:00Z', commit: 'abcdef1234' }
  });
  await sleep(200);
  await loginAdmin(t);
  const txt = t.el('adminBuildInfo').textContent || '';
  assert(/ok/.test(txt), 'статус сборки не показан: ' + txt);
  assert(/5\.0/.test(txt), 'версия сборки не показана: ' + txt);
  t.close();
});

s.test('PBKDF2 в коде совпадает с эталоном (соль + итерации)', () => {
  /* вырезаем крипто-функции из app.js и сверяем с node:crypto */
  function grab(name) {
    const i = appCode.indexOf('function ' + name + '(');
    assert(i >= 0, 'нет функции ' + name);
    let depth = 0, started = false;
    for (let j = i; j < appCode.length; j++) {
      if (appCode[j] === '{') { depth++; started = true; }
      else if (appCode[j] === '}') { depth--; if (started && depth === 0) return appCode.slice(i, j + 1); }
    }
    throw new Error('незакрытая функция ' + name);
  }
  const kStart = appCode.indexOf('var SHA_K = [');
  const kEnd = appCode.indexOf('];', kStart) + 2;
  const code = appCode.slice(kStart, kEnd) + '\n' +
    ['utf8Bytes', 'bytesToHex', 'hexToBytes', 'sha256bytes', 'sha256hex', 'hmacSha256', 'pbkdf2hex']
      .map(grab).join('\n');
  const api = new Function(code + '\nreturn { sha256hex: sha256hex, pbkdf2hex: pbkdf2hex };')();

  const sha = api.sha256hex('обзвон');
  eq(sha, crypto.createHash('sha256').update('обзвон', 'utf8').digest('hex'), 'sha256 не совпал');

  const salt = '00112233445566778899aabbccddeeff';
  const iter = 2000;
  const mine = api.pbkdf2hex('тест-код', salt, iter, 32);
  const ref = crypto.pbkdf2Sync('тест-код', Buffer.from(salt, 'hex'), iter, 32, 'sha256').toString('hex');
  eq(mine, ref, 'pbkdf2 не совпал с эталоном');
});

s.test('в репозитории нет открытых кодов — только хеши вне репозитория', () => {
  /* v6.0: хешей кодов в исходниках нет вообще — они живут в auth.local.json */
  const m = appCode.match(/passHash:\s*'([^']*)'/);
  assert(m, 'в CONFIG нет поля passHash');
  eq(m[1], '', 'в CONFIG снова появился хеш кода куратора');
  const a = appCode.match(/adminHash:\s*'([^']*)'/);
  assert(a, 'в CONFIG нет поля adminHash');
  eq(a[1], '', 'в CONFIG снова появился хеш кода администратора');
  /* файл кодов подключается к странице */
  assert(/js\/auth\.local\.js/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')),
    'страница не подключает файл кодов');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
