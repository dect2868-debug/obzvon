/* ============================================================
   Доктор ОБЗВОН v5.0 — статическая диагностика проекта

   Проверяет то, что ломается чаще всего:
     • версия синхронна во всех файлах;
     • все элементы, которые ищет код, есть в разметке;
     • все подключаемые файлы существуют;
     • CSP на месте и строгий;
     • в рабочих модулях нет отладочного console.log;
     • в коде нет открытых паролей и токенов;
     • код куратора и код администратора разные и заданы;
     • все JS-файлы разбираются (синтаксис);
     • меню и страницы совпадают.

   Использование:
     node tools/doctor.js          — только проверка (код 1, если есть ошибки)
     node tools/doctor.js --fix    — проверка + авто-починка известных сбоев
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const P = (f) => path.join(ROOT, f);
const read = (f) => fs.readFileSync(P(f), 'utf8');
const exists = (f) => fs.existsSync(P(f));

const FIX = process.argv.includes('--fix');
const errors = [];
const warns = [];
const fixed = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warns.push(msg); }
function ok(msg) { console.log('  OK    ' + msg); }

const MODULES = ['js/fx.js', 'js/monitor.js', 'js/nav.js', 'js/live.js',
                 'js/archive.js', 'js/audit.js', 'js/stats.js', 'js/profiles.js', 'js/health.js',
                 'js/moder.js', 'js/updater.js', 'js/app.js'];

console.log('ДИАГНОСТИКА ОБЗВОН');
console.log('');

/* ---------- 1. версия ---------- */
const vj = (() => { try { return JSON.parse(read('version.json')); } catch (e) { err('version.json не читается'); return null; } })();
if (vj) {
  const v = vj.v;
  const app = read('js/app.js');
  const mon = read('js/monitor.js');
  const html = read('index.html');
  const readme = read('README.md');
  const problems = [];
  const m = app.match(/appVersion:\s*'([^']+)'/);
  if (!m || m[1] !== v) problems.push('js/app.js: appVersion ≠ ' + v);
  const m2 = mon.match(/version:\s*'OBZVON-([^']+)'/);
  if (!m2 || m2[1] !== v) problems.push('js/monitor.js: подпись OBZVON ≠ ' + v);
  const bad = [...new Set([...html.matchAll(/\?v=([\d.]+)/g)].map((x) => x[1]).filter((x) => x !== v))];
  if (bad.length) problems.push('index.html: устаревшие ?v= — ' + bad.join(', '));
  if (!html.includes('ВЕРСИЯ ' + v)) problems.push('index.html: нет метки «ВЕРСИЯ ' + v + '»');
  const first = html.match(/news-ver">v([\d.]+)</);
  if (!first || first[1] !== v) problems.push('index.html: свежая новость не про версию ' + v);
  if (!readme.includes('# ОБЗВОН v' + v)) problems.push('README.md: заголовок не про версию ' + v);

  if (!problems.length) ok('версия ' + v + ' синхронизирована');
  else {
    problems.forEach((p) => err(p));
    if (FIX) {
      const { execFileSync } = require('child_process');
      execFileSync(process.execPath, [path.join(ROOT, 'tools', 'bump.js'), '--sync'], { cwd: ROOT, stdio: 'pipe' });
      fixed.push('версия разнесена по файлам (tools/bump.js --sync)');
      console.log('  FIX   версия синхронизирована автоматически');
    }
  }
}

