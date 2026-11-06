/* ============================================================
   Тесты v7.2: выгрузка в Excel (.xlsx)

   Проверяем не «кнопка нажалась», а то, что получается настоящий
   файл Excel: валидный ZIP, нужные XML-части, корректные данные
   на листах (обзвоны, профили, статистика, конфигурация).
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT, loginAndCalibrate } = require('./helpers');

const ADMIN_PASS = 'admin-test-pass';
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const s = suite('V7.2 (Excel-выгрузка)');

/* ---------- разбор ZIP (свой, минималистичный) ---------- */
function unzip(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    const sig = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
    if (sig === 0x06054b50) { eocd = i; break; }
  }
  assert(eocd >= 0, 'нет конца центрального каталога — это не ZIP');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    assert(dv.getUint32(off, true) === 0x02014b50, 'повреждена центральная запись');
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = Buffer.from(bytes.subarray(off + 46, off + 46 + nameLen)).toString('utf8');
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    assert(method === 0, 'файл ' + name + ' сжат — тест ждёт хранение');
    files[name] = bytes.subarray(dataStart, dataStart + csize);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const txt = (bytes) => Buffer.from(bytes).toString('utf8');

/* ---------- контекст: архив обзвонов и профиль участника ---------- */
function seedStorage() {
  const now = Date.now();
  const history = JSON.stringify([
    { id: 'S1', startedAt: now - 500000, endedAt: now - 400000, duration: 100, conc: 88, cheat: 4, focus: 90, reaction: 420, verdict: 'ЗАЧЁТ', challenges: 6, ok: 5, viol: 1, chips: ['цель'], device: 'тест' },
    { id: 'S2', startedAt: now - 300000, endedAt: now - 200000, duration: 90, conc: 55, cheat: 30, focus: 60, reaction: 700, verdict: 'НЕЗАЧЁТ', challenges: 6, ok: 3, viol: 4, chips: [], device: 'тест' }
  ]);
  const profiles = JSON.stringify({
    abc123: { id: 'abc123', firstAt: now - 900000, lastAt: now, calls: 3, concSum: 240, reactSum: 1400, reactN: 3, violSum: 2, calibPass: 1 }
  });
  return { obzvon_v2_history: history, obzvon_v2_profiles: profiles };
}

async function makeExport(t) {
  await loginAndCalibrate(t, undefined, ADMIN_PASS);
  t.win.URL.createObjectURL = () => 'blob:mock';
  t.win.URL.revokeObjectURL = () => {};
  let captured = null;
  const OrigBlob = t.win.Blob;
  t.win.Blob = function (parts, opts) {
    captured = { bytes: parts[0], type: (opts || {}).type };
    return new OrigBlob(parts, opts);
  };
  const ok = t.win.OBZ.exportExcel();
  return { ok, captured };
}

/* лист по имени → его XML (id листа берём из workbook.xml) */
function sheetByName(files, name) {
  const wb = txt(files['xl/workbook.xml']);
  const idx = wb.indexOf('name="' + name + '"');
  assert(idx >= 0, 'нет листа «' + name + '»');
  const m = /r:id="rId(\d+)"/.exec(wb.slice(idx));
  assert(m, 'у листа «' + name + '» нет r:id');
  return txt(files['xl/worksheets/sheet' + m[1] + '.xml']);
}

/* ============================================================ */

s.test('кнопка «Excel» есть в админке и подключена', () => {
  assert(/id="btnAdminExcel"/.test(html), 'кнопки нет в разметке');
  assert(/btnAdminExcel/.test(appCode), 'кнопка не привязана в app.js');
  assert(/js\/excel\.js/.test(html), 'модуль не подключён в разметке');
  const xl = fs.readFileSync(path.join(ROOT, 'js', 'excel.js'), 'utf8');
  assert(/window\.Excel\s*=\s*api/.test(xl), 'модуль excel.js не экспортируется');
  assert(/module\.exports\s*=\s*api/.test(xl), 'модуль не доступен в Node');
});

s.test('Excel.build собирает валидный ZIP с частями xlsx', () => {
  const Excel = require(path.join(ROOT, 'js', 'excel.js'));
  const bytes = Excel.build([{ name: 'Лист1', rows: [['а', 'б'], [1, 2]] }]);
  assert(bytes instanceof Uint8Array, 'build не вернул байты');
  const files = unzip(bytes);
  ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
    'xl/styles.xml', 'xl/worksheets/sheet1.xml'].forEach((f) =>
    assert(files[f], 'в архиве нет ' + f));
  const wb = txt(files['xl/workbook.xml']);
  assert(/sheet name="Лист1"/.test(wb), 'имя листа не записано');
  const sh = txt(files['xl/worksheets/sheet1.xml']);
  assert(/inlineStr/.test(sh) && /<t[^>]*>[аб]<\/t>/.test(sh), 'текстовые ячейки не записаны');
  assert(/<v>1<\/v>/.test(sh), 'числовая ячейка не записана');
});

