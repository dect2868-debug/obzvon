/* ============================================================
   Тесты v7.1: офлайн-режим (PWA), быстрые действия, поиск по журналу,
   новости со ссылками на разделы.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT } = require('./helpers');

const ADMIN_PASS = 'admin-test-pass';
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const s = suite('V7.1 (офлайн, вмешательство, новости)');

async function loginAdmin(t) {
  t.win.document.getElementById('adminPass').value = ADMIN_PASS;
  t.win.document.getElementById('btnAdminAuth').click();
  await sleep(40);
}

/* ============================================================
   ОФЛАЙН-РЕЖИМ
   ============================================================ */

s.test('сервис-воркер на месте и подключён', () => {
  const swPath = path.join(ROOT, 'sw.js');
  assert(fs.existsSync(swPath), 'нет sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  assert(/addEventListener\('install'/.test(sw), 'воркер не ставит кэш при установке');
  assert(/addEventListener\('fetch'/.test(sw), 'воркер не отвечает на запросы');
  assert(/checkUpdate/.test(sw), 'ворер не следит за версией');
  assert(/serviceWorker\.register/.test(appCode), 'сайт не регистрирует воркер');
});

s.test('манифест PWA на месте и подключён', () => {
  const mPath = path.join(ROOT, 'manifest.webmanifest');
  assert(fs.existsSync(mPath), 'нет манифеста');
  const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  eq(m.name, 'ОБЗВОН — система обзвона', 'имя в манифесте');
  assert(m.icons && m.icons.length, 'в манифесте нет иконок');
  assert(/manifest\.webmanifest/.test(html), 'манифест не подключён в разметке');
});

s.test('воркер не ходит на чужие домены и не кэширует их', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const external = (sw.match(/https?:\/\/[^\s'"]+/g) || [])
    .filter((u) => !/www\.w3\.org/.test(u) && !/api\.telegram\.org/.test(u));
  eq(external.length, 0, 'воркер упоминает внешние адреса: ' + external.join(', '));
  assert(/url\.origin !== self\.location\.origin/.test(sw), 'нет проверки origin');
});

s.test('в админке есть индикатор офлайн-режима', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  const box = t.el('adminOffline');
  assert(box, 'нет индикатора офлайн-режима');
  assert(/офлайн/i.test(box.textContent || ''), 'нет текста про офлайн: ' + box.textContent);
  t.close();
});

/* ============================================================
   БЫСТРОЕ ВМЕШАТЕЛЬСТВО
   ============================================================ */

s.test('в админке есть кнопки вмешательства', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  ['btnAdminActPause', 'btnAdminActResume', 'btnAdminActEnd', 'btnAdminActUnlock', 'btnAdminOffline']
    .forEach((id) => assert(t.el(id), 'нет кнопки ' + id));
  t.close();
});

s.test('кнопка «Пауза» из надзора останавливает обзвон', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
  await sleep(30);
  t.el('btnStart').click();
  await sleep(140);
  eq(t.win.OBZ.state().state, 'running', 'обзвон не начался');
  t.el('btnAdminActPause').click();
  await sleep(80);
  eq(t.win.OBZ.state().state, 'paused', 'пауза из надзора не сработала');
  t.el('btnAdminActResume').click();
  await sleep(80);
  eq(t.win.OBZ.state().state, 'running', 'продолжение из надзора не сработало');
  t.close();
});

/* ============================================================
   ПОИСК ПО ЖУРНАЛУ
   ============================================================ */

s.test('поиск по журналу фильтрует события', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  await loginAdmin(t);
  const f = t.el('feedFilter');
  assert(f, 'нет поля поиска');
  f.value = 'несуществующий-текст';
  f.dispatchEvent(new t.win.Event('input', { bubbles: true }));
  await sleep(60);
  const hidden = t.$$('#signalList li').filter((li) => li.hidden);
  const total = t.$$('#signalList li').length;
  assert(total > 0, 'в журнале нет событий для проверки');
  eq(hidden.length, total, 'поиск не отфильтровал журнал');
  f.value = '';
  f.dispatchEvent(new t.win.Event('input', { bubbles: true }));
  await sleep(60);
  const hidden2 = t.$$('#signalList li').filter((li) => li.hidden).length;
  eq(hidden2, 0, 'сброс поиска не сработал');
  t.close();
});

/* ============================================================
   НОВОСТИ СВЯЗАНЫ С РАЗДЕЛАМИ
   ============================================================ */

s.test('в новостях есть метка раздела со ссылкой', () => {
  assert(/class="news-area"/.test(html), 'в новостях нет метки раздела');
  assert(/data-view="/.test(html), 'нет ссылки на раздел');
});

s.test('метка раздела ведёт в нужный раздел', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  /* добавим метку как это делает bump.js и проверим переход */
  const list = t.$('#newsPanel .news-list');
  assert(list, 'нет списка новостей');
  const a = t.win.document.createElement('a');
  a.className = 'news-area';
  a.setAttribute('data-view', 'help');
  a.setAttribute('data-anchor', 'protect');
  a.textContent = 'защита';
  list.insertBefore(a, list.firstChild);
  a.click();
  await sleep(120);
  eq(t.el('view-help').hidden, false, 'переход по метке не открыл справку');
  assert(t.el('protect'), 'нет блока защиты в справке');
  t.close();
});

s.test('в справке есть раздел о защите (куда ведут новости)', () => {
  assert(/id="protect"/.test(html), 'в справке нет блока «Защита обзвона» с якорем');
  assert(/npm run audit/.test(html), 'в справке нет ссылки на проверочную атаку');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
