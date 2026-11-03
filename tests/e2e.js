/* ============================================================
   E2E-тесты ОБЗВОНА: полный сценарий в jsdom —
   калибровка, испытания, сессия, итоги, живой график,
   история, сортировка таблиц, экспорт/импорт, обновление.
   ============================================================ */
'use strict';

const { boot, suite, assert, eq, sleep } = require('./helpers');

const s = suite('E2E (сценарии работы системы)');

/* ---------- помощники ввода ---------- */

function key(win, code, opts = {}) {
  const ev = new win.KeyboardEvent('keydown', {
    code, key: opts.key || code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift,
    metaKey: !!opts.meta, bubbles: true, cancelable: true
  });
  win.document.dispatchEvent(ev);
  return ev;
}
function keyUp(win, code, opts = {}) {
  const ev = new win.KeyboardEvent('keyup', {
    code, key: opts.key || code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift,
    bubbles: true, cancelable: true
  });
  win.document.dispatchEvent(ev);
}

/* отвечает на текущее испытание так, как это сделал бы участник */
async function answerChallenge(win) {
  const task = win.document.getElementById('chTask');
  const text = task.textContent || '';
  const html = task.innerHTML || '';

  if (/КЛИКНИТЕ ПО\s*ЦЕЛИ/.test(text)) {
    const t = win.document.getElementById('chTarget');
    if (!t.hidden) { t.click(); return 'target'; }
  }
  if (/ДЕРЖИТЕ/.test(text) || /УДЕРЖИВАЙТЕ/.test(text)) {
    key(win, 'Space');
    await sleep(3400);
    keyUp(win, 'Space');
    return 'hold';
  }
  if (/СКОЛЬКО БУДЕТ/.test(text)) {
    const m = html.match(/<b>([^<]+)<\/b>/);
    if (m) {
      const expr = m[1].replace(/−/g, '-').replace(/\s/g, '');
      const mm = expr.match(/^(\d+)([+-])(\d+)$/);
      if (mm) {
        const a = +mm[1], b = +mm[3];
        const res = mm[2] === '+' ? a + b : Math.max(a, b) - Math.min(a, b);
        String(res).split('').forEach((d) => key(win, 'Digit' + d, { key: d }));
        return 'math';
      }
    }
  }
  if (/ЗАПОМНИТЕ/.test(text)) {
    const m = html.match(/<b class="big">([^<]+)<\/b>/);
    if (m) {
      const seq = m[1].replace(/\s/g, '');
      await sleep(1400);                       /* ждём, пока символы скроются */
      for (const ch of seq) key(win, 'Key' + ch, { key: ch });
      return 'seq';
    }
  }
  if (/ВВЕДИТЕ ПОСЛЕДОВАТЕЛЬНОСТЬ/.test(text)) {
    const m = html.match(/<b class="big">([\s\S]*?)<\/b>/);
    if (m) {
      const rest = (m[1].match(/<span class="dim2">([^<]*)<\/span>/) || [, ''])[1] || '';
      const seq = rest.replace(/\s/g, '');
      for (const ch of seq) key(win, 'Key' + ch, { key: ch });
      return 'seq2';
    }
  }
  if (/НАЖМИТЕ КЛАВИШУ/.test(text)) {
    const m = html.match(/<b>([^<]+)<\/b>/);
    if (m) {
      const ch = m[1].trim();
      key(win, /[A-Z]/.test(ch) ? 'Key' + ch : 'Digit' + ch, { key: ch });
      return 'key';
    }
  }
  if (/КЛИКНИТЕ ПО ЦВЕТУ/.test(text)) {
    const word = win.document.querySelector('.stroop-word');
    const ink = word ? word.style.color : '';
    const btns = Array.from(win.document.querySelectorAll('#stroopRow .ch-btn'));
    const hit = btns.find((b) => b.style.background === ink);
    if (hit) { hit.click(); return 'stroop'; }
  }
  return null;
}

/* быстрый проход калибровки «пяти кликами по логотипу» */
function fastCalibrate(win) {
  const logo = win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
}

async function auth(win, pass) {
  win.document.getElementById('passInput').value = pass;
  win.document.getElementById('btnAuth').click();
  await sleep(30);
}

/* ============================================================ */

s.test('страница загружается без ошибок скриптов', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(120);
  eq(t.errors.length, 0, 'ошибки в консоли: ' + t.errors.join(' | '));
  eq(t.win.OBZ.v, '4.0', 'версия в OBZ');
  t.close();
});