s.test('несколько листов получают свои имена и файлы', () => {
  const Excel = require(path.join(ROOT, 'js', 'excel.js'));
  const bytes = Excel.build([
    { name: 'Обзвоны', rows: [['x']] },
    { name: 'Конфигурация', rows: [['y']] },
    { name: 'Обзвоны', rows: [['z']] }   /* дубликат — получит суффикс */
  ]);
  const files = unzip(bytes);
  const wb = txt(files['xl/workbook.xml']);
  assert(/name="Обзвоны"/.test(wb), 'нет листа Обзвоны');
  assert(/name="Конфигурация"/.test(wb), 'нет листа Конфигурация');
  assert((wb.match(/<sheet /g) || []).length === 3, 'не все листы попали в книгу');
  assert(files['xl/worksheets/sheet3.xml'], 'нет третьего листа');
});

s.test('имена листов с запрещёнными символами не ломают книгу', () => {
  const Excel = require(path.join(ROOT, 'js', 'excel.js'));
  const bytes = Excel.build([{ name: 'Плохое/имя[1]: "тест"', rows: [['v']] }]);
  const files = unzip(bytes);
  const wb = txt(files['xl/workbook.xml']);
  const name = wb.match(/name="([^"]*)"/)[1];
  assert(!/[\/\*\?:\[\]]/.test(name), 'запрещённый символ остался в имени: ' + name);
});

s.test('спецсимволы XML в данных не ломают файл', () => {
  const Excel = require(path.join(ROOT, 'js', 'excel.js'));
  const bytes = Excel.build([{ name: 'Л', rows: [['a<b>&"c"', 'x y']] }]);
  const files = unzip(bytes);
  const sh = txt(files['xl/worksheets/sheet1.xml']);
  assert(/&lt;|&amp;/.test(sh), 'спецсимволы не экранированы');
  assert(!/[\x00-\x08]/.test(sh), 'управляющие символы попали в XML');
});

s.test('выгрузка из админки создаёт файл .xlsx', async () => {
  const t = boot({ pass: 'test-pass', storage: seedStorage() });
  await sleep(200);
  const { ok, captured } = await makeExport(t);
  eq(ok, true, 'exportExcel вернул false');
  assert(captured, 'Blob не создан');
  assert(/spreadsheetml/.test(captured.type), 'не тот MIME-тип: ' + captured.type);
  const files = unzip(captured.bytes);
  assert(files['xl/workbook.xml'], 'в файле нет книги');
  t.close();
});

s.test('лист «Обзвоны» содержит все сессии и итоги', async () => {
  const t = boot({ pass: 'test-pass', storage: seedStorage() });
  await sleep(200);
  const { captured } = await makeExport(t);
  const files = unzip(captured.bytes);
  const sh = sheetByName(files, 'Обзвоны');
  assert(/ЗАЧЁТ/.test(sh), 'вердикт не попал в лист');
  assert(/НЕЗАЧЁТ/.test(sh), 'второй вердикт не попал');
  assert(/ИТОГО/.test(sh), 'нет итоговой строки');
  assert(/концентрация/.test(sh), 'нет заголовка колонки');
  t.close();
});

s.test('лист «Профили» содержит участников и оценку доверия', async () => {
  const t = boot({ pass: 'test-pass', storage: seedStorage() });
  await sleep(200);
  const { captured } = await makeExport(t);
  const files = unzip(captured.bytes);
  const sh = sheetByName(files, 'Профили');
  assert(/abc123/.test(sh), 'id профиля не попал');
  assert(/доверие/.test(sh), 'нет колонки доверия');
  t.close();
});

s.test('лист «Статистика» содержит счётчики посещений', async () => {
  const t = boot({ pass: 'test-pass', storage: seedStorage() });
  await sleep(200);
  const { captured } = await makeExport(t);
  const files = unzip(captured.bytes);
  const sh = sheetByName(files, 'Статистика');
  assert(/заходов на сайт/.test(sh), 'нет счётчика заходов');
  assert(/обзвонов завершено/.test(sh), 'нет счётчика обзвонов');
  t.close();
});

s.test('лист «Конфигурация» содержит действующие настройки', async () => {
  const cfg = {
    app: 'obzvon-config', v: '7.2', features: { autoUpdate: true, audit: true },
    policies: { maxAttempts: 5 }, threshold: 60, collect: { url: '' }
  };
  const t = boot({ pass: 'test-pass', config: cfg, storage: seedStorage() });
  await sleep(250);
  const { captured } = await makeExport(t);
  const files = unzip(captured.bytes);
  const sh = sheetByName(files, 'Конфигурация');
  assert(/maxAttempts/.test(sh), 'параметр политик не попал');
  assert(/threshold/.test(sh), 'порог не попал');
  assert(/features\.autoUpdate/.test(sh), 'флаги не попали');
  t.close();
});

s.test('выгрузка пишет событие в аудит', async () => {
  const t = boot({ pass: 'test-pass', storage: seedStorage() });
  await sleep(200);
  await makeExport(t);
  await sleep(40);
  const rep = t.win.OBZ.audit ? t.win.OBZ.audit() : null;
  assert(Array.isArray(rep), 'аудит недоступен');
  const evs = rep.map((e) => JSON.stringify(e)).join('');
  assert(/export\.excel/.test(evs), 'событие выгрузки не записано');
  t.close();
});

s.test('выгрузка пустых данных не падает', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(200);
  t.win.URL.createObjectURL = () => 'blob:mock';
  t.win.URL.revokeObjectURL = () => {};
  const ok = t.win.OBZ.exportExcel();
  eq(ok, true, 'выгрузка пустых данных упала');
  t.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
