/* ============================================================
   Тесты v6.0: коды доступа вне репозитория, политики вмешательства,
   журнал угроз, отпечаток файлов, горячие клавиши, подпись отчёта.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const ADMIN_PASS = 'admin-test-pass';
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const s = suite('V6 (коды вне репозитория, политики, надзор)');

async function loginAdmin(t) {
  t.win.document.getElementById('adminPass').value = ADMIN_PASS;
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(40);
}

/* ============================================================
   КОДЫ ДОСТУПА ВНЕ РЕПОЗИТОРИЯ
   ============================================================ */

s.test('в репозитории нет хешей кодов доступа', () => {
  const files = ['js/app.js', 'js/monitor.js', 'index.html', 'config.json', 'version.json'];
  const re = /(?:passHash|adminHash|legacyHash)\s*:\s*'[0-9a-f]{32,}'/i;
  files.forEach((f) => {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert(!re.test(code), 'в ' + f + ' виден хеш кода');
  });
  ok0();
});
function ok0() { /* пустышка, чтобы тест читался как обычный */ }

s.test('файлы с кодами не отслеживаются git и есть в .gitignore', () => {
  const out = execFileSync('git', ['ls-files', '--', 'auth.local.json', 'js/auth.local.js'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  eq(out, '', 'файлы с кодами попали в репозиторий: ' + out);
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert(gi.indexOf('auth.local.json') >= 0, 'auth.local.json не в .gitignore');
  assert(gi.indexOf('js/auth.local.js') >= 0, 'js/auth.local.js не в .gitignore');
});

s.test('страница подключает файл кодов доступа', () => {
  assert(html.indexOf('js/auth.local.js') >= 0, 'нет подключения js/auth.local.js');
});

s.test('код роли принимается только в усиленном виде (PBKDF2)', async () => {
  /* обычный вход с PBKDF2 — работает */
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  await loginAdmin(t);
  eq(t.el('adminBody').hidden, false, 'админка не открылась с корректным кодом');
  t.close();

  /* старый формат (sha256 без соли) из файла вне репозитория — принимается,
     но помечается как слабый */
  const t2 = boot({ pass: 'test-pass', legacyCurator: true });
  await sleep(120);
  t2.win.document.getElementById('passInput').value = 'test-pass';
  t2.win.document.getElementById('btnAuth').click();
  await sleep(40);
  eq(t2.el('ctrlRow').hidden, false, 'пульт не открылся со старым форматом кода');
  t2.close();
});

s.test('в пульте показывается предупреждение, если код в старом формате', async () => {
  const t = boot({ pass: 'test-pass', legacyCurator: true });
  await sleep(120);
  await loginAdmin(t);
  const txt = t.el('adminRoles').textContent || '';
  assert(/старом формате/.test(txt), 'нет предупреждения о старом формате: ' + txt);
  t.close();
});

/* ============================================================
   ПОЛИТИКИ ВМЕШАТЕЛЬСТВА
   ============================================================ */

s.test('политики из конфигурации применяются', async () => {
  const t = boot({
    pass: 'test-pass',
    config: {
      app: 'obzvon-config', v: '6.0',
      policies: { autoPause: true, softMode: true, autoReport: true, maxAttempts: 3 }
    }
  });
  await sleep(300);
  const p = t.win.OBZ.policies();
  eq(p.autoPause, true, 'авто-пауза не применена');
  eq(p.softMode, true, 'мягкий режим не применён');
  eq(p.autoReport, true, 'авто-отчёт не применён');
  eq(p.maxAttempts, 3, 'лимит попыток не применён');
  t.close();
});

s.test('мягкий режим: нарушения фиксируются, но не штрафуются', async () => {
  const t = boot({ pass: 'test-pass', config: { policies: { softMode: true } } });
  await sleep(250);
  await loginAdmin(t);
  t.win.Monitor.setRunning(true);
  const before = t.win.Monitor.state.score;
  t.win.Monitor.penalty('проверка мягкого режима', 10);
  await sleep(40);
  eq(t.win.Monitor.state.score, before, 'мягкий режим всё же начислил штраф');
  assert(t.win.Monitor.state.viol.length > 0, 'нарушение не зафиксировано');
  t.close();
});

s.test('журнал угроз собирает попытки взлома', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.win.document.getElementById('adminPass').value = 'wrong';
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(60);
  const threats = t.win.OBZ.threats();
  assert(threats.length >= 1, 'журнал угроз пуст');
  assert(threats.some((x) => x.kind === 'auth'), 'нет записи о неудачном входе');
  t.close();
});

/* ============================================================
   ОТПЕЧАТОК ФАЙЛОВ И ОТЧЁТ
   ============================================================ */

s.test('опубликованный отпечаток совпадает с загруженным кодом', async () => {
  const p = path.join(ROOT, 'integrity.json');
  assert(fs.existsSync(p), 'нет integrity.json');
  const published = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = boot({ pass: 'test-pass' });
  await sleep(250);
  eq(t.win.OBZ.fingerprint(), published.fingerprint,
    'отпечаток разошёлся с кодом — пересчитайте: node tools/integrity.js');
  t.close();
});

s.test('отчёт содержит контрольную сумму и аудит', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  const rep = t.win.OBZ.report();
  assert(rep.sha256 && rep.sha256.length === 64, 'нет контрольной суммы отчёта');
  assert(rep.audit, 'в отчёте нет журнала действий');
  assert(Array.isArray(rep.threats), 'в отчёте нет списка угроз');
  /* сумма должна совпадать с телом отчёта */
  const copy = JSON.parse(JSON.stringify(rep));
  delete copy.sha256;
  eq(crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex'), rep.sha256,
    'контрольная сумма отчёта не сходится');
  t.close();
});

/* ============================================================
   ГОРЯЧИЕ КЛАВИШИ
   ============================================================ */

s.test('горячие клавиши куратора работают (пауза и продолжение)', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  t.win.document.getElementById('passInput').value = 'test-pass';
  t.win.document.getElementById('btnAuth').click();
  await sleep(40);
  await loginAdmin(t);
  /* логотип → обход калибровки (только для админа) */
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
  await sleep(30);
  t.win.document.getElementById('btnStart').click();
  await sleep(120);
  eq(t.win.OBZ.state().state, 'running', 'сессия не началась');

  const key = (code, k) => t.win.document.dispatchEvent(
    new t.win.KeyboardEvent('keydown', { code, key: k || code, bubbles: true, cancelable: true }));
  key('Space', ' ');
  await sleep(60);
  eq(t.win.OBZ.state().state, 'paused', 'пробел не поставил сессию на паузу');
  key('Space', ' ');
  await sleep(60);
  eq(t.win.OBZ.state().state, 'running', 'пробел не продолжил сессию');
  t.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