/* ---------- 2. элементы разметки ---------- */
{
  const html = read('index.html');
  const app = read('js/app.js');
  const m = app.match(/\['sessionId'[\s\S]*?\]\s*\n\s*\.forEach/);
  if (!m) err('не найден список элементов в app.js');
  else {
    const ids = (m[0].match(/'([A-Za-z0-9_-]+)'/g) || []).map((x) => x.replace(/'/g, ''));
    const missing = ids.filter((id) => !new RegExp('id="' + id + '"').test(html));
    if (missing.length) err('в разметке нет элементов: ' + missing.join(', '));
    else ok('все ' + ids.length + ' служебных элементов на месте');
  }
}

/* ---------- 3. подключаемые файлы ---------- */
{
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"?]+)(?:\?[^"]*)?"/g)].map((x) => x[1]);
  const local = refs.filter((r) => !/^(https?:|data:|mailto:|#)/.test(r));
  /* файл кодов доступа подставляется при сборке (в репозитории его нет) */
  const OPTIONAL = ['js/auth.local.js'];
  const missing = local.filter((r) => !exists(r) && OPTIONAL.indexOf(r) < 0);
  const optionalMissing = local.filter((r) => !exists(r) && OPTIONAL.indexOf(r) >= 0);
  if (optionalMissing.length) {
    warn('файл(ы) ' + optionalMissing.join(', ') + ' отсутствуют — они подставляются при сборке (npm run build)');
  }
  if (missing.length) err('нет файлов, на которые ссылается страница: ' + missing.join(', '));
  else ok('все подключаемые файлы (' + local.length + ') на месте');
}

/* ---------- 4. CSP ---------- */
{
  const html = read('index.html');
  const m = html.match(/Content-Security-Policy" content="([^"]+)"/);
  if (!m) err('нет CSP — страницу можно подсунуть чужим кодом');
  else {
    const csp = m[1];
    if (!/default-src 'self'/.test(csp)) err('CSP: нет default-src self');
    if (/script-src[^;]*unsafe-inline/.test(csp)) err('CSP: в script-src разрешён unsafe-inline');
    if (!/object-src 'none'/.test(csp)) warn('CSP: нет object-src none');
    if (!/base-uri 'self'/.test(csp)) warn('CSP: нет base-uri self');
    if (!errors.length) ok('CSP на месте и строгий');
  }
}

/* ---------- 5. отладочные console.log ---------- */
{
  const bad = [];
  MODULES.forEach((f) => {
    const n = (read(f).match(/console\.log/g) || []).length;
    if (n) bad.push(f + ' (' + n + ')');
  });
  if (bad.length) err('отладочный console.log в рабочих модулях: ' + bad.join(', '));
  else ok('отладочных выводов в рабочих модулях нет');
}

/* ---------- 6. открытые секреты ---------- */
{
  const patterns = [
    { re: /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{4,}['"]/gi, what: 'пароль/токен' },
    { re: /\bBearer\s+[A-Za-z0-9._-]{16,}/g, what: 'токен доступа' },
    { re: /gh[pousr]_[A-Za-z0-9]{20,}/g, what: 'GitHub-токен' },
    { re: /\bsk-[A-Za-z0-9]{16,}/g, what: 'ключ API' }
  ];
  const files = [...MODULES, 'index.html', 'tools/doctor.js', 'tools/passgen.js', 'tools/bump.js', 'tools/build.js', 'tests/helpers.js'];
  const hits = [];
  files.forEach((f) => {
    if (!exists(f)) return;
    const src = read(f);
    patterns.forEach((p) => {
      const m = src.match(p.re);
      if (m) hits.push(f + ' — ' + p.what + ' (' + m.length + ')');
    });
  });
  if (hits.length) err('в коде видны секреты: ' + hits.join('; '));
  else ok('открытых паролей и токенов в коде нет');
}

/* ---------- 7. роли и коды (v6.0: коды живут вне репозитория) ---------- */
{
  const app = read('js/app.js');
  const grab = (k) => { const m = app.match(new RegExp(k + ":\\s*'([^']*)'")); return m ? m[1] : ''; };
  /* в исходниках хешей быть не должно — это проверяет пункт 12 */
  if (grab('passHash') || grab('adminHash')) {
    err('в CONFIG снова появились хеши кодов — коды должны быть только в auth.local.json');
  }
  /* локальный файл кодов (в репозитории его нет) */
  const authFile = path.join(ROOT, 'js', 'auth.local.js');
  if (!fs.existsSync(authFile)) {
    warn('нет js/auth.local.js — коды на этом компьютере не настроены (нужен node tools/passgen.js --emit)');
  } else {
    const code = fs.readFileSync(authFile, 'utf8');
    const m = code.match(/window\.OBZ_AUTH\s*=\s*(\{[\s\S]*?\});/);
    if (!m) {
      err('js/auth.local.js не разбирается — проверьте формат файла');
    } else {
      let roles = {};
      try { roles = JSON.parse(m[1]); } catch (e) { err('js/auth.local.js: нечитаемый JSON'); }
      const cur = roles.curator || {}, adm = roles.admin || {};
      const strong = (c) => !!(c && c.hash && c.salt && c.iter);
      const legacy = (c) => !!(c && c.legacyHash);
      if (!cur.hash && !cur.legacyHash) err('код куратора не настроен (auth.local.json)');
      if (!adm.hash && !adm.legacyHash) err('код тех. администратора не настроен (auth.local.json)');
      if (strong(cur) && strong(adm) && cur.hash === adm.hash) {
        err('код куратора и код тех. администратора совпадают — должны быть РАЗНЫЕ');
      }
      if (legacy(cur)) warn('код куратора в старом формате (sha256) — перевыпустите: node tools/passgen.js --emit --curator --code "КОД"');
      if (legacy(adm)) warn('код администратора в старом формате (sha256) — перевыпустите: node tools/passgen.js --emit --admin --code "КОД"');
      if (strong(cur) && strong(adm)) ok('коды ролей настроены в усиленном виде (PBKDF2) и различаются');
    }
  }
}

/* ---------- 8. синтаксис модулей ---------- */
{
  let bad = [];
  MODULES.forEach((f) => {
    try { new vm.Script(read(f), { filename: f }); }
    catch (e) { bad.push(f + ' (' + e.message + ')'); }
  });
  if (bad.length) err('синтаксические ошибки: ' + bad.join('; '));
  else ok('все ' + MODULES.length + ' модулей разбираются без ошибок');
}

/* ---------- 9. меню и страницы ---------- */
{
  const html = read('index.html');
  const links = [...html.matchAll(/data-view="([a-z]+)"/g)].map((x) => x[1]);
  const views = [...html.matchAll(/id="view-([a-z]+)"/g)].map((x) => x[1]);
  const noPage = links.filter((v) => views.indexOf(v) < 0);
  const noMenu = views.filter((v) => links.indexOf(v) < 0);
  if (noPage.length) err('пункты меню без страницы: ' + noPage.join(', '));
  if (noMenu.length) err('страницы без пункта меню: ' + noMenu.join(', '));
  if (!noPage.length && !noMenu.length) ok('меню и страницы совпадают (' + links.length + ')');
}

/* ---------- 10. скрипт сборки знает про все модули ---------- */
{
  const build = read('tools/build.js');
  const missing = MODULES.filter((f) => build.indexOf(f) < 0);
  if (missing.length) err('в сборку не попали модули: ' + missing.join(', '));
  else ok('сборка включает все модули');
}

/* ---------- 11. конфигурация и статус ---------- */
{
  if (!exists('config.json')) warn('нет config.json — удалённая конфигурация не работает');
  else {
    try {
      const cfg = JSON.parse(read('config.json'));
      if (cfg.app && cfg.app !== 'obzvon-config') warn('config.json: неожиданное поле app');
      ok('config.json читается');
    } catch (e) { err('config.json не читается: ' + e.message); }
  }
  if (!exists('status.json')) warn('нет status.json — состояние автоподдержки не покажется');
}

/* ---------- 12. в репозитории нет кодов доступа (v6.0) ---------- */
{
  /* а) в исходниках не должно быть присваиваний хешей кодов */
  const files = [...MODULES, 'index.html', 'tools/passgen.js', 'tools/inject-auth.js',
    'tools/doctor.js', 'tools/bump.js', 'tools/build.js', 'tools/integrity.js',
    'tests/helpers.js', 'tests/roles.js', 'README.md', 'docs/ADMIN.md'];
  const hits = [];
  const re = /(?:passHash|adminHash|legacyHash|authHash|hash)\s*:\s*'([0-9a-f]{32,})'/gi;
  files.forEach((f) => {
    if (!exists(f)) return;
    const m = read(f).match(re);
    if (m) hits.push(f + ' (' + m.length + ')');
  });
  if (hits.length) err('в исходниках видны хеши кодов доступа: ' + hits.join(', '));
  else ok('в исходниках нет хешей кодов доступа');

  /* б) файлы с кодами не должны отслеживаться git */
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('git', ['ls-files', '--', 'auth.local.json', 'js/auth.local.js', 'пароль*'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (out) err('файлы с кодами отслеживаются git — их надо убрать: ' + out.split('\n').join(', '));
    else ok('файлы с кодами не отслеживаются git');
  } catch (eGit) {
    warn('не удалось проверить git-состояние файлов с кодами');
  }
  /* в) в .gitignore должны быть файлы с кодами */
  const gi = read('.gitignore');
  ['auth.local.json', 'js/auth.local.js'].forEach((f) => {
    if (gi.indexOf(f) < 0) err('в .gitignore нет ' + f + ' — коды могут утечь в репозиторий');
  });
}

/* ---------- итог ---------- */
console.log('');
if (warns.length) {
  console.log('ПРЕДУПРЕЖДЕНИЯ (' + warns.length + '):');
  warns.forEach((w) => console.log('  ! ' + w));
  console.log('');
}
if (errors.length) {
  console.log('ОШИБКИ (' + errors.length + '):');
  errors.forEach((e) => console.log('  • ' + e));
  if (FIX) {
    console.log('');
    console.log('Часть ошибок исправлена автоматически (' + fixed.length + '). Остальное — вручную.');
  }
  process.exit(1);
}
console.log('Диагностика пройдена: ошибок нет.');
if (warns.length) process.exit(0);
process.exit(0);
