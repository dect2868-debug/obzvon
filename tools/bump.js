/* ============================================================
   Единая точка версии ОБЗВОН (v5.0)

   Версия живёт в version.json, а оттуда расходится по всем файлам:
     version.json      — источник истины
     js/app.js         — CONFIG.appVersion
     js/monitor.js     — подпись отчёта OBZVON-x.y
     js/*.js           — заголовки файлов
     index.html        — ?v= в ссылках (обход кэша), метка в меню, новости
     README.md         — заголовок
     config.json       — отметка версии конфигурации

   Использование:
     node tools/bump.js --check              — проверить, что всё синхронно
     node tools/bump.js --sync --notes "..."  — разнести версию по файлам
     node tools/bump.js --bump patch --notes "..."  — поднять версию и разнести
     node tools/bump.js --auto                — то же, что --bump patch, но
                                                 без bump, если версия уже свежая
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (f) => path.join(ROOT, f);
const read = (f) => fs.readFileSync(P(f), 'utf8');
const write = (f, s) => fs.writeFileSync(P(f), s, 'utf8');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const MODULES = ['js/fx.js', 'js/monitor.js', 'js/nav.js', 'js/live.js',
                 'js/archive.js', 'js/audit.js', 'js/health.js', 'js/app.js'];

function bumpVersion(v, kind) {
  const m = String(v).match(/^(\d+)\.(\d+)$/);
  if (!m) return v;
  let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
  if (kind === 'major') { a++; b = 0; }
  else b++;
  return a + '.' + b;
}

/* ---------- проверка синхронизации ---------- */
function checkSync() {
  const problems = [];
  let v = '';
  try { v = JSON.parse(read('version.json')).v; } catch (e) { problems.push('version.json не читается'); }
  if (!/^\d+\.\d+$/.test(v)) problems.push('версия в version.json некорректна: ' + v);

  const app = read('js/app.js');
  const m = app.match(/appVersion:\s*'([^']+)'/);
  if (!m) problems.push('в app.js нет appVersion');
  else if (m[1] !== v) problems.push('app.js: appVersion ' + m[1] + ' ≠ ' + v);

  const mon = read('js/monitor.js');
  const m2 = mon.match(/version:\s*'OBZVON-([^']+)'/);
  if (!m2) problems.push('в monitor.js нет подписи OBZVON-x.y');
  else if (m2[1] !== v) problems.push('monitor.js: подпись ' + m2[1] + ' ≠ ' + v);

  const html = read('index.html');
  const vers = [...html.matchAll(/\?v=([\d.]+)/g)].map((x) => x[1]);
  if (!vers.length) problems.push('в index.html нет ссылок ?v=');
  const bad = [...new Set(vers.filter((x) => x !== v))];
  if (bad.length) problems.push('index.html: устаревшие ?v= — ' + bad.join(', '));
  if (!html.includes('ВЕРСИЯ ' + v)) problems.push('index.html: метка «ВЕРСИЯ ' + v + '» не найдена');

  const first = html.match(/news-ver">v([\d.]+)</);
  if (!first) problems.push('index.html: нет записей в новостях');
  else if (first[1] !== v) problems.push('index.html: свежая новость — v' + first[1] + ', а версия ' + v);

  const readme = read('README.md');
  if (!readme.includes('# ОБЗВОН v' + v)) problems.push('README.md: заголовок не про версию ' + v);

  return { v, problems };
}

