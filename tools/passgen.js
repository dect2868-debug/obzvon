/* ============================================================
   Коды доступа ОБЗВОН v6.0 — генератор и хранилище вне репозитория

   С v6.0 коды доступа НЕ лежат в репозитории:
     • auth.local.json  — источник правды (хеши), файл ЛОКАЛЬНЫЙ, в git не попадает;
     • js/auth.local.js — то, что отдаётся браузеру; генерируется из auth.local.json.

   На сервере/CI файл js/auth.local.js собирается из секретов GitHub Actions
   (см. .github/workflows/pages.yml) — в репозитории его нет, но сайт работает.

   Использование:
     node tools/passgen.js "КОД"                 → строки для CONFIG (справочно)
     node tools/passgen.js "КОД" --admin         → для тех. администратора
     node tools/passgen.js --check "КОД"         → проверить код
     node tools/passgen.js --emit                → задать/обновить коды в auth.local.json
     node tools/passgen.js --emit --admin --code "КОД"   → задать код роли
     node tools/passgen.js --emit --curator --code "КОД"
     node tools/passgen.js --show                → что сейчас настроено (без самих хешей)
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ITER = 150000;
const LOCAL_JSON = path.join(ROOT, 'auth.local.json');
const LOCAL_JS = path.join(ROOT, 'js', 'auth.local.js');

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (name) => flags.includes(name);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

function pbkdf2(pwd, saltHex, iter) {
  return crypto.pbkdf2Sync(pwd, Buffer.from(saltHex, 'hex'), iter, 32, 'sha256').toString('hex');
}

/* ---------- локальное хранилище кодов ---------- */
function readLocal() {
  try {
    const d = JSON.parse(fs.readFileSync(LOCAL_JSON, 'utf8'));
    return (d && typeof d === 'object') ? d : {};
  } catch (e) { return {}; }
}
function writeLocal(obj) {
  fs.writeFileSync(LOCAL_JSON, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/* файл для браузера */
function writeBrowserFile(local) {
  const roles = {};
  ['curator', 'admin'].forEach((r) => {
    const c = local[r];
    if (!c) return;
    /* усиленный формат (PBKDF2) */
    if (c.hash && c.salt && c.iter) {
      roles[r] = { hash: c.hash, salt: c.salt, iter: c.iter };
      return;
    }
    /* старый формат (sha256) — работает, но его надо перевыпустить */
    if (c.legacyHash) roles[r] = { legacyHash: c.legacyHash };
  });
  const body =
    '/* ФАЙЛ С КОДАМИ ДОСТУПА. В РЕПОЗИТОРИИ ЕГО НЕТ (в .gitignore).\n' +
    '   Собирается из auth.local.json или из секретов CI. Не публикуйте его в открытом репозитории. */\n' +
    'window.OBZ_AUTH = ' + JSON.stringify(roles, null, 2) + ';\n';
  fs.writeFileSync(LOCAL_JS, body, 'utf8');
  return Object.keys(roles);
}

/* ---------- режимы ---------- */
if (flag('--show')) {
  const local = readLocal();
  console.log('');
  console.log('Настроенные роли (хеши скрыты):');
  ['curator', 'admin'].forEach((r) => {
    const c = local[r];
    const name = r === 'curator' ? 'куратор      ' : 'тех. админ  ';
    if (!c || (!c.hash && !c.legacyHash)) { console.log('  ' + name + ' — НЕ НАСТРОЕН'); return; }
    if (c.hash && c.salt && c.iter) {
      console.log('  ' + name + ' — PBKDF2, итераций ' + c.iter);
    } else if (c.legacyHash) {
      console.log('  ' + name + ' — СТАРЫЙ формат (sha256), перевыпустите код');
    } else {
      console.log('  ' + name + ' — настроен, но без соли — перевыпустите код');
    }
  });
  console.log('');
  console.log('Файлы: auth.local.json (истина), js/auth.local.js (для браузера)');
  console.log('');
  process.exit(0);
}

if (flag('--emit')) {
  const role = flag('--admin') ? 'admin' : (flag('--curator') ? 'curator' : null);
  const code = arg('--code', null) || positional[0];
  const local = readLocal();
  if (!role) {
    console.error('Укажите роль: --curator или --admin');
    process.exit(1);
  }
  if (!code) {
    console.error('Укажите код: --code "ВАШ КОД"');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  local[role] = {
    hash: pbkdf2(code, salt, ITER),
    salt: salt,
    iter: ITER,
    updatedAt: new Date().toISOString()
  };
  writeLocal(local);
  const roles = writeBrowserFile(local);
  console.log('');
  console.log('Код роли «' + role + '» обновлён в auth.local.json');
  console.log('Файл для браузера: js/auth.local.js (роли: ' + roles.join(', ') + ')');
  console.log('');
  console.log('Проверка: node tools/passgen.js --check "ВАШ КОД"' + (role === 'admin' ? ' --admin' : ''));
  console.log('');
  console.log('ВАЖНО: auth.local.json и js/auth.local.js не попадают в git (.gitignore).');
  console.log('Для сервера: скопируйте js/auth.local.js в корень сайта или соберите через CI.');
  console.log('');
  process.exit(0);
}

if (flag('--check')) {
  const code = positional[0] || arg('--code', null);
  const role = flag('--admin') ? 'admin' : 'curator';
  const local = readLocal();
  const c = local[role];
  if (!code) { console.error('Укажите код для проверки'); process.exit(1); }
  if (!c || !c.hash) {
    console.log(role + ': код не настроен (auth.local.json)');
    process.exit(1);
  }
  const ok = c.salt && c.iter
    ? pbkdf2(code, c.salt, c.iter) === c.hash
    : crypto.createHash('sha256').update(code, 'utf8').digest('hex') === c.hash;
  console.log(role + ': ' + (ok ? 'КОД ВЕРНЫЙ' : 'код не совпадает'));
  process.exit(ok ? 0 : 1);
}

/* справочный режим: показать строки для ручной настройки */
const code = positional[0];
const isAdmin = flag('--admin');
if (!code) {
  console.log('Генератор кодов доступа ОБЗВОН v6.0');
  console.log('');
  console.log('  node tools/passgen.js --show                          — что настроено');
  console.log('  node tools/passgen.js --emit --curator --code "КОД"   — задать код куратора');
  console.log('  node tools/passgen.js --emit --admin --code "КОД"     — задать код тех. админа');
  console.log('  node tools/passgen.js --check "КОД" [--admin]          — проверить код');
  console.log('');
  console.log('Коды хранятся в auth.local.json и js/auth.local.js — оба файла вне репозитория.');
  console.log('');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = pbkdf2(code, salt, ITER);
console.log('');
console.log('=== ' + (isAdmin ? 'ТЕХ. АДМИНИСТРАТОР' : 'КУРАТОР') + ' ===');
console.log('');
console.log('Сгенерируйте файлы кодов:');
console.log('  node tools/passgen.js --emit ' + (isAdmin ? '--admin' : '--curator') + ' --code "ВАШ КОД"');
console.log('');
console.log('Ручная настройка (если нужно вручную):');
console.log("  hash: '" + hash + "',");
console.log("  salt: '" + salt + "',");
console.log('  iter: ' + ITER);
console.log('');
