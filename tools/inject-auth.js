/* ============================================================
   Внедрение кодов доступа в сборку ОБЗВОН v6.0

   Коды доступа не лежат в репозитории. Здесь они попадают в готовый
   сайт (dist/) — из локального auth.local.json или из секретов CI.

   Использование:
     node tools/inject-auth.js                 → берёт auth.local.json (локально)
     AUTH_LOCAL_B64=... node tools/inject-auth.js  → берёт файл из переменной CI
     node tools/inject-auth.js --check         → проверить, что коды на месте

   Переменные CI:
     AUTH_LOCAL_B64 — содержимое auth.local.json в base64 (секрет GitHub Actions)
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LOCAL_JSON = path.join(ROOT, 'auth.local.json');
const ITER = 150000;

function buildBrowserFile(roles) {
  const out = {};
  ['curator', 'admin'].forEach((r) => {
    const c = roles[r];
    if (!c) return;
    if (c.hash && c.salt && c.iter) {
      out[r] = { hash: c.hash, salt: c.salt, iter: c.iter };
      return;
    }
    /* старый формат (sha256): работает, пока код не перевыпущен */
    if (c.legacyHash) out[r] = { legacyHash: c.legacyHash };
  });
  return '/* ФАЙЛ С КОДАМИ ДОСТУПА. В РЕПОЗИТОРИИ ЕГО НЕТ (в .gitignore).\n' +
    '   Собран на сервере или в CI из секретов. Не публикуйте в открытом репозитории. */\n' +
    'window.OBZ_AUTH = ' + JSON.stringify(out, null, 2) + ';\n';
}

function main() {
  const args = process.argv.slice(2);
  const dist = path.join(ROOT, 'dist');
  const target = path.join(dist, 'js', 'auth.local.js');

  if (args.includes('--check')) {
    const ok = fs.existsSync(target);
    console.log(ok ? 'dist/js/auth.local.js — коды на месте' : 'dist/js/auth.local.js — НЕТ (коды не внедрены)');
    process.exit(ok ? 0 : 1);
  }

  let raw = null;
  /* 1) из секрета CI */
  if (process.env.AUTH_LOCAL_B64) {
    try { raw = Buffer.from(process.env.AUTH_LOCAL_B64, 'base64').toString('utf8'); }
    catch (e) { console.error('AUTH_LOCAL_B64 не декодируется'); process.exit(1); }
  }
  /* 2) из локального файла */
  if (!raw && fs.existsSync(LOCAL_JSON)) raw = fs.readFileSync(LOCAL_JSON, 'utf8');

  if (!raw) {
    console.log('Коды доступа не найдены — сборка будет без входа в пульт.');
    console.log('Создайте их: node tools/passgen.js --emit --admin --code "КОД"');
    console.log('(или задайте секрет AUTH_LOCAL_B64 в GitHub Actions)');
    process.exit(0);
  }

  let data;
  try { data = JSON.parse(raw); } catch (e) { console.error('auth.local.json не читается'); process.exit(1); }
  const roles = data.roles || data;
  const ready = ['curator', 'admin'].filter((r) => {
    const c = roles[r];
    return !!(c && ((c.hash && c.salt && c.iter) || c.legacyHash));
  });
  if (!ready.length) {
    console.log('В файле нет ни одного готового кода (нужны hash, salt, iter).');
    process.exit(0);
  }

  if (!fs.existsSync(path.join(dist, 'js'))) {
    console.log('dist/ не собран — сначала node tools/build.js');
    process.exit(0);
  }
  fs.writeFileSync(target, buildBrowserFile(roles), 'utf8');
  console.log('Коды внедрены в dist/js/auth.local.js (роли: ' + ready.join(', ') + ')');
  void ITER;
}

main();
