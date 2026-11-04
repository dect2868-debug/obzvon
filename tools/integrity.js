/* ============================================================
   Отпечаток файлов ОБЗВОН v6.0

   Считает контрольную сумму критичных функций — ровно так же, как это
   делает браузер на странице (OBZ.fingerprint()). Результат кладётся
   в integrity.json и публикуется вместе с сайтом.

   Если на сервере кто-то изменит код (или соберётся не та версия) —
   опубликованный отпечаток перестанет совпадать, и система это увидит.

     node tools/integrity.js          — пересчитать и записать integrity.json
     node tools/integrity.js --check  — только проверить, что всё сходится
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'integrity.json');
const MODULES = ['js/fx.js', 'js/monitor.js', 'js/nav.js', 'js/live.js',
                 'js/archive.js', 'js/audit.js', 'js/stats.js', 'js/profiles.js', 'js/health.js', 'js/app.js'];

function fileHashes() {
  const out = {};
  MODULES.forEach((f) => {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) return;
    out[f] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
  });
  const css = path.join(ROOT, 'css', 'styles.css');
  if (fs.existsSync(css)) {
    out['css/styles.css'] = crypto.createHash('sha256').update(fs.readFileSync(css)).digest('hex').slice(0, 16);
  }
  return out;
}

async function liveFingerprint() {
  const { boot, sleep } = require('../tests/helpers');
  const t = boot();
  await sleep(300);
  const fp = t.win.OBZ ? t.win.OBZ.fingerprint() : '';
  t.close();
  return fp;
}

(async () => {
  const check = process.argv.includes('--check');
  const fp = await liveFingerprint();
  if (!fp) {
    console.error('не удалось посчитать отпечаток (страница не поднялась)');
    process.exit(1);
  }
  let v = '';
  try { v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).v; } catch (e) {}

  if (check) {
    if (!fs.existsSync(FILE)) {
      console.log('integrity.json отсутствует — отпечаток ещё не опубликован');
      process.exit(1);
    }
    const cur = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const ok = cur.fingerprint === fp;
    console.log(ok
      ? 'отпечаток сходится (v' + (cur.v || '?') + ')'
      : 'ОТПЕЧАТОК НЕ СХОДИТСЯ: опубликован ' + String(cur.fingerprint).slice(0, 16) +
        ', текущий ' + fp.slice(0, 16));
    process.exit(ok ? 0 : 1);
  }

  const data = {
    app: 'obzvon-integrity',
    v: v,
    at: new Date().toISOString(),
    fingerprint: fp,
    files: fileHashes()
  };
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('integrity.json записан: отпечаток ' + fp.slice(0, 16) + ' · версия ' + v);
})();
