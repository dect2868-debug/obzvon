/* ============================================================
   ОБЗВОН v7.2 :: СБОРКА EXCEL-ФАЙЛА ИЗ КОНСОЛИ

   node tools/excel-export.js [файл-экспорта.json] [-o выход.xlsx]

   Собирает настоящий .xlsx со всеми листами:
     Обзвоны        — сессии (из obzvon-all-*.json, если дадите)
     Профили        — участники с оценкой доверия
     Статистика     — счётчики посещений/обзвонов
     Конфигурация   — config.json + версия + статус автоподдержки
     Тревоги        — журнал надзора

   Если файл-экспорт не указан, листы обзвонов/профилей будут
   пустыми (только заголовки), а конфигурация — полной.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Excel = require(path.join(ROOT, 'js', 'excel.js'));

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8')); }
  catch (e) { return fallback; }
}

function fmtDate(ts) {
  const d = new Date(Number(ts) || 0);
  if (isNaN(d.getTime())) return '';
  const p = (x) => (x < 10 ? '0' : '') + x;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* ---------- аргументы ---------- */
const args = process.argv.slice(2);
let exportFile = '';
let outFile = path.join(ROOT, 'obzvon-excel-' + new Date().toISOString().slice(0, 10) + '.xlsx');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o' && args[i + 1]) { outFile = path.resolve(args[i + 1]); i++; }
  else if (!args[i].startsWith('-')) exportFile = args[i];
}

const version = readJson('version.json', { v: '?' });
const config = readJson('config.json', {});
const status = readJson('status.json', null);
const integrity = readJson('integrity.json', null);
let exp = null;
if (exportFile) {
  exp = readJson(exportFile, null);
  if (!exp) { console.error('не прочитать файл-экспорт: ' + exportFile); process.exit(1); }
}
const history = (exp && Array.isArray(exp.history)) ? exp.history : [];
const profiles = (exp && Array.isArray(exp.profiles)) ? exp.profiles : [];
const stats = (exp && exp.stats) ? exp.stats : null;
const threats = (exp && Array.isArray(exp.threats)) ? exp.threats : [];
const alarms = (exp && Array.isArray(exp.alarms)) ? exp.alarms : [];
const totals = (exp && exp.totals) ? exp.totals : {};

const sheets = [];

/* --- Обзвоны --- */
const rows1 = [['№', 'начало', 'завершение', 'длительность (сек)', 'вердикт',
  'концентрация %', 'читомеряк %', 'фокус %', 'реакция (мс)',
  'испытаний', 'верных', 'нарушений', 'отметки', 'устройство']];
history.forEach((r, i) => {
  rows1.push([i + 1, fmtDate(r.startedAt), fmtDate(r.endedAt),
    Number(r.duration) || 0, String(r.verdict || '—'),
    Number(r.conc) || 0, Number(r.cheat) || 0, Number(r.focus) || 0,
    (r.reaction === null || r.reaction === undefined) ? '—' : Number(r.reaction),
    Number(r.challenges) || 0, Number(r.ok) || 0, Number(r.viol) || 0,
    (Array.isArray(r.chips) ? r.chips.join(', ') : ''), String(r.device || '')]);
});
if (history.length > 1) {
  const sum = (k) => history.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  rows1.push(['ИТОГО', '', '', sum('duration'), '',
    Math.round(sum('conc') / history.length), Math.round(sum('cheat') / history.length),
    Math.round(sum('focus') / history.length), '', sum('challenges'), sum('ok'), sum('viol'), '', '']);
}
if (!history.length) rows1.push(['—', 'данных пока нет: откройте админку и нажмите «⬇ Excel»', '', '', '', '', '', '', '', '', '', '', '', '']);
sheets.push({ name: 'Обзвоны', rows: rows1 });

/* --- Профили --- */
const rows2 = [['ID устройства', 'первый раз', 'последний раз', 'обзвонов',
  'средняя концентрация %', 'реакция (мс)', 'нарушений', 'доверие', 'оценка']];
