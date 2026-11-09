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
const health = read('js/health.js');

/* текущая версия — из version.json (источник истины) */
const V = version.v;

const s = suite('SMOKE (статика и синхронизация версии)');

s.test('version.json содержит текущую версию', () => {
  assert(/^\d+\.\d+$/.test(V), 'версия должна быть вида X.Y: ' + V);
});

s.test('CONFIG.appVersion в app.js совпадает с version.json', () => {
  const m = app.match(/appVersion:\s*'([^']+)'/);
  assert(m, 'в app.js нет appVersion');
  eq(m[1], V, 'appVersion');
});

s.test('отчёт монитора помечен актуальной версией', () => {
  assert(monitor.includes("version: 'OBZVON-" + V + "'"), 'в monitor.js нет OBZVON-' + V);
});

s.test('в index.html все ?v= указывают на текущую версию', () => {
  const vers = html.match(/\?v=[\d.]+/g) || [];
  assert(vers.length >= 8, 'ожидалось минимум 8 ссылок с версией, найдено ' + vers.length);
  const bad = vers.filter((v) => v !== '?v=' + V);
  eq(bad.length, 0, 'устаревшие версии в ссылках: ' + bad.join(', '));
});

s.test('шапка сайта показывает актуальную версию', () => {
  assert(html.includes('ВЕРСИЯ ' + V), 'в разметке нет «ВЕРСИЯ ' + V + '»');
  assert(/id="verBadge"/.test(html), 'нет метки версии verBadge');
});

s.test('новые файлы подключены (live.js, archive.js, health.js, moder.js)', () => {
  ['js/live.js', 'js/archive.js', 'js/health.js', 'js/moder.js'].forEach((f) => {
    assert(html.includes(f + '?v=' + V), f + ' не подключён');
    assert(fs.existsSync(path.join(ROOT, f)), 'нет файла ' + f);
  });
});

s.test('README описывает текущую версию', () => {
  assert(new RegExp('# ОБЗВОН v' + V.replace(/\./g, '\\.')).test(readme), 'заголовок README не обновлён');
  assert(/жив/i.test(readme), 'в README нет описания живого графика');
  assert(/истори/i.test(readme), 'в README нет описания истории обзвонов');
  assert(/обслуживан/i.test(readme), 'в README нет описания самообслуживания');
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
  ['archive', 'health'].forEach((v) => assert(links.includes(v), 'нет пункта меню ' + v));
});

s.test('элементы живой динамики, истории и обслуживания присутствуют', () => {
  ['liveChart', 'liveSummary', 'livePanel', 'liveNow', 'liveBadge', 'liveTicker',
   'archCards', 'archChart', 'archCompare', 'archTable', 'archCount', 'btnArchCsv', 'btnArchClear',
   'healthGrid', 'healthScore', 'healthRepair', 'healthLog',
   'btnHealthCheck', 'btnHealthRepair', 'btnHealthReport', 'btnHealthClear'
  ].forEach((id) => {
    assert(new RegExp('id="' + id + '"').test(html), 'нет элемента #' + id);
  });
});

s.test('баннер обновления присутствует', () => {
  ['updBanner', 'updTitle', 'updSub', 'updCount', 'btnUpdateNow', 'btnUpdateLater', 'btnUpdate']
    .forEach((id) => assert(new RegExp('id="' + id + '"').test(html), 'нет элемента #' + id));
});

s.test('страница «Новости» содержит запись текущей версии', () => {
  assert(html.includes('<div class="news-ver">v' + V + '</div>'), 'нет записи v' + V + ' в новостях');
  const first = html.match(/news-ver">v([\d.]+)</);
  eq(first && first[1], V, 'самая свежая запись в новостях');
});

s.test('CSP-мета присутствует (защита от внедрения)', () => {
  assert(/http-equiv="Content-Security-Policy"/.test(html), 'нет CSP');
  assert(/default-src 'self'/.test(html), 'CSP слишком слабый');
});

s.test('в рабочем коде нет отладочных console.log', () => {
  ['js/app.js', 'js/monitor.js', 'js/nav.js', 'js/fx.js', 'js/live.js', 'js/archive.js', 'js/health.js']
    .forEach((f) => {
      const code = read(f);
      const n = (code.match(/console\.log/g) || []).length;
      eq(n, 0, f + ': найдено console.log (' + n + ')');
    });
});

s.test('заголовки файлов помечены версией', () => {
  [live, archive, health, app, monitor, nav].forEach((code) => {
    assert(/ОБЗВОН v\d/.test(code), 'в заголовке нет пометки версии');
  });
});

s.test('модуль самопочинки умеет чинить (в коде есть repair)', () => {
  assert(/function repair/.test(health), 'в health.js нет функции repair');
  assert(/Monitor\.restart/.test(health) || /'monitor'/.test(health), 'в health.js нет починки монитора');
  assert(/Live\.repair/.test(health), 'в health.js нет починки графика');
  assert(/selfRepair/.test(app), 'в app.js нет OBZ.selfRepair');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
