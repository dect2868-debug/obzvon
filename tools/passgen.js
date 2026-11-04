/* ============================================================
   Генератор кодов доступа ОБЗВОН v5.0

   Коды куратора и тех. администратора РАЗНЫЕ. В коде сайта лежит
   только хеш — открытым текстом пароля нет. Здесь хеш считается
   по PBKDF2-HMAC-SHA256 (соль + 150 000 итераций): даже если
   опубликованный хеш попадёт к кому-то, перебор кода становится
   практически невозможным.

   Использование:
     node tools/passgen.js "мой код"              → строки для CONFIG
     node tools/passgen.js "мой код" --admin      → для тех. администратора
     node tools/passgen.js --check "мой код"      → проверить код по CONFIG
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ITER = 150000;

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const positional = argv.filter((a) => !a.startsWith('--'));
const code = positional[0];
const isAdmin = flags.includes('--admin');
const isCheck = flags.includes('--check');

function pbkdf2(pwd, saltHex, iter) {
  return crypto.pbkdf2Sync(pwd, Buffer.from(saltHex, 'hex'), iter, 32, 'sha256').toString('hex');
}

function usage() {
  console.log('Генератор кодов доступа ОБЗВОН');
  console.log('');
  console.log('  node tools/passgen.js "КОД"            — строки CONFIG для кода куратора');
  console.log('  node tools/passgen.js "КОД" --admin    — строки CONFIG для тех. администратора');
  console.log('  node tools/passgen.js --check "КОД"    — проверить код по текущему CONFIG');
  console.log('');
  console.log('Код НЕ сохраняется в файлы и не попадает в git — только хеш.');
}

if (!code) { usage(); process.exit(1); }

if (isCheck) {
  /* сверяем код с тем, что уже прописано в CONFIG */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const grab = (key) => {
    const m = src.match(new RegExp(key + ":\\s*'([^']*)'"));
    return m ? m[1] : '';
  };
  const grabNum = (key) => {
    const m = src.match(new RegExp(key + ":\\s*(\\d+)"));
    return m ? parseInt(m[1], 10) : 0;
  };
  let ok = false;
  if (isAdmin) {
    const hash = grab('adminHash'), salt = grab('adminSalt'), iter = grabNum('adminIter');
    ok = salt && iter
      ? pbkdf2(code, salt, iter) === hash
      : crypto.createHash('sha256').update(code, 'utf8').digest('hex') === hash;
    console.log('тех. администратор: ' + (ok ? 'КОД ВЕРНЫЙ' : 'код не совпадает'));
  } else {
    const hash = grab('passHash'), salt = grab('passSalt'), iter = grabNum('passIter');
    ok = salt && iter
      ? pbkdf2(code, salt, iter) === hash
      : crypto.createHash('sha256').update(code, 'utf8').digest('hex') === hash;
    console.log('куратор: ' + (ok ? 'КОД ВЕРНЫЙ' : 'код не совпадает'));
  }
  process.exit(ok ? 0 : 1);
}

/* новый код */
const salt = crypto.randomBytes(16).toString('hex');
const hash = pbkdf2(code, salt, ITER);

console.log('');
console.log('=== ' + (isAdmin ? 'ТЕХ. АДМИНИСТРАТОР' : 'КУРАТОР') + ' ===');
console.log('');
console.log('Вставьте эти строки в CONFIG (файл js/app.js):');
console.log('');
if (isAdmin) {
  console.log("    adminHash: '" + hash + "',");
  console.log("    adminSalt: '" + salt + "',");
  console.log('    adminIter: ' + ITER + ',');
} else {
  console.log("    passHash: '" + hash + "',");
  console.log("    passSalt: '" + salt + "',");
  console.log('    passIter: ' + ITER + ',');
}
console.log('');
console.log('Проверка: node tools/passgen.js --check' + (isAdmin ? ' --admin' : '') + ' "ВАШ КОД"');
console.log('');
console.log('Внимание: код держите в тайне. Хеш в публичном репозитории');
console.log('без соли можно перебрать — с PBKDF2 это уже непрактично.');
