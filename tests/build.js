/* ============================================================
   Тесты сборки для своего хостинга (tools/build.js):
   однофайловая версия работает, CSP остаётся строгим,
   внешних зависимостей нет.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');
const { suite, assert, eq, sleep, ROOT } = require('./helpers');

const s = suite('BUILD (сборка для своего хостинга)');

let built = false;

function build() {
  if (built) return;
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.js')], { cwd: ROOT, stdio: 'pipe' });
  built = true;
}

s.test('сборка создаёт dist/ и архив', () => {
  build();
  assert(fs.existsSync(path.join(ROOT, 'dist', 'index.html')), 'нет dist/index.html');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'index.single.html')), 'нет однофайловой версии');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'js', 'app.js')), 'нет dist/js/app.js');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'css', 'styles.css')), 'нет dist/css/styles.css');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'assets', 'logo.svg')), 'нет логотипа');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'version.json')), 'нет version.json');
  assert(fs.existsSync(path.join(ROOT, 'obzvon-site.zip')), 'нет архива');
});

s.test('однофайловая версия самодостаточна: нет внешних ссылок', () => {
  build();
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.single.html'), 'utf8');
  eq((html.match(/<script src=/g) || []).length, 0, 'остались внешние скрипты');
  eq((html.match(/<link rel="stylesheet"/g) || []).length, 0, 'остались внешние стили');
  assert(!html.includes('assets/logo.svg'), 'логотип не встроен');
  /* никаких внешних адресов, кроме xmlns внутри data: */
  const urls = (html.match(/https?:\/\/[^\s"')]+/g) || []).filter((u) => u.indexOf('www.w3.org') < 0);
  eq(urls.length, 0, 'внешние адреса: ' + urls.slice(0, 3).join(', '));
});

s.test('CSP в однофайловой версии остаётся строгим (nonce)', () => {
  build();
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.single.html'), 'utf8');
  const m = html.match(/script-src 'self' file: 'nonce-([A-Za-z0-9+/=]+)'/);
  assert(m, 'в CSP нет nonce для инлайновых скриптов');
  const nonce = m[1];
  const tags = html.match(/<script nonce="([^"]+)"/g) || [];
  assert(tags.length >= 7, 'инлайновых скриптов мало: ' + tags.length);
  tags.forEach((t) => {
    const n = t.match(/nonce="([^"]+)"/)[1];
    eq(n, nonce, 'nonce скрипта не совпадает с CSP');
  });
  assert(html.indexOf('unsafe-inline') < 0 || /style-src[^;]*unsafe-inline/.test(html),
    'unsafe-inline не должен попадать в script-src');
});

s.test('однофайловая версия запускается и приложение поднимается', async () => {
  build();
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.single.html'), 'utf8');
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String((e && e.message) || e);
    if (/Not implemented|Could not parse CSS/i.test(m)) return;
    errs.push(m);
  });
  const dom = new JSDOM(html, {
    url: 'https://single.test/obzvon/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = function () {
        if (!this.__ctx) {
          const noop = () => {};
          const grad = { addColorStop: noop };
          this.__ctx = {
            globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
            shadowColor: '', shadowBlur: 0, lineCap: '',
            save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop,
            beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, rect: noop,
            fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
            fillText: noop, strokeText: noop, measureText: () => ({ width: 10 }),
            setLineDash: noop, getLineDash: () => [],
            createLinearGradient: () => grad, createRadialGradient: () => grad, drawImage: noop
          };
        }
        return this.__ctx;
      };
      window.document.hasFocus = () => true;
    }
  });
  await sleep(200);
  const w = dom.window;
  assert(w.OBZ, 'приложение не поднялось');
  eq(typeof w.Live, 'object', 'нет модуля Live');
  eq(typeof w.Archive, 'object', 'нет модуля Archive');
  eq(typeof w.Health, 'object', 'нет модуля Health');
  eq(w.OBZ.v, JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).v, 'версия');
  eq(errs.length, 0, 'ошибки при запуске: ' + errs.join(' | '));
  dom.window.close();
});

module.exports = s;

if (require.main === module) {
  s.run().then((r) => process.exit(r.fail ? 1 : 0));
}