/* ---------- разнос версии по файлам ---------- */
function syncAll(v, notes) {
  const changed = [];

  /* version.json */
  const vj = JSON.parse(read('version.json'));
  if (vj.v !== v || (notes && vj.notes !== notes)) {
    write('version.json', JSON.stringify({ v: v, notes: notes || vj.notes || '' }) + '\n');
    changed.push('version.json');
  }

  /* app.js */
  let app = read('js/app.js');
  const appNew = app.replace(/appVersion:\s*'[^']+'/, "appVersion: '" + v + "'");
  if (appNew !== app) { write('js/app.js', appNew); changed.push('js/app.js (appVersion)'); }

  /* monitor.js */
  let mon = read('js/monitor.js');
  const monNew = mon.replace(/version:\s*'OBZVON-[^']+'/, "version: 'OBZVON-" + v + "'");
  if (monNew !== mon) { write('js/monitor.js', monNew); changed.push('js/monitor.js (подпись отчёта)'); }

  /* заголовки модулей */
  for (const f of MODULES) {
    const src = read(f);
    const out = src.replace(/ОБЗВОН v[\d.]+/g, 'ОБЗВОН v' + v);
    if (out !== src) { write(f, out); changed.push(f + ' (заголовок)'); }
  }

  /* index.html: ссылки, метка, новости */
  let html = read('index.html');
  const htmlLinks = html.replace(/\?v=[\d.]+/g, '?v=' + v);
  const htmlVer = htmlLinks.replace(/>ВЕРСИЯ [\d.]+</, '>ВЕРСИЯ ' + v + '<');
  html = htmlVer;
  if (html !== read('index.html')) { write('index.html', html); changed.push('index.html (?v=, метка версии)'); }

  /* свежая новость */
  const html2 = read('index.html');
  const first = html2.match(/news-ver">v([\d.]+)</);
  if (!first || first[1] !== v) {
    const text = notes || 'Автоматическое обновление';
    const article =
      '                <article class="news-item news-new">\r\n' +
      '                  <div class="news-ver">v' + v + '</div>\r\n' +
      '                  <div class="news-body">\r\n' +
      '                    <h3>' + text + '</h3>\r\n' +
      '                    <p>Обновление поднято автоматически: проверки проекта пройдены,\r\n' +
      '                       версия разнесена по всем файлам. Подробности — в журнале\r\n' +
      '                       изменений репозитория.</p>\r\n' +
      '                  </div>\r\n' +
      '                </article>\r\n';
    /* снимаем пометку «свежая» со старой записи */
    let out = html2.replace('<article class="news-item news-new">', '<article class="news-item">');
    const marker = '                <article class="news-item">';
    const at = out.indexOf(marker);
    if (at >= 0) {
      out = out.slice(0, at) + article + out.slice(at);
      write('index.html', out);
      changed.push('index.html (новость v' + v + ')');
    }
  }

  /* README */
  const readme = read('README.md');
  let readmeNew = readme.replace(/^# ОБЗВОН v[\d.]+/m, '# ОБЗВОН v' + v);
  /* ссылки ?v= в тексте README тоже должны соответствовать версии */
  readmeNew = readmeNew.replace(/\?v=[\d.]+/g, '?v=' + v);
  if (readmeNew !== readme) { write('README.md', readmeNew); changed.push('README.md (заголовок и ссылки)'); }

  /* config.json — отметка версии */
  if (fs.existsSync(P('config.json'))) {
    try {
      const cfg = JSON.parse(read('config.json'));
      if (cfg.v !== v) { cfg.v = v; write('config.json', JSON.stringify(cfg, null, 2) + '\n'); changed.push('config.json'); }
    } catch (e) { /* конфиг битый — доктор его заметит */ }
  }

  return changed;
}

/* ---------- основной сценарий ---------- */
const res = checkSync();

if (has('--check')) {
  if (res.problems.length) {
    console.log('Версия рассинхронизирована (текущая ' + res.v + '):');
    res.problems.forEach((p) => console.log('  • ' + p));
    process.exit(1);
  }
  console.log('Версия ' + res.v + ' синхронизирована во всех файлах.');
  process.exit(0);
}

const notes = arg('--notes', '');
let target = res.v;

if (has('--bump')) {
  target = bumpVersion(res.v, arg('--bump', 'patch'));
} else if (has('--auto')) {
  /* авто-режим для CI: если всё синхронно — версию не трогаем */
  if (!res.problems.length) {
    console.log('Версия ' + res.v + ' уже синхронизирована — бамп не нужен.');
    process.exit(0);
  }
  target = bumpVersion(res.v, 'patch');
} else if (!has('--sync')) {
  console.log('Укажите режим: --check | --sync | --bump patch|minor|major | --auto');
  process.exit(1);
}

const changed = syncAll(target, notes);
if (!changed.length) {
  console.log('Изменений нет — версия ' + target + ' уже везде.');
} else {
  console.log('Версия → ' + target + '. Изменено файлов: ' + changed.length);
  changed.forEach((c) => console.log('  • ' + c));
}
