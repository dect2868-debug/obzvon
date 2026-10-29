/* ============================================================
   ОБЗВОН v2 :: MONITOR  (детект нарушений + система кандидата)
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
    baseline: null
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

  function emit(type, label, weight, sev) {
    if (!S.running) return;
    S.score = Math.min(150, S.score + weight);
    S.viol.push({ t: now(), type: type, label: label, weight: weight });
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

    var fine = window.matchMedia('(pointer:fine)').matches;
    var coarse = window.matchMedia('(pointer:coarse)').matches;
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

  /* ---------------- keyboard / clipboard shield ---------------- */
  var COMBO_NAMES = {
    KeyI: 'DevTools (Ctrl+Shift+I)', KeyC: 'DevTools (Ctrl+Shift+C)', KeyJ: 'Консоль (Ctrl+Shift+J)',
    KeyU: 'Исходник страницы (Ctrl+U)', KeyP: 'Печать (Ctrl+P)', KeyS: 'Сохранение страницы (Ctrl+S)'
  };
  var BLOCK_CTRL = ['KeyU', 'KeyP', 'KeyS', 'KeyO'];
  var BLOCK_CTRL_SHIFT = ['KeyI', 'KeyC', 'KeyJ', 'KeyN'];

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

  function onActivity() { S.lastActivity = now(); }

  /* ---------------- focus / visibility ---------------- */
  /* один уход = одна запись: blur и visibilitychange при переключении вкладки
     срабатывают вместе — считаем первое событие, второе отбрасываем */
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
    /* переключение вкладки, сворачивание, второй план — visibilitychange ловится
       всегда, даже когда blur по какой-то причине не пришёл */
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
    if (!S.running) return;

    S.totalMs += cfg.tickInterval;
    if (document.hasFocus()) S.focusedMs += cfg.tickInterval;

    /* devtools: сравниваем с базовой «шапкой» браузера, замеренной при старте,
       чтобы не ловить ложные срабатывания из-за панелей/масштабирования */
    var dw = window.outerWidth - window.innerWidth;
    var dh = window.outerHeight - window.innerHeight;
    if (S.baseDw === null) { S.baseDw = dw; S.baseDh = dh; }
    if (!S.devtools && ((dw - (S.baseDw || 0) > 150) || (dh - (S.baseDh || 0) > 180))) {
      S.devtools = true;
      emit('devtools', 'Обнаружено окно инструментов разработчика', 8, 2);
    }

    /* второй экран — три независимых признака:
       1) screen.isExtended: браузер сам видит, что рабочий стол расширен (Chrome/Edge);
       2) геометрия: окно уехало за границы основного монитора (висит на втором);
       3) резкий скачок координат окна (перетащили на другой монитор) */
    var scr = window.screen || {};
    var sx = window.screenX !== undefined ? window.screenX : window.screenLeft;
    var sy = window.screenY !== undefined ? window.screenY : window.screenTop;
    var extended = false;
    try { if (scr.isExtended === true) extended = true; } catch (eScr) {}
    var aw = scr.availWidth || scr.width || 0;
    if (typeof sx === 'number' && aw > 0) {
      var ow = window.outerWidth || 0, oh = window.outerHeight || 0;
      /* -40/+80 — запас на служебные рамки окна, чтобы не ругаться на максимизацию */
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

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('contextmenu', onCopyBlock);
    document.addEventListener('copy', onCopyBlock);
    document.addEventListener('cut', onCopyBlock);
    document.addEventListener('selectstart', onCopyBlock);
    document.addEventListener('dragstart', onCopyBlock);
    document.addEventListener('mousemove', onActivity, { passive: true });
    document.addEventListener('pointerdown', onActivity, { passive: true });
    document.addEventListener('touchstart', onActivity, { passive: true });
    document.addEventListener('wheel', onActivity, { passive: true });
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', onBlur);

    S._t = setInterval(tick, cfg.tickInterval);
    S._f = setInterval(fpCheck, cfg.fpInterval);
  }

  function setRunning(v) { S.running = !!v; if (v) S.lastActivity = now(); }

  function setChallengeActive(v) { S.challengeActive = !!v; if (v) S.lastActivity = now(); }

  function addReaction(ms) { S.reactions.push(ms); }

  function addMiss() { S.missChallenges++; emit('miss', 'Испытание внимания провалено', 8, 2); }

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
      version: 'OBZVON-2.6',
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
        reactions: S.reactions
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
    S.lastScreenEvent = 0;
  }

  /* ручной штраф (используется приложением, например выход из full-screen) */
  function penalty(label, weight, sev) {
    emit('manual', label, weight, sev || 1);
  }

  return {
    start: start, setRunning: setRunning, setChallengeActive: setChallengeActive,
    addReaction: addReaction, addMiss: addMiss, addReloadGuardPenalty: addReloadGuardPenalty,
    detect: detect, report: report, reset: reset, cheatPercent: cheatPercent,
    concentration: concentration, focusRatio: focusRatio, avgReaction: avgReaction,
    penalty: penalty, setBaseline: setBaseline,
    state: S
  };
})();
