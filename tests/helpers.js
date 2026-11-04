/* ============================================================
   Тестовый стенд ОБЗВОНа: поднимает сайт в jsdom, мокает
   окружение браузера (canvas, fetch, экраны) и даёт автотестам
   готовую страницу.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = ['js/fx.js', 'js/monitor.js', 'js/nav.js', 'js/live.js', 'js/archive.js', 'js/audit.js', 'js/health.js', 'js/app.js'];

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/* --- мок 2D-контекста canvas (jsdom без пакета canvas) --- */
function mockCtx() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return {
    canvas: null,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    shadowColor: '', shadowBlur: 0, lineCap: '', globalCompositeOperation: '',
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop,
    transform: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    rect: noop, fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop,
    clearRect: noop, fillText: noop, strokeText: noop, measureText: () => ({ width: 10 }),
    setLineDash: noop, getLineDash: () => [],
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    createPattern: () => null, drawImage: noop, getImageData: () => ({ data: [] }),
    putImageData: noop, isPointInPath: () => false
  };
}

/**
 * Поднимает сайт в jsdom.
 * @param {object} opts
 *  - pass: код куратора для тестов (хеш подменяется в исходнике app.js)
 *  - adminPass: код тех. администратора (v5.0, отдельный хеш)
 *  - storage: объект с начальным содержимым localStorage
 *  - version: версия, которую отдаёт мок version.json
 *  - noFetch: не подменять fetch
 */
function boot(opts = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    /* jsdom не умеет canvas/navigation — это ожидаемо, фильтруем */
    const msg = String((e && e.message) || e);
    if (/Not implemented|Could not parse CSS|Error: Not implemented/i.test(msg)) return;
    errors.push(msg);
  });
  vc.on('error', (msg) => { errors.push(String(msg)); });

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const version = opts.version || '4.0';
  const fetchCalls = [];

  const dom = new JSDOM(html, {
    url: 'https://obzvon.test/obzvon/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      /* --- canvas --- */
      window.HTMLCanvasElement.prototype.getContext = function () {
        if (!this.__ctx) { this.__ctx = mockCtx(); this.__ctx.canvas = this; }
        return this.__ctx;
      };
      /* --- фокус: считаем, что вкладка активна --- */
      window.document.hasFocus = () => true;
      /* --- экран --- */
      Object.defineProperty(window.screen, 'width', { value: 1920, configurable: true });
      Object.defineProperty(window.screen, 'height', { value: 1080, configurable: true });
      Object.defineProperty(window.screen, 'availWidth', { value: 1920, configurable: true });
      Object.defineProperty(window.screen, 'availHeight', { value: 1040, configurable: true });
      window.devicePixelRatio = 1;
      /* --- mediaDevices (перехватывается защитой) --- */
      Object.defineProperty(window.navigator, 'mediaDevices', {
        value: { getDisplayMedia: () => Promise.resolve({ getTracks: () => [] }), getUserMedia: () => Promise.resolve({}) },
        configurable: true, writable: true
      });
      /* --- переходы страницы --- */
      window.__nav = [];
      const origReplace = window.location.replace.bind(window.location);
      try {
        Object.defineProperty(window.location, 'replace', {
          value: function (u) { window.__nav.push({ type: 'replace', url: u }); },
          configurable: true, writable: true
        });
        Object.defineProperty(window.location, 'reload', {
          value: function () { window.__nav.push({ type: 'reload' }); },
          configurable: true, writable: true
        });
        Object.defineProperty(window.location, 'assign', {
          value: function (u) { window.__nav.push({ type: 'assign', url: u }); },
          configurable: true, writable: true
        });
      } catch (e) { /* jsdom может запретить переопределение location */ }
      void origReplace;
      /* --- fetch: отдаём version.json --- */
      if (!opts.noFetch) {
        window.fetch = function (url) {
          fetchCalls.push(String(url));
          const u = String(url);
          /* удалённая конфигурация и статус автоподдержки (v5.0) */
          if (opts.config && /config\.json/.test(u)) {
            return Promise.resolve({ ok: true, json: function () { return Promise.resolve(opts.config); } });
          }
          if (opts.status && /status\.json/.test(u)) {
            return Promise.resolve({ ok: true, json: function () { return Promise.resolve(opts.status); } });
          }
          return Promise.resolve({
            ok: true,
            json: function () { return Promise.resolve({ v: version }); }
          });
        };
      }
      /* --- стартовое localStorage --- */
      if (opts.storage) {
        try {
          for (const k of Object.keys(opts.storage)) {
            window.localStorage.setItem(k, opts.storage[k]);
          }
        } catch (e) {}
      }
      /* --- стартовый sessionStorage --- */
      if (opts.session) {
        try {
          for (const k of Object.keys(opts.session)) {
            window.sessionStorage.setItem(k, opts.session[k]);
          }
        } catch (e) {}
      }
    }
  });

  const win = dom.window;
  openWindows.push(win);

  /* --- подмена хеша кода куратора (только в памяти теста) --- */
  for (const f of SCRIPTS) {
    let code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (opts.pass && f === 'js/app.js') {
      code = code.replace(
        /passHash:\s*'[0-9a-f]+'/,
        "passHash: '" + sha256(opts.pass) + "'"
      );
    }
    /* код тех. администратора — отдельный (v5.0) */
    if (f === 'js/app.js') {
      code = code
        .replace(/adminHash:\s*'[0-9a-f]+'/, "adminHash: '" + sha256(opts.adminPass || 'admin-test-pass') + "'")
        .replace(/adminSalt:\s*'[^']*'/, "adminSalt: ''")
        .replace(/adminIter:\s*\d+/, 'adminIter: 0');
    }
    win.eval(code + '\n//# sourceURL=' + f);
  }

  return {
    dom, win, errors, fetchCalls,
    $: (sel) => win.document.querySelector(sel),
    $$: (sel) => Array.from(win.document.querySelectorAll(sel)),
    el: (id) => win.document.getElementById(id),
    storage: () => {
      const out = {};
      for (let i = 0; i < win.localStorage.length; i++) {
        const k = win.localStorage.key(i);
        out[k] = win.localStorage.getItem(k);
      }
      return out;
    },
    close: () => { try { win.close(); } catch (e) {} }
  };
}

