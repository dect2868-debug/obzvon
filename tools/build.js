/* ============================================================
   Сборка сайта для размещения на СВОЕМ хостинге (без GitHub)
   node tools/build.js
   Результат в dist/:
     index.html        — обычная версия (файлы рядом)
     index.single.html — ВСЁ в одном файле (css+js+логотип внутри)
     assets/ css/ js/  — файлы сайта
   Плюс архив obzvon-site.zip для загрузки через панель хостинга.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function copyDir(src, dst) {
  mkdirp(dst);
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/* ---------- читаем исходники ---------- */
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
const scripts = ['js/fx.js', 'js/monitor.js', 'js/nav.js', 'js/live.js', 'js/archive.js', 'js/audit.js', 'js/stats.js', 'js/health.js', 'js/app.js']
  .map((f) => ({ file: f, code: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
const logoSvg = fs.readFileSync(path.join(ROOT, 'assets', 'logo.svg'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

/* ---------- 1) обычная сборка (файлы рядом) ---------- */
rmrf(DIST);
mkdirp(DIST);
copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));
copyDir(path.join(ROOT, 'css'), path.join(DIST, 'css'));
copyDir(path.join(ROOT, 'js'), path.join(DIST, 'js'));
fs.copyFileSync(path.join(ROOT, 'version.json'), path.join(DIST, 'version.json'));
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
/* конфигурация, статус автоподдержки и отпечаток файлов (v5.0–v6.0) — сайт читает их сам */
for (const extra of ['config.json', 'status.json', 'integrity.json']) {
  const p = path.join(ROOT, extra);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(DIST, extra));
}
/* на всякий случай — 404 отдаёт главную (для SPA-хостингов) */
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, '404.html'));

/* ---------- 1b) коды доступа (v6.0) ----------
   В репозитории их нет: берём из локального auth.local.json или из
   секрета CI (AUTH_LOCAL_B64) и кладём в dist/js/ — до сборки
   однофайловой версии, чтобы коды попали и туда. */
try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'inject-auth.js')], { cwd: ROOT, stdio: 'pipe' });
} catch (e) { console.error('коды доступа не внедрены: ' + e.message); }
if (!fs.existsSync(path.join(DIST, 'js', 'auth.local.js'))) {
  fs.writeFileSync(path.join(DIST, 'js', 'auth.local.js'),
    '/* ФАЙЛ С КОДАМИ ДОСТУПА (пустой: коды не заданы) */\nwindow.OBZ_AUTH = {};\n', 'utf8');
  console.error('ВНИМАНИЕ: коды доступа не заданы — входа в пульт и админку не будет');
}

/* ---------- 2) сборка в один файл ---------- */
const nonce = crypto.randomBytes(16).toString('base64');
let single = html;

/* стили — внутрь <style> */
single = single.replace(
  /<link rel="stylesheet" href="css\/styles\.css\?v=[^"]+"\s*\/>/,
  '<style>\n' + css + '\n</style>'
);

/* коды доступа — внутрь (иначе в однофайловой версии вход не работает) */
const authPath = path.join(DIST, 'js', 'auth.local.js');
const authCode = fs.existsSync(authPath)
  ? fs.readFileSync(authPath, 'utf8').replace(/<\/script/gi, '<\\/script')
  : 'window.OBZ_AUTH = {};\n';
single = single.replace(
  /<script src="js\/auth\.local\.js\?v=[^"]+"><\/script>/,
  '<script nonce="' + nonce + '">\n' + authCode + '\n</script>'
);

/* логотип — data:URI */
const logoUri = 'data:image/svg+xml;base64,' + Buffer.from(logoSvg, 'utf8').toString('base64');
single = single.split('assets/logo.svg').join(logoUri);

/* скрипты — внутрь, с nonce (CSP остаётся строгим) */
for (const s of scripts) {
  const re = new RegExp('<script src="' + s.file.replace(/[/.]/g, '\\$&') + '\\?v=[^"]+"><\\/script>');
  const safe = s.code.replace(/<\/script/gi, '<\\/script');
  if (!re.test(single)) { console.error('не найден тег скрипта: ' + s.file); process.exit(1); }
  single = single.replace(re, '<script nonce="' + nonce + '">\n' + safe + '\n</script>');
}

/* CSP: разрешаем инлайновые скрипты ТОЛЬКО с этим nonce */
single = single.replace(
  /content="default-src 'self' file:; script-src 'self' file:;/,
  'content="default-src \'self\' file:; script-src \'self\' file: \'nonce-' + nonce + '\';'
);

fs.writeFileSync(path.join(DIST, 'index.single.html'), single, 'utf8');

/* ---------- 3) архив ---------- */
const zip = path.join(ROOT, 'obzvon-site.zip');
try { fs.unlinkSync(zip); } catch (e) {}
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command',
    "Compress-Archive -Path '" + path.join(DIST, '*') + "' -DestinationPath '" + zip + "' -Force"], { stdio: 'pipe' });
} else {
  execFileSync('sh', ['-c', 'cd "' + DIST + '" && zip -rq "' + zip + '" .'], { stdio: 'pipe' });
}

const size = (f) => (fs.existsSync(f) ? (fs.statSync(f).size / 1024).toFixed(1) + ' КБ' : '—');
console.log('Сборка готова:');
console.log('  dist/                     — сайт файлами (' + Object.keys(scripts).length + ' модулей + css + assets)');
console.log('  dist/index.single.html    — всё в одном файле: ' + size(path.join(DIST, 'index.single.html')));
console.log('  obzvon-site.zip           — архив для загрузки: ' + size(zip));
console.log('  версия: ' + version.v);
console.log('\nКуда положить (любой вариант):');
console.log('  1) статический хостинг/панель — загрузить obzvon-site.zip и распаковать в корень сайта;');
console.log('  2) один файл — загрузить dist/index.single.html как index.html;');
console.log('  3) свой сервер (nginx/apache) — скопировать содержимое dist/ в корень сайта;');
console.log('  4) локально — cd dist && python -m http.server 8080');
console.log('\nВнешних зависимостей нет: ни CDN, ни шрифтов, ни аналитики — всё внутри.');