s.test('неверный код куратора не пускает в пульт', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'wrong-code');
  eq(t.el('ctrlRow').hidden, true, 'панель управления открылась при неверном коде');
  eq(t.el('authRow').hidden, false, 'поле ввода скрыто');
  t.close();
});

s.test('верный код открывает пульт куратора', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  eq(t.el('ctrlRow').hidden, false, 'панель управления не открылась');
  eq(t.el('authRow').hidden, true, 'поле ввода не скрыто');
  t.close();
});

s.test('калибровка запускает испытание и ответ засчитывается', async () => {
  const t = boot({ pass: 'test-pass' });
  t.el('btnCalibrate').click();
  await sleep(60);
  eq(t.el('playfield').hidden, false, 'арена не показана');
  assert((t.el('chTask').textContent || '').length > 0, 'задание пустое');
  const kind = await answerChallenge(t.win);
  assert(kind, 'не удалось определить вид испытания: ' + t.el('chTask').textContent);
  await sleep(120);
  const rows = t.$$('#chTableBody tr');
  assert(rows.length >= 1, 'в журнале испытаний нет записей');
  t.close();
});

s.test('сессия: ID, водяной знак, метрики и живой график', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(80);

  assert(/сессия OBZ-/.test(t.el('sessionId').textContent), 'нет ID сессии: ' + t.el('sessionId').textContent);
  eq(t.el('wmLayer').classList.contains('on'), true, 'водяной знак не показан');
  assert(t.el('wmLayer').textContent.indexOf('OBZ-') >= 0, 'в водяном знаке нет ID сессии');
  eq(t.el('gate').hidden, true, 'гейт не скрыт');
  eq(t.el('playfield').hidden, false, 'арена не показана');

  /* живой график набирает точки */
  t.win.Live.sample(92, 4);
  t.win.Live.sample(88, 9);
  await sleep(30);
  const st = t.win.Live.stats();
  eq(st.n >= 2, true, 'график не набрал замеры');
  eq(st.avg, 90, 'средняя по графику');
  eq(st.peakCheat, 9, 'пик читомеряка');
  assert(/средняя/.test(t.el('liveSummary').textContent), 'нет сводки под графиком');

  /* живой график рисуется на canvas без ошибок */
  eq(t.errors.length, 0, 'ошибки при отрисовке графика: ' + t.errors.join(' | '));

  t.close();
});

s.test('завершение обзвона: вердикт, итоги и запись в историю', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(80);
  t.el('btnEnd').click();
  await sleep(120);

  eq(t.el('sumOverlay').hidden, false, 'итоги не показаны');
  const verdict = t.el('sumVerdict').textContent;
  assert(['ЗАЧЁТ', 'СОМНИТЕЛЬНО', 'НЕЗАЧЁТ'].indexOf(verdict) >= 0, 'неверный вердикт: ' + verdict);
  assert(/v4\.0/.test(t.el('sumTable').textContent), 'в итогах нет версии системы');

  const hist = t.win.Archive.list();
  eq(hist.length, 1, 'в истории не одна запись');
  eq(hist[0].verdict, verdict, 'вердикт в истории не совпадает');
  assert(hist[0].id && hist[0].id.indexOf('OBZ-') === 0, 'нет ID обзвона в истории');

  /* страница истории отрисована */
  t.win.Archive.render();
  assert(t.$$('#archTable tbody tr').length === 1, 'таблица истории пуста');
  assert(/СРАВНЕНИЕ/.test(t.el('archCompare').textContent), 'нет блока сравнения');
  t.close();
});

s.test('сортировка таблицы результатов по клику на заголовок', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(80);
  t.el('btnEnd').click();
  await sleep(120);

  const th = t.el('statTable').querySelector('th[data-sort="value"]');
  assert(th, 'нет сортируемого заголовка');
  th.click();
  await sleep(30);
  /* таблица перерисовывается — заголовок ищем заново */
  const th2 = t.el('statTable').querySelector('th[data-sort="value"]');
  assert(/sorted/.test(th2.className), 'заголовок не помечен как отсортированный: ' + th2.className);
  assert(/asc/.test(th2.className), 'нет направления asc');
  th2.click();
  await sleep(30);
  const th3 = t.el('statTable').querySelector('th[data-sort="value"]');
  assert(/desc/.test(th3.className), 'повторный клик не сменил направление');
  t.close();
});

