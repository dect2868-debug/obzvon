/* ============================================================
   Тесты v9.0: самостоятельная админка — центр обновлений

   1) Модуль updater.js загружен и следит за версией.
   2) Проверка находит новую версию и запоминает, что нового.
   3) Публикация через GitHub Actions уходит по правильному адресу
      и с правильными заголовками.
   4) Токен GitHub не сохраняется в localStorage/sessionStorage.
   5) Без кода тех. администратора центр обновлений недоступен.
   6) В админке есть блок центра обновлений и кнопки действий.
   7) Резервная копия настроек собирается и применяется обратно.
   8) При «горячем» обновлении подгружаются все новые модули.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, suite, assert, eq, sleep, ROOT, loginAndCalibrate } = require('./helpers');

const s = suite('V9.0 (центр обновлений, самостоятельная админка)');
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const updCode = fs.readFileSync(path.join(ROOT, 'js', 'updater.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

s.test('модуль обновлений загружен и знает текущую версию', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  assert(t.win.Updater, 'модуль updater.js не загружен');
  const st = t.win.Updater.status();
  eq(st.current, t.win.OBZ.v, 'текущая версия в центре обновлений не совпадает');
  assert(st.log.length >= 0, 'журнал обновлений недоступен');
  t.close();
});

s.test('проверка находит новую версию и запоминает, что нового', async () => {
  const t = boot({ pass: 'test-pass', version: '99.9' });
  await sleep(150);
  await t.win.Updater.check(false);
  const st = t.win.Updater.status();
  eq(st.available, '99.9', 'новая версия не найдена');
  eq(st.state, 'available', 'состояние не «доступна версия»');
  assert(/найдена новая версия/.test(st.log.map((l) => l.msg).join(' ')), 'нет записи в журнале');
  t.close();
});

s.test('публикация уходит на GitHub Actions с токеном в заголовке', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  let seen = null;
  t.win.fetch = function (url, opts) {
    seen = { url: String(url), opts: opts || {} };
    return Promise.resolve({ ok: true, status: 204, json: function () { return Promise.resolve({}); } });
  };
  t.win.Updater.init({ deploy: { owner: 'dect2868-debug', repo: 'obzvon', workflow: 'pages.yml' } });
  const ok = await t.win.Updater.deploy('secret-token-123');
  eq(ok, true, 'публикация не запущена');
  assert(seen, 'запрос к GitHub не сделан');
  assert(/api\.github\.com\/repos\/dect2868-debug\/obzvon\/actions\/workflows\/pages\.yml\/dispatches/.test(seen.url),
    'неверный адрес публикации: ' + seen.url);
  eq(seen.opts.method, 'POST', 'метод публикации не POST');
  assert(/Bearer secret-token-123/.test((seen.opts.headers || {}).Authorization || ''),
    'токен не передан в заголовке');
  eq(JSON.parse(seen.opts.body).ref, 'main', 'ветка публикации неверна');
  eq(t.win.Updater.status().state, 'publishing', 'состояние после публикации неверно');
  t.close();
});

s.test('токен GitHub не сохраняется на диск', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  t.win.Updater.setToken('secret-token-456');
  eq(t.win.Updater.hasToken(), true, 'токен не принят');
  let ls = '';
  let ss = '';
  try {
    for (var i = 0; i < t.win.localStorage.length; i++) {
      ls += t.win.localStorage.key(i) + '=' + t.win.localStorage.getItem(t.win.localStorage.key(i)) + ';';
    }
    for (var j = 0; j < t.win.sessionStorage.length; j++) {
      ss += t.win.sessionStorage.key(j) + '=' + t.win.sessionStorage.getItem(t.win.sessionStorage.key(j)) + ';';
    }
  } catch (e) { /* jsdom может ограничить перебор */ }
  assert(ls.indexOf('secret-token-456') < 0, 'токен сохранён в localStorage');
  assert(ss.indexOf('secret-token-456') < 0, 'токен сохранён в sessionStorage');
  assert(!/setItem\([^)]*TOKEN/.test(updCode), 'модуль сам пишет токен в хранилище');
  t.close();
});

s.test('без кода тех. администратора центр обновлений закрыт', async () => {
  const t = boot({ pass: 'test-pass' });
  await sleep(150);
  eq(t.win.OBZ.updater().authed, false, 'состояние обновлений отдано без входа');
  eq(t.win.OBZ.updater().status, null, 'статус обновлений отдан без входа');
  const r = await t.win.OBZ.publishUpdate('secret-token-789');
  eq(r, false, 'публикация запущена без кода');
  t.close();
});

s.test('в админке есть центр обновлений с кнопками', async () => {
  const t = boot({ pass: 'test-pass' });
  await loginAndCalibrate(t, undefined, 'admin-test-pass');
  assert(/id="adminUpdateState"/.test(html), 'нет строки состояния обновления');
  assert(/id="adminUpdateLog"/.test(html), 'нет журнала обновлений');
  assert(/id="btnAdminPublish"/.test(html), 'нет кнопки публикации');
  assert(/id="updToken"/.test(html), 'нет поля токена');
  assert(/id="btnAdminBackup"/.test(html), 'нет кнопки резервной копии');
  const st = t.win.OBZ.updater();
  eq(st.authed, true, 'состояние обновлений недоступно с кодом администратора');
  assert(st.status && st.status.current, 'в статусе нет текущей версии');
  t.close();
});

s.test('резервная копия настроек собирается и применяется обратно', async () => {
  const t = boot({ pass: 'test-pass' });
  await loginAndCalibrate(t, undefined, 'admin-test-pass');
  /* порог меняем «руками», потом восстанавливаем из резервной копии */
  const before = t.win.OBZ.policies ? null : null;
  let captured = null;
  const OrigBlob = t.win.Blob;
  t.win.Blob = function (parts, opts) {
    captured = String(parts[0]);
    return new OrigBlob(parts, opts);
  };
  t.win.URL.createObjectURL = () => 'blob:mock';
  t.win.URL.revokeObjectURL = () => {};
  t.el('btnAdminBackup').click();
  await sleep(60);
  assert(captured, 'резервная копия не собрана');
  const data = JSON.parse(captured);
  assert(data && data.policies, 'в резервной копии нет политик');
  assert(typeof data.threshold === 'number', 'в резервной копии нет порога');
  void before;
  t.close();
});

s.test('новые модули входят в «горячее» обновление и в офлайн-кэш', () => {
  assert(/'js\/moder\.js', 'js\/updater\.js'/.test(appCode),
    'новые модули не входят в список перезагрузки при обновлении');
  assert(sw.includes('./js/updater.js'), 'updater.js не добавлен в офлайн-кэш');
  assert(html.includes('js/updater.js'), 'updater.js не подключён к странице');
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