/* --- мини-фреймворк --- */

/* все поднятые окна — чтобы гарантированно закрыть их после теста */
const openWindows = [];
function closeAll() {
  while (openWindows.length) {
    try { openWindows.pop().close(); } catch (e) {}
  }
}

function suite(name) {
  const tests = [];
  return {
    name,
    test: (title, fn) => tests.push({ title, fn }),
    run: async () => {
      let pass = 0, fail = 0;
      const failures = [];
      console.log('\n=== ' + name + ' ===');
      for (const t of tests) {
        try {
          await t.fn();
          pass++;
          console.log('  PASS  ' + t.title);
        } catch (e) {
          fail++;
          failures.push({ title: t.title, error: e });
          console.log('  FAIL  ' + t.title);
          console.log('        ' + (e && e.message ? e.message : e));
        } finally {
          closeAll();
        }
      }
      console.log('--- ' + name + ': ' + pass + ' PASS, ' + fail + ' FAIL');
      return { pass, fail, failures };
    }
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'условие не выполнено');
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'значения не совпали') + ': получено ' + JSON.stringify(actual) +
      ', ожидалось ' + JSON.stringify(expected));
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* вход в пульт куратором и тех. администратором + обход калибровки
   (с v5.0 пять кликов по логотипу доступны только администратору) */
async function loginAndCalibrate(t, pass = 'test-pass', adminPass = 'admin-test-pass') {
  const d = t.win.document;
  d.getElementById('passInput').value = pass;
  d.getElementById('btnAuth').click();
  await sleep(20);
  d.getElementById('adminPass').value = adminPass;
  d.getElementById('btnAdminAuth').click();
  await sleep(20);
  const logo = t.win.document.querySelector('.logo');
  for (let i = 0; i < 5; i++) logo.click();
  await sleep(20);
  return t;
}

module.exports = { boot, suite, assert, eq, sleep, sha256, closeAll, ROOT, SCRIPTS, loginAndCalibrate };