s.test('экспорт статистики отдаёт валидный JSON', async () => {
  const t = boot({ pass: 'test-pass' });
  const blobs = [];
  t.win.Blob = function (parts, opts) { blobs.push({ parts, opts }); this.size = 0; };
  t.win.URL.createObjectURL = () => 'blob:mock';
  t.win.URL.revokeObjectURL = () => {};
  t.el('btnExportStats').click();
  await sleep(60);
  eq(blobs.length, 1, 'экспорт не создал файл');
  const data = JSON.parse(blobs[0].parts.join(''));
  eq(data.app, 'obzvon-stats', 'не тот формат экспорта');
  eq(data.v, '4.0', 'версия в экспорте');
  t.close();
});

s.test('импорт статистики восстанавливает данные', async () => {
  const t = boot({ pass: 'test-pass' });
  const payload = JSON.stringify({
    app: 'obzvon-stats', v: '4.0',
    totals: { sessions: 7, avg: 88, prevAvg: 80, hist: [70, 80, 88], last: 88, ach: { 'ЛЁД': 2 } }
  });
  t.win.FileReader = function () {
    this.onload = null; this.onerror = null; this.result = null;
    this.readAsText = function () {
      this.result = payload;
      if (this.onload) this.onload({ target: this });
    };
  };
  const file = { name: 'stats.json' };
  Object.defineProperty(t.el('importFile'), 'files', { value: [file], configurable: true, writable: true });
  t.el('importFile').dispatchEvent(new t.win.Event('change'));
  await sleep(80);
  const tot = JSON.parse(t.win.localStorage.getItem('obzvon_v2_totals'));
  eq(tot.sessions, 7, 'число обзвонов не восстановилось');
  eq(tot.avg, 88, 'средняя не восстановилась');
  eq(t.el('totalConc').textContent, '88%', 'средняя не показана в карточке');
  t.close();
});

s.test('меню переключает страницы, включая «Историю»', async () => {
  const t = boot({ pass: 'test-pass' });
  const link = t.win.document.querySelector('.nav-link[data-view="archive"]');
  assert(link, 'нет пункта меню «История»');
  link.click();
  await sleep(40);
  eq(t.el('view-archive').hidden, false, 'страница истории не открылась');
  eq(t.el('view-seance').hidden, true, 'страница сеанса не закрылась');
  assert(link.classList.contains('active'), 'активный пункт не подсвечен');
  t.close();
});

s.test('баннер обновления показывается и откладывается', async () => {
  const t = boot({ pass: 'test-pass', version: '4.1' });
  t.el('btnUpdate').click();          /* ручная проверка */
  await sleep(120);
  eq(t.el('updBanner').hidden, false, 'баннер обновления не показан');
  assert(/4\.1/.test(t.el('updTitle').textContent), 'в баннере нет новой версии');
  t.el('btnUpdateLater').click();
  await sleep(30);
  eq(t.el('updBanner').hidden, true, 'баннер не скрылся');
  t.close();
});

s.test('кнопка «Обновить сейчас» перезагружает страницу с новой версией', async () => {
  const t = boot({ pass: 'test-pass', version: '4.1' });
  t.el('btnUpdate').click();
  await sleep(120);
  t.el('btnUpdateNow').click();
  await sleep(60);
  const url = t.win.__obzLastNav || '';
  assert(url, 'переход не выполнен');
  assert(/obzupd=4\.1/.test(url), 'неверный адрес перехода: ' + url);
  t.close();
});

s.test('экспорт истории в CSV содержит заголовок и строки', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(60);
  t.el('btnEnd').click();
  await sleep(120);
  const csv = t.win.Archive.csv();
  assert(/Дата/.test(csv), 'нет заголовка CSV');
  assert(csv.split('\r\n').length >= 2, 'нет строк с данными');
  t.close();
});

s.test('очистка истории работает', async () => {
  const t = boot({ pass: 'test-pass' });
  await auth(t.win, 'test-pass');
  fastCalibrate(t.win);
  await sleep(30);
  t.el('btnStart').click();
  await sleep(60);
  t.el('btnEnd').click();
  await sleep(120);
  eq(t.win.Archive.list().length, 1, 'запись не создалась');
  t.win.Archive.clear();
  eq(t.win.Archive.list().length, 0, 'история не очистилась');
  t.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
