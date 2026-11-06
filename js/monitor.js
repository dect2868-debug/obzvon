/* ============================================================
   ОБЗВОН v7.3 :: MONITOR  (детект нарушений + система кандидата)
   v4.0: авто-тесты браузера, захват экрана (WebRTC), вторая
   вкладка, подмена часов, пауза-отладчик, расширенный список
   блокируемых сочетаний.
   ============================================================ */
window.Monitor = (function () {
  'use strict';

  var S = {
    running: false,
    startedAt: 0,
    score: 0,
    viol: [],
    tabSwitches: 0,
    focusLosses: 0,
    idleHits: 0,
    copyAttempts: 0,
    blockedKeys: 0,
    screens: 1,
    reactions: [],
    missChallenges: 0,
    reloadTries: 0,
    devtools: false,
    focusedMs: 0,
    totalMs: 0,
    lastActivity: Date.now(),
    lastScreenX: null,
    lastScreenEvent: 0,
    lastFp: '',
    dpr: window.devicePixelRatio || 1,
    unfocusedSince: 0,
    challengeActive: false,
    baseDw: null,
    baseDh: null,
    baseline: null,
    automation: false,     /* автотесты / бот / удалённая отладка */
    webrtc: false,         /* захват экрана */
    secondTab: false,      /* страница открыта во второй вкладке */
    clockTamper: false,    /* подмена системных часов */
    blockedPrint: 0,
    tabId: null,
    _attached: false,
    lastTickAt: 0
  };

  var cfg = {
    idleLimit: 60000,
    fpInterval: 3000,
    tickInterval: 1000
  };

  var cb = { violation: null, focus: null, tick: null };

  /* ---------------- helpers ---------------- */
  function now() { return Date.now(); }
  function hms(ts) {
    var d = new Date(ts);
    function p(n) { return String(n).padStart(2, '0'); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* мягкий режим (v6.0): нарушения фиксируются, но не штрафуют
     (тренировка, проверка настройки, «мягкий» обзвон) */
  var SOFT = false;
  function setSoft(on) { SOFT = !!on; return SOFT; }

  function emit(type, label, weight, sev) {
    if (!S.running) return;
    S.score = Math.min(150, S.score + (SOFT ? 0 : weight));
    S.viol.push({ t: now(), type: type, label: label, weight: weight });
    /* журнал нарушений ограничен — иначе при «флуде» событий страница
       раздувается и localStorage переполняется (v4.0) */
    if (S.viol.length > 500) S.viol.shift();
    if (cb.violation) cb.violation({ type: type, label: label, weight: weight, sev: sev || (weight >= 6 ? 2 : 1), time: hms(now()) });
  }

  /* ---------------- device detection ---------------- */
  function detect() {
    var ua = navigator.userAgent || '';
    var os = 'Неизвестно';
    if (/Windows NT 10\.0/.test(ua)) os = 'Windows 10/11';
    else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
    else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
    else if (/Android ([\d.]+)/.test(ua)) os = 'Android ' + RegExp.$1;
    else if (/iPhone|iPad/.test(ua)) os = 'iOS';
    else if (/Mac OS X ([\d_]+)/.test(ua)) os = 'macOS ' + RegExp.$1.replace(/_/g, '.');
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';

    var br = 'Неизвестно';
    if (/YaBrowser/.test(ua)) br = 'Яндекс.Браузер ' + (ua.match(/YaBrowser\/([\d.]+)/) || [, ''])[1];
    else if (/Edg\/([\d.]+)/.test(ua)) br = 'Edge ' + RegExp.$1;
    else if (/OPR\/([\d.]+)/.test(ua)) br = 'Opera ' + RegExp.$1;
    else if (/Firefox\/([\d.]+)/.test(ua)) br = 'Firefox ' + RegExp.$1;
    else if (/Chrome\/([\d.]+)/.test(ua)) br = 'Chrome ' + RegExp.$1;
    else if (/Safari\//.test(ua)) br = 'Safari';

    var mm = window.matchMedia || function () { return { matches: false }; };
    var fine = mm('(pointer:fine)').matches;
    var coarse = mm('(pointer:coarse)').matches;
    var input = fine && coarse ? 'Мышь + тач' : fine ? 'Мышь / трекпад' : coarse ? 'Сенсорный' : '—';

    var kind = /Mobi|Android|iPhone/.test(ua) ? 'Телефон' : /iPad|Tablet/.test(ua) ? 'Планшет' : 'Компьютер';

    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var net = conn ? (conn.effectiveType || '').toUpperCase() + (conn.downlink ? ' · ' + conn.downlink + ' Мбит/с' : '') : 'н/д';

    var hw = (navigator.hardwareConcurrency ? navigator.hardwareConcurrency + ' потоков' : '—') +
      ' / ' + (navigator.deviceMemory ? navigator.deviceMemory + ' ГБ' : '—');

    return {
      kind: kind, os: os, br: br, input: input,
      screen: (screen.width || 0) + '×' + (screen.height || 0) + ' @' + (window.devicePixelRatio || 1) + 'x',
      viewport: (window.innerWidth || 0) + '×' + (window.innerHeight || 0),
      lang: (navigator.language || '—') + (navigator.languages && navigator.languages.length > 1 ? ' + ещё ' + (navigator.languages.length - 1) : ''),
      net: net, hw: hw, ua: ua
    };
  }

  function fingerprint() {
    return [navigator.userAgent, navigator.hardwareConcurrency, navigator.deviceMemory,
            (navigator.languages || []).join(','), screen.width, screen.height,
            window.devicePixelRatio].join('|');
  }

  /* ============================================================
     ЗАЩИТА v4.0 — расширенный набор детектов
     ============================================================ */

  /* маркеры автотестов и удалённой отладки */
  var AUTO_MARKERS = [
    '__playwright__', '__pw_manual', '__PW_inspect', '__playwright_target__',
    '__puppeteer_evaluation_script__', '__PUPPETEER__', '__puppeteer_evaluation_script__',
    '__selenium_unwrapped', '__selenium_evaluate', '__webdriver_evaluate',
    '__webdriver_script_fn', '__webdriver_script_func', '__driver_evaluate',
    '__nightmare', '_phantom', 'callPhantom', 'phantom',
    'domAutomation', 'domAutomationController', 'domAutomationBackend',
    'cdc_adoQpoasnfa76pfcZLmcfl_Array', 'cdc_adoQpoasnfa76pfcZLmcfl_JSON',
    'cdc_adoQpoasnfa76pfcZLmcfl_Object', '__selenium_evaluate'
  ];

  function detectAutomation() {
    if (S.automation) return true;
    var found = '';
    for (var i = 0; i < AUTO_MARKERS.length; i++) {
      var k = AUTO_MARKERS[i];
      try {
        if (k in window) { found = k; break; }
        if (window[k] !== undefined) { found = k; break; }
      } catch (e) {}
    }
    if (!found && navigator.webdriver === true) found = 'navigator.webdriver';
    if (!found) {
      try {
        if (navigator.plugins && navigator.plugins.length === 0 &&
            /HeadlessChrome/i.test(navigator.userAgent || '')) found = 'HeadlessChrome';
      } catch (e) {}
    }
    if (found) {
      S.automation = true;
      emit('automation', 'Обнаружена авто-тест/бот-окружение (' + found + ')', 18, 2);
      return true;
    }
    return false;
  }

  /* подмена встроенных функций (типичный приём обхода защиты) */
  function checkNative() {
    try {
      var t = Function.prototype.toString.toString();
      if (t.indexOf('[native code]') < 0) {
        S.automation = true;
        emit('automation', 'Встроенные функции переопределены (подмена кода)', 16, 2);
        return true;
      }
    } catch (e) {}
    try {
      var d = Object.getOwnPropertyDescriptor && Object.getOwnPropertyDescriptor(Date, 'now');
      if (d && d.value && String(d.value).indexOf('[native code]') < 0) {
        S.clockTamper = true;
        emit('clock', 'Функция Date.now переопределена', 14, 2);
        return true;
      }
    } catch (e2) {}
    return false;
  }

  /* перехват захвата экрана через WebRTC */
  function patchGetDisplayMedia() {
    try {
      var md = navigator.mediaDevices;
      if (!md || typeof md.getDisplayMedia !== 'function') return;
      if (md.__obzPatched) return;
      var orig = md.getDisplayMedia.bind(md);
      md.getDisplayMedia = function () {
        S.webrtc = true;
        emit('webrtc', 'Захват экрана через WebRTC (getDisplayMedia)', 15, 2);
        return orig.apply(md, arguments);
      };
      try { md.__obzPatched = true; } catch (e2) {}
    } catch (e) {}
  }

  /* вторая вкладка с этой страницей — участник мог смотреть в один экран,
     а отвечать в другом. Каждая вкладка пишет свой пульс в localStorage. */
  var TAB_PREFIX = 'obzvon_v2_tab_';
  function tabHeartbeat() {
    if (!S.tabId) {
      S.tabId = 'T' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }
    var nowTs = Date.now();
    try { localStorage.setItem(TAB_PREFIX + S.tabId, String(nowTs)); } catch (e) {}
    /* чистим мёртвые вкладки старше 30 с */
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(TAB_PREFIX) === 0) {
          var ts = parseInt(localStorage.getItem(k), 10) || 0;
          if (nowTs - ts > 30000) kill.push(k);
        }
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e2) {}

    /* ищем живые чужие вкладки */
    var foreign = 0;
    try {
      for (var j = 0; j < localStorage.length; j++) {
        var kk = localStorage.key(j);
        if (!kk || kk.indexOf(TAB_PREFIX) !== 0) continue;
        if (kk === TAB_PREFIX + S.tabId) continue;
        var t2 = parseInt(localStorage.getItem(kk), 10) || 0;
        if (nowTs - t2 < 15000) foreign++;
      }
    } catch (e3) {}
    if (foreign > 0 && !S.secondTab) {
      S.secondTab = true;
      emit('tab', 'Страница открыта во второй вкладке (' + foreign + ')', 12, 2);
    }
  }

  /* подмена системных часов (Date.now врёт, чтобы «отмотать» таймер) */
  function clockGuard() {
    if (!S.running) return;
    var real = -1;
    try {
      if (window.performance && typeof window.performance.now === 'function' &&
          typeof window.performance.timeOrigin === 'number') {
        real = window.performance.timeOrigin + window.performance.now();
      }
    } catch (e) {}
    if (real > 0) {
      var drift = Math.abs(real - Date.now());
      if (drift > 10000 && !S.clockTamper) {
        S.clockTamper = true;
        emit('clock', 'Системные часы изменены (расхождение ' + Math.round(drift / 1000) + ' с)', 14, 2);
      }
    }
  }

  /* пауза-отладчик: при открытых DevTools выполнение встаёт на паузу.
     Два замера подряд и высокий порог — чтобы не было ложных срабатываний
     при обычной нагрузке (сборка мусора, тяжёлая анимация). */
  var dbgSlow = 0;
  function debuggerGuard() {
    if (!S.running || S.devtools) return;
    var t0 = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    try { (function () { debugger; }()); } catch (e) {}
    var t1 = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    if (t1 - t0 > 400) {
      dbgSlow++;
      if (dbgSlow >= 2) {
        S.devtools = true;
        emit('devtools', 'Отладчик активен — выполнение страницы приостановлено', 10, 2);
      }
    } else {
      dbgSlow = 0;
    }
  }

  /* ---------------- keyboard / clipboard shield ---------------- */
  var COMBO_NAMES = {
    KeyI: 'DevTools (Ctrl+Shift+I)', KeyC: 'DevTools (Ctrl+Shift+C)', KeyJ: 'Консоль (Ctrl+Shift+J)',
    KeyU: 'Исходник страницы (Ctrl+U)', KeyP: 'Печать (Ctrl+P)', KeyS: 'Сохранение страницы (Ctrl+S)',
    KeyF: 'Поиск на странице (Ctrl+F)', KeyG: 'Поиск далее (Ctrl+G)', KeyH: 'История (Ctrl+H)',
    KeyL: 'Адресная строка (Ctrl+L)', KeyD: 'Закладка (Ctrl+D)', KeyO: 'Открытие файла (Ctrl+O)',
    KeyB: 'Панель закладок (Ctrl+Shift+B)', KeyV: 'Вставка без форматирования (Ctrl+Shift+V)',
    KeyN: 'Новое окно (Ctrl+Shift+N)', KeyE: 'Поиск в интернете (Ctrl+E)',
    KeyT: 'Новая вкладка (Ctrl+T)', KeyW: 'Закрыть вкладку (Ctrl+W)', Tab: 'Переключение вкладок (Ctrl+Tab)',
    Equal: 'Изменение масштаба (Ctrl++)', Minus: 'Изменение масштаба (Ctrl+-)', Digit0: 'Сброс масштаба (Ctrl+0)'
  };
  var BLOCK_CTRL = ['KeyU', 'KeyP', 'KeyS', 'KeyO', 'KeyF', 'KeyG', 'KeyH', 'KeyL', 'KeyD', 'KeyE',
                    'KeyT', 'KeyW', 'Equal', 'Minus', 'Digit0'];
  var BLOCK_CTRL_SHIFT = ['KeyI', 'KeyC', 'KeyJ', 'KeyN', 'KeyB', 'KeyV', 'KeyT', 'KeyW'];
  var BLOCK_TAB = true;   /* Ctrl+Tab / Ctrl+Shift+Tab — переключение вкладок */
  /* строгий режим (v5.0, включается из config.json): блокируются ещё и
     «открыть ссылку в новом окне», «свернуть всё», «выход из полного экрана» */
  var STRICT = false;
  var BLOCK_STRICT = ['KeyM', 'KeyQ', 'Escape'];

  function onKey(e) {
    S.lastActivity = now();
    if (!S.running) return;

    var k = (e.key || '').toLowerCase();

    if (k === 'f12') {
      block(e); S.blockedKeys++; S.devtools = true;
      emit('devtools', 'Попытка открыть DevTools (F12)', 8, 2);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && BLOCK_CTRL_SHIFT.indexOf(e.code) >= 0) {
      block(e); S.blockedKeys++;
      emit('devtools', 'Заблокировано: ' + (COMBO_NAMES[e.code] || e.code), 7, 2);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && BLOCK_CTRL.indexOf(e.code) >= 0) {
      block(e); S.blockedKeys++;
      emit('blocked', 'Заблокировано: ' + (COMBO_NAMES[e.code] || e.code), 5);
      return;
    }

    /* строгий режим: часть сочетаний закрывается полностью */
    if (STRICT && BLOCK_STRICT.indexOf(e.code) >= 0 && (e.ctrlKey || e.metaKey || e.altKey)) {
      block(e); S.blockedKeys++;
      emit('blocked', 'Заблокировано (строгий режим): ' + (COMBO_NAMES[e.code] || e.code), 5);
      return;
    }

    /* переключение вкладок: Ctrl+Tab / Ctrl+Shift+Tab */
    if (BLOCK_TAB && (e.ctrlKey || e.metaKey) && e.code === 'Tab') {
      block(e); S.blockedKeys++;
      emit('blocked', 'Заблокировано: ' + (COMBO_NAMES.Tab || 'переключение вкладок'), 6, 2);
      return;
    }

    if (e.code === 'F5' || (e.ctrlKey && k === 'r')) {
      block(e);
      S.reloadTries++;
      emit('reload', 'Попытка перезагрузки страницы', 6);
      return;
    }

    if (e.code === 'PrintScreen') {
      try { navigator.clipboard.writeText('ОБЗВОН · попытка скриншота'); } catch (err) {}
      emit('shot', 'Снимок экрана (PrintScreen) — буфер очищен', 5);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && ['KeyC', 'KeyV', 'KeyX', 'KeyA'].indexOf(e.code) >= 0) {
      block(e);
      S.copyAttempts++;
      emit('copy', 'Буфер обмена заблокирован', 3);
    }
  }

  function block(e) { e.preventDefault(); e.stopPropagation(); }

  function onCopyBlock(e) { if (S.running) { block(e); S.copyAttempts++; emit('copy', 'Копирование запрещено', 3); } }

  /* попытка напечатать страницу (Ctrl+P перехватывается, но диалог мог открыться иначе) */
  function onPrint() {
    if (!S.running) return;
    S.blockedPrint++;
    emit('print', 'Попытка печати страницы', 6, 2);
  }

  function onActivity() { S.lastActivity = now(); }

  /* ---------------- focus / visibility ---------------- */
  function markHidden(label) {
    if (!S.running || S.unfocusedSince) return;
    S.unfocusedSince = now();
    S.tabSwitches++;
    emit('blur', label, S.challengeActive ? 8 : 4, S.challengeActive ? 2 : 1);
    if (cb.focus) cb.focus(false);
  }

  function onBlur() {
    S.lastActivity = now();
    if (S.running && !S.unfocusedSince) S.unfocusedSince = now();
  }

  function handleBlur() { markHidden('Уход со страницы / потеря фокуса'); }

  function handleVisibility() {
    if (document.hidden) markHidden('Скрытие вкладки — переключение вкладок');
    else handleFocus();
  }

  function handleFocus() {
    if (!S.running) return;
    if (S.unfocusedSince) {
      var gap = now() - S.unfocusedSince;
      if (gap > 1500) {
        S.focusLosses++;
        emit('focus', 'Возврат на страницу (отсутствовал ' + Math.round(gap / 1000) + ' с)', 2, 1);
      }
      S.unfocusedSince = 0;
    }
    if (cb.focus) cb.focus(true);
  }

  /* ---------------- watchdogs ---------------- */
  function tick() {
    S.lastActivity = S.lastActivity || now();
    S.lastTickAt = now();          /* пульс: таймер монитора жив (v4.1) */
    if (!S.running) return;

    S.totalMs += cfg.tickInterval;
    if (document.hasFocus()) S.focusedMs += cfg.tickInterval;

    /* devtools */
    var dw = window.outerWidth - window.innerWidth;
    var dh = window.outerHeight - window.innerHeight;
    if (S.baseDw === null) { S.baseDw = dw; S.baseDh = dh; }
    if (!S.devtools && ((dw - (S.baseDw || 0) > 150) || (dh - (S.baseDh || 0) > 180))) {
      S.devtools = true;
      emit('devtools', 'Обнаружено окно инструментов разработчика', 8, 2);
    }

    /* второй экран */
    var scr = window.screen || {};
    var sx = window.screenX !== undefined ? window.screenX : window.screenLeft;
    var sy = window.screenY !== undefined ? window.screenY : window.screenTop;
    var extended = false;
    try { if (scr.isExtended === true) extended = true; } catch (eScr) {}
    var aw = scr.availWidth || scr.width || 0;
    if (typeof sx === 'number' && aw > 0) {
      var ow = window.outerWidth || 0, oh = window.outerHeight || 0;
      if (sx < -40 || (window.screenY !== undefined && sy < -40) ||
          (ow > 0 && sx + ow > aw + 80)) extended = true;
    }
    var jumped = (typeof sx === 'number' && S.lastScreenX !== null && typeof S.lastScreenX === 'number' &&
                  Math.abs(sx - S.lastScreenX) > 600 && now() - S.lastScreenEvent > 8000);
    if (jumped) {
      S.screens = Math.max(S.screens, 2);
      S.lastScreenEvent = now();
      emit('screen', 'Возможен второй монитор (окно резко сместилось)', 10, 2);
    } else if (extended) {
      if (S.screens < 2) {
        S.screens = 2;
        S.lastScreenEvent = now();
        emit('screen', 'Обнаружен второй экран / монитор', 10, 2);
      }
    }
    if (typeof sx === 'number') S.lastScreenX = sx;

    /* зум */
    if ((window.devicePixelRatio || 1) !== S.dpr) {
      S.dpr = window.devicePixelRatio || 1;
      emit('zoom', 'Изменение масштаба страницы', 2);
    }

    /* простой */
    if (now() - S.lastActivity > cfg.idleLimit) {
      S.idleHits++;
      S.lastActivity = now();
      emit('idle', 'Бездействие более ' + Math.round(cfg.idleLimit / 1000) + ' с (анти-AFK)', 2, 1);
    }

    if (cb.tick) cb.tick();
  }

  function fpCheck() {
    if (!S.running) return;
    var fp = fingerprint();
    if (S.lastFp && fp !== S.lastFp) {
      S.lastFp = fp;
      emit('fingerprint', 'Изменились параметры устройства / браузера', 15, 2);
    }
    S.lastFp = fp;
  }

  /* ---------------- public API ---------------- */
  function start(callbacks, options) {
    cb.violation = (callbacks && callbacks.violation) || null;
    cb.focus = (callbacks && callbacks.focus) || null;
    cb.tick = (callbacks && callbacks.tick) || null;
    if (options) { for (var k in options) cfg[k] = options[k]; }

    S.lastFp = fingerprint();
    S.lastScreenX = window.screenX !== undefined ? window.screenX : window.screenLeft;

    if (!S._attached) {
      S._attached = true;
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('contextmenu', onCopyBlock);
      document.addEventListener('copy', onCopyBlock);
      document.addEventListener('cut', onCopyBlock);
      document.addEventListener('selectstart', onCopyBlock);
      document.addEventListener('dragstart', onCopyBlock);
      document.addEventListener('beforeprint', onPrint);
      document.addEventListener('mousemove', onActivity, { passive: true });
      document.addEventListener('pointerdown', onActivity, { passive: true });
      document.addEventListener('touchstart', onActivity, { passive: true });
      document.addEventListener('wheel', onActivity, { passive: true });
      window.addEventListener('blur', handleBlur);
      window.addEventListener('focus', handleFocus);
      document.addEventListener('visibilitychange', handleVisibility);
      window.addEventListener('beforeunload', onBlur);
    }

    armTimers();
    S.lastTickAt = now();
  }

  /* таймеры монитора вынесены, чтобы их можно было перезапустить (v4.1) */
  function armTimers() {
    clearInterval(S._t); clearInterval(S._f);
    clearInterval(S._tab); clearInterval(S._clk); clearInterval(S._dbg);
    S._t = setInterval(tick, cfg.tickInterval);
    S._f = setInterval(fpCheck, cfg.fpInterval);
    /* защита v4.0: пульс вкладок, часы, отладчик */
    S._tab = setInterval(tabHeartbeat, 2000);
    S._clk = setInterval(clockGuard, 5000);
    S._dbg = setInterval(debuggerGuard, 2500);
    tabHeartbeat();
    patchGetDisplayMedia();
  }

  /* полная остановка монитора — нужна для чистого перезапуска системы (v4.1) */
  function stop() {
    clearInterval(S._t); clearInterval(S._f);
    clearInterval(S._tab); clearInterval(S._clk); clearInterval(S._dbg);
    S._t = S._f = S._tab = S._clk = S._dbg = null;
    if (S._attached) {
      S._attached = false;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('contextmenu', onCopyBlock);
      document.removeEventListener('copy', onCopyBlock);
      document.removeEventListener('cut', onCopyBlock);
      document.removeEventListener('selectstart', onCopyBlock);
      document.removeEventListener('dragstart', onCopyBlock);
      document.removeEventListener('beforeprint', onPrint);
      document.removeEventListener('mousemove', onActivity);
      document.removeEventListener('pointerdown', onActivity);
      document.removeEventListener('touchstart', onActivity);
      document.removeEventListener('wheel', onActivity);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', onBlur);
    }
    S.running = false;
    return true;
  }

  /* перезапуск монитора, если его таймеры зависли (самопочинка v4.1) */
  function restart() {
    armTimers();
    S.lastActivity = now();
    return true;
  }

  /* когда монитор последний раз «дышал» — для сторожа (v4.1) */
  function lastTickAt() { return S.lastTickAt || 0; }

  function setRunning(v) {
    S.running = !!v;
    if (v) {
      S.lastActivity = now();
      /* проверки запускаются в момент старта сессии, чтобы нарушение попало в журнал */
      detectAutomation();
      checkNative();
      patchGetDisplayMedia();
    }
  }

  function setChallengeActive(v) { S.challengeActive = !!v; if (v) S.lastActivity = now(); }

  function addReaction(ms) { S.reactions.push(ms); }

  /* soft = провал во время калибровки: считается в журнале, но не штрафует */
  function addMiss(soft) {
    S.missChallenges++;
    if (soft) { emit('miss', 'Испытание калибровки провалено', 0, 1); return; }
    emit('miss', 'Испытание внимания провалено', 8, 2);
  }

  function addReloadGuardPenalty() {
    S.reloadTries++;
    S.score += 6;
    S.viol.push({ t: now(), type: 'reload', label: 'Обнаружена перезагрузка страницы во время обзвона', weight: 6 });
    if (cb.violation) cb.violation({ type: 'reload', label: 'Обнаружена перезагрузка страницы во время обзвона', weight: 6, sev: 2, time: hms(now()) });
  }

  function avgReaction() {
    if (!S.reactions.length) return null;
    var s = 0; for (var i = 0; i < S.reactions.length; i++) s += S.reactions[i];
    return Math.round(s / S.reactions.length);
  }

  /* личная база реакции — задаётся по итогам калибровки, переживает reset() */
  function setBaseline(ms) { S.baseline = ms; }

  function cheatPercent() { return Math.min(100, Math.round(S.score)); }

  /* Концентрация = фокус (35%) + скорость реакции к базе (30%) + (100 − читомеряк) (35%) */
  function concentration() {
    var cheat = cheatPercent();
    var fr = focusRatio();
    var avg = avgReaction();
    var react = 100;
    if (avg !== null) {
      var base = S.baseline || 450;
      react = Math.max(0, Math.min(100, 100 - (avg - base) / 8));
    }
    var c = fr * 0.35 + react * 0.30 + (100 - cheat) * 0.35;
    return Math.max(0, Math.min(100, Math.round(c)));
  }
  function focusRatio() { return S.totalMs ? Math.round((S.focusedMs / S.totalMs) * 100) : 100; }

  function report(extra) {
    var r = {
      version: 'OBZVON-7.3',
      generatedAt: new Date().toISOString(),
      session: (extra && extra.session) || null,
      verdict: (extra && extra.verdict) || null,
      metrics: {
        concentration: concentration(),
        cheat: cheatPercent(),
        focusRatio: focusRatio() + '%',
        baselineReactionMs: S.baseline,
        tabSwitches: S.tabSwitches,
        focusLosses: S.focusLosses,
        idleHits: S.idleHits,
        screens: S.screens,
        copyAttempts: S.copyAttempts,
        blockedKeys: S.blockedKeys,
        reloadTries: S.reloadTries,
        missedChallenges: S.missChallenges,
        avgReactionMs: avgReaction(),
        reactions: S.reactions,
        blockedPrint: S.blockedPrint,
        automation: S.automation,
        webrtc: S.webrtc,
        secondTab: S.secondTab,
        clockTamper: S.clockTamper
      },
      device: detect(),
      violations: S.viol.map(function (v) { return { time: hms(v.t), type: v.type, label: v.label, weight: v.weight }; })
    };
    return r;
  }

  function reset() {
    S.score = 0; S.viol = []; S.tabSwitches = 0; S.focusLosses = 0; S.idleHits = 0;
    S.copyAttempts = 0; S.blockedKeys = 0; S.screens = 1; S.reactions = [];
    S.missChallenges = 0; S.reloadTries = 0; S.devtools = false;
    S.focusedMs = 0; S.totalMs = 0; S.challengeActive = false; S.unfocusedSince = 0;
    S.lastScreenEvent = 0; S.blockedPrint = 0;
    /* флаги взлома не сбрасываются: они характеризуют окружение, а не сессию */
  }

  /* ручной штраф (используется приложением, например выход из full-screen) */
  function penalty(label, weight, sev) {
    emit('manual', label, weight, sev || 1);
  }

  /* подделка сохранённых данных сессии: штраф в обход emit(),
     потому что событие должно попасть в журнал даже после сброса */
  function addTamper(label, weight) {
    S.score = Math.min(150, S.score + (weight || 20));
    S.viol.push({ t: now(), type: 'tamper', label: label, weight: weight || 20 });
    if (cb.violation) cb.violation({ type: 'tamper', label: label, weight: weight || 20, sev: 2, time: hms(now()) });
  }

  /* восстановление состояния после перезагрузки страницы */
  function restore(data) {
    reset();
    var d = data || {};
    S.score = d.score || 0;
    S.viol = Array.isArray(d.viol) ? d.viol.slice() : [];
    S.tabSwitches = d.tabSwitches || 0;
    S.focusLosses = d.focusLosses || 0;
    S.idleHits = d.idleHits || 0;
    S.missChallenges = d.missChallenges || 0;
    S.reactions = Array.isArray(d.reactions) ? d.reactions.slice() : [];
    S.screens = d.screens || 1;
    return true;
  }

  /* строгий режим: вкл/выкл из конфигурации */
  function setStrict(on) {
    STRICT = !!on;
    return STRICT;
  }

  /* состояние наружу — КОПИЯ (v5.0): участник не может подчистить
     счётчики из консоли, потому что оригинал остаётся внутри модуля */
  function stateCopy() {
    var out = {};
    for (var k in S) {
      if (!Object.prototype.hasOwnProperty.call(S, k)) continue;
      var v = S[k];
      out[k] = Array.isArray(v) ? v.slice() : v;
    }
    return out;
  }

  return {
    start: start, setRunning: setRunning, setChallengeActive: setChallengeActive,
    addReaction: addReaction, addMiss: addMiss, addReloadGuardPenalty: addReloadGuardPenalty,
    detect: detect, report: report, reset: reset, cheatPercent: cheatPercent,
    concentration: concentration, focusRatio: focusRatio, avgReaction: avgReaction,
    penalty: penalty, setBaseline: setBaseline, setSoft: setSoft,
    restore: restore, addTamper: addTamper, setStrict: setStrict,
    restart: restart, stop: stop, lastTickAt: lastTickAt,
    /* защита v4.0 — наружу, чтобы проверки можно было запускать из тестов */
    guards: {
      detectAutomation: detectAutomation,
      checkNative: checkNative,
      clockGuard: clockGuard,
      debuggerGuard: debuggerGuard,
      tabHeartbeat: tabHeartbeat,
      patchGetDisplayMedia: patchGetDisplayMedia
    },
    /* наружу — только копия (см. stateCopy) */
    get state() { return stateCopy(); }
  };
})();