profiles.forEach((p) => {
  rows2.push([String(p.id || ''), fmtDate(p.firstAt), fmtDate(p.lastAt),
    Number(p.calls) || 0, Number(p.conc) || 0,
    (p.reaction === null || p.reaction === undefined) ? '—' : Number(p.reaction),
    Number(p.viol) || 0, Number(p.trust) || 0, String(p.trustLabel || '')]);
});
if (!profiles.length) rows2.push(['—', '', '', 0, 0, '', 0, 0, 'нет данных']);
sheets.push({ name: 'Профили', rows: rows2 });

/* --- Статистика --- */
const rows3 = [['показатель', 'значение', 'комментарий']];
if (stats && stats.counters) {
  rows3.push(['заходов на сайт', stats.counters.visits, 'в этом браузере']);
  rows3.push(['калибровок начато', stats.counters.calibrations, '']);
  rows3.push(['калибровок пройдено', stats.counters.calibPassed, '']);
  rows3.push(['обзвонов начато', stats.counters.sessions, '']);
  rows3.push(['обзвонов завершено', stats.counters.finished, '']);
  rows3.push(['разных участников', stats.people, 'анонимные id устройств']);
  rows3.push(['первый заход', fmtDate(stats.counters.firstVisit), '']);
  rows3.push(['последний заход', fmtDate(stats.counters.lastVisit), '']);
  rows3.push(['сборщик статистики', stats.collector || 'выключен',
    stats.collector ? 'сводка по всем устройствам' : 'данные только в этом браузере']);
} else {
  rows3.push(['данные статистики', 'нет', 'экспортируйте «⬇ Все данные» из админки и передайте файл сюда']);
}
rows3.push(['всего обзвонов (итоги)', Number(totals.sessions) || 0, '']);
rows3.push(['средний балл', Number(totals.avg) || 0, '']);
sheets.push({ name: 'Статистика', rows: rows3 });

/* --- Конфигурация --- */
const rows4 = [['раздел', 'параметр', 'значение']];
function flatCfg(prefix, obj) {
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatCfg(key, v);
    else if (Array.isArray(v)) rows4.push([prefix || 'корень', k, v.length ? v.join(', ') : 'пусто']);
    else if (typeof v !== 'string' || v.length < 200) rows4.push([prefix || 'корень', key, v === '' ? 'пусто' : String(v)]);
    else rows4.push([prefix || 'корень', key, String(v).slice(0, 197) + '…']);
  });
}
flatCfg('', config);
rows4.push(['система', 'версия', String(version.v)]);
rows4.push(['система', 'отпечаток целостности', integrity ? String(integrity.fingerprint || integrity.sha256 || '') : '—']);
if (status) {
  rows4.push(['автоподдержка', 'статус', String(status.status || '')]);
  rows4.push(['автоподдержка', 'последняя сборка', fmtDate(status.at)]);
}
sheets.push({ name: 'Конфигурация', rows: rows4 });

/* --- Тревоги --- */
const rows5 = [['когда', 'тип', 'описание']];
alarms.slice(0, 50).forEach((a) => rows5.push([fmtDate(a.at || a.t), 'тревога', String(a.text || a.kind || a.detail || '')]));
threats.slice(0, 50).forEach((t) => rows5.push([fmtDate(t.at || t.t), 'нарушение', String(t.text || t.kind || t.detail || '')]));
if (rows5.length === 1) rows5.push(['—', '—', 'событий нет']);
sheets.push({ name: 'Тревоги', rows: rows5 });

const bytes = Excel.build(sheets);
fs.writeFileSync(outFile, Buffer.from(bytes));
console.log('Файл готов: ' + outFile);
console.log('  листов: ' + sheets.length + ' (' + sheets.map((s) => s.name).join(', ') + ')');
console.log('  размер: ' + (bytes.length / 1024).toFixed(1) + ' КБ');
if (!history.length) {
  console.log('\nЛисты «Обзвоны»/«Профили» пусты: реальные данные живут в браузере.');
  console.log('Чтобы собрать их: админка → «⬇ Excel (.xlsx)» — файл скачается сразу.');
}
