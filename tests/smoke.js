/* ============================================================
   Smoke-тесты ОБЗВОНА: статические проверки разметки,
   синхронизации версии и целостности структуры страницы.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { suite, assert, eq, ROOT } = require('./helpers');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const app = read('js/app.js');
const monitor = read('js/monitor.js');
const version = JSON.parse(read('version.json'));
const readme = read('README.md');
const nav = read('js/nav.js');
const live = read('js/live.js');
const archive = read('js/archive.js');

const s = suite('SMOKE (статика и синхронизация версии)');

s.test('version.json содержит версию 4.0', () => {
  eq(version.v, '4.0', 'version.json');
});

s.test('CONFIG.appVersion в app.js = 4.0', () => {
  assert(/appVersion:\s*'4\.0'/.test(app), 'в app.js нет appVersion 4.0');
});

s.test('отчёт монитора помечен как OBZVON-4.0', () => {
  assert(/version:\s*'OBZVON-4\.0'/.test(monitor), 'в monitor.js нет OBZVON-4.0');
});

s.test('в index.html все ?v= указывают на 4.0', () => {
  const vers = html.match(/\?v=[\d.]+/g) || [];
  assert(vers.length >= 7, 'ожидалось минимум 7 ссылок с версией, найдено ' + vers.length);
  const bad = vers.filter((v) => v !== '?v=4.0');
  eq(bad.length, 0, 'устаревшие версии в ссылках: ' + bad.join(', '));
  assert(!/\?v=3\.8/.test(html), 'осталась ссылка на 3.8');
});

s.test('шапка сайта показывает ВЕРСИЯ 4.0', () => {
  assert(/ВЕРСИЯ 4\.0/.test(html), 'в разметке нет «ВЕРСИЯ 4.0»');
  assert(/id="verBadge"/.test(html), 'нет метки версии verBadge');
});

s.test('новые файлы v4.0 подключены (live.js, archive.js)', () => {
  assert(/js\/live\.js\?v=4\.0/.test(html), 'live.js не подключён');
  assert(/js\/archive\.js\?v=4\.0/.test(html), 'archive.js не подключён');
  assert(fs.existsSync(path.join(ROOT, 'js/live.js')), 'нет файла js/live.js');
  assert(fs.existsSync(path.join(ROOT, 'js/archive.js')), 'нет файла js/archive.js');
});

s.test('README описывает версию 4.0', () => {
  assert(/# ОБЗВОН v4\.0/.test(readme), 'заголовок README не обновлён');
  assert(/жив/i.test(readme), 'в README нет описания живого графика');
  assert(/истори/i.test(readme), 'в README нет описания истории обзвонов');
});

s.test('все id из списка els существуют в разметке', () => {
  const m = app.match(/\['sessionId'[\s\S]*?\]\s*\n\s*\.forEach/);
  assert(m, 'не найден список элементов');
  const ids = (m[0].match(/'([A-Za-z0-9_-]+)'/g) || []).map((s2) => s2.replace(/'/g, ''));
  const missing = ids.filter((id) => !new RegExp('id="' + id + '"').test(html));
  eq(missing.length, 0, 'отсутствуют элементы: ' + missing.join(', '));
});

s.test('все пункты меню имеют свою страницу и наоборот', () => {
  const links = [...html.matchAll(/data-view="([a-z]+)"/g)].map((x) => x[1]);
  const views = [...html.matchAll(/id="view-([a-z]+)"/g)].map((x) => x[1]);
  links.forEach((v) => assert(views.includes(v), 'нет страницы для пункта меню ' + v));
  views.forEach((v) => assert(links.includes(v), 'страница ' + v + ' не выведена в меню'));
  assert(links.includes('archive'), 'нет пункта меню «История»');
});

s.test('элементы живого графика и истории присутствуют', () => {
  ['liveChart', 'liveSummary', 'livePanel', 'archCards', 'archChart', 'archCompare',
   'archTable', 'archCount', 'btnArchCsv', 'btnArchClear'].forEach((id) => {
    assert(new RegExp('id="' + id + '"').test(html), 'нет элемента #' + id);
  });
});

s.test('баннер обновления присутствует', () => {
  ['updBanner', 'updTitle', 'updSub', 'updCount', 'btnUpdateNow', 'btnUpdateLater', 'btnUpdate']
    .forEach((id) => assert(new RegExp('id="' + id + '"').test(html), 'нет элемента #' + id));
});

s.test('страница «Новости» содержит запись v4.0', () => {
  assert(/<div class="news-ver">v4\.0<\/div>/.test(html), 'нет записи v4.0 в новостях');
  const first = html.match(/news-ver">v([\d.]+)</);
  eq(first && first[1], '4.0', 'самая свежая запись в новостях');
});

s.test('CSP-мета присутствует (защита от внедрения)', () => {
  assert(/http-equiv="Content-Security-Policy"/.test(html), 'нет CSP');
  assert(/frame-ancestors/.test(html) || /default-src 'self'/.test(html), 'CSP слишком слабый');
});

s.test('в рабочем коде нет отладочных console.log', () => {
  ['js/app.js', 'js/monitor.js', 'js/nav.js', 'js/fx.js', 'js/live.js', 'js/archive.js']
    .forEach((f) => {
      const code = read(f);
      const n = (code.match(/console\.log/g) || []).length;
      eq(n, 0, f + ': найдено console.log (' + n + ')');
    });
});

s.test('заголовки файлов помечены версией 4.0', () => {
  assert(/ОБЗВОН v4\.0/.test(live), 'заголовок live.js');
  assert(/ОБЗВОН v4\.0/.test(archive), 'заголовок archive.js');
  assert(/ОБЗВОН v4\.0/.test(app), 'заголовок app.js');
  assert(/ОБЗВОН v4\.0/.test(monitor), 'заголовок monitor.js');
  assert(/ОБЗВОН v4\.0/.test(nav), 'заголовок nav.js');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
