/* ============================================================
   ОБЗВОН v6.4 :: APP  (логика сессии и испытаний)
   ============================================================ */

/* ---------- защита от встраивания ----------
   Страницу нельзя открыть во фрейме: сначала показываем
   запрет, потом пытаемся увести верхнее окно на эту страницу. */
(function () {
  var BLOCK_HTML =
    '<head><meta charset="utf-8"><title>Запрещено</title></head>' +
    '<body style="background:#060a12;color:#dbe7ff;font-family:monospace;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
    'Встраивание страницы запрещено. Откройте её отдельно.</body>';
  var blocked = false;
  try {
    if (window.top !== window.self) {
      blocked = true;
      try { document.documentElement.innerHTML = BLOCK_HTML; } catch (e) {}
      try { window.top.location = window.location.href; } catch (e2) {}
    }
  } catch (e) {
    blocked = true;
    try { document.documentElement.innerHTML = BLOCK_HTML; } catch (e2) {}
  }
  window.__OBZ_BLOCKED = blocked;
})();

(function () {
  'use strict';

  if (window.__OBZ_BLOCKED) return;

  /* ---------- настройки ---------- */
  var CONFIG = {
    appVersion: '6.4',        // версия (должна совпадать с version.json и ?v= в index.html)

        /* ---------- КОДЫ ДОСТУПА (v6.0) ----------
       Кодов в репозитории НЕТ — иначе их можно перебрать по хешу.
       Источники (по порядку):
         1) localStorage этого устройства — смена кода из админки;
         2) window.OBZ_AUTH — файл js/auth.local.js (вне репозитория,
            собирается на сервере или в CI из секретов);
         3) эти поля — только если автор вписал вручную (не рекомендуется).
       Формат: PBKDF2-HMAC-SHA256 (соль + 150 000 итераций). Старый sha256
       больше не принимается — его перебирают за секунды. */
    passHash: '',             // код куратора (пусто = берётся из auth.local.js)
    passSalt: '',
    passIter: 0,
    adminHash: '',            // код тех. администратора
    adminSalt: '',
    adminIter: 0,

    authFailsLimit: 5,        // неверных попыток до блокировки ввода
    authLockMs: 30000,        // длительность блокировки ввода кода, мс
    threshold: 60,            // порог «читомеряка» по умолчанию (%)
    calibCount: 100,          // испытаний калибровки по умолчанию (до 100 — длинная проверка)
    calibSpeed: 0.55,         // сложность калибровки: 0.55 = время на ответ короче на 45%
    chTimeout: 9000,          // базовый таймаут испытания, мс
    chDelayMin: 10000,        // (не используется — темп задаёт nextDelay)
    chDelayMax: 25000,
    holdMs: 2000,             // (база) удержание клавиши
    idleLimit: 65000,         // мс простоя до штрафа
    storageKey: 'obzvon_v2_state',
    updateCheckMs: 60000,     // как часто проверять новую версию, мс
    autoUpdateMs: 5000,       // пауза перед авто-обновлением (вне сессии), мс
    postSessionUpdateMs: 20000, /* пауза перед обновлением после обзвона, мс */
    integrityCheckMs: 20000,  // как часто сверять целостность DOM и кода, мс
    storageFallback: false,   // true = localStorage недоступен, работаем в памяти
    /* возможности сайта — часть из них приходит из config.json (v5.0) */
    features: {
      autoUpdate: true,       // сайт сам применяет новую версию в фоне
      strict: false,          // строгий режим: блокируются ещё и «вкладки/окна»
      collectDevice: true,    // собирать данные об устройстве в отчёте
      audit: true             // вести журнал действий
    },
    configUrl: 'config.json',  // удалённая конфигурация (функции и настройки)
    statusUrl: 'status.json',  // состояние автоподдержки (пишет CI на GitHub)
    integrityUrl: 'integrity.json', // опубликованный отпечаток файлов
    /* ---------- ПОЛИТИКИ ВМЕШАТЕЛЬСТВА (v6.0) ----------
       Что система делает сама при нарушениях и как работает с участником.
       Часть приходит из config.json — меняется без обновления кода. */
    policies: {
      autoPause: false,      // авто-пауза при нарушении во время испытания
      softMode: false,       // мягкий режим: нарушения пишутся, но не штрафуются
      autoReport: false,     // авто-выгрузка отчёта в конце обзвона
      maxAttempts: 5,        // лимит неудачных попыток входа
      reminder: ''           // напоминание о расписании обзвона
    }
  };

  /* ---------- РОЛИ (v5.0) ----------
     Права раздельные: куратор ведёт обзвон, тех. администратор —
     надзор, обслуживание и вмешательство. Коды разные. */
  var ROLES = {
    curator: { key: 'curator', title: 'Куратор', scope: 'call' },
    admin:   { key: 'admin',   title: 'Тех. администратор', scope: 'call+admin' }
  };

  /* таймауты по типам испытаний (мс) */
  var CH_TIMEOUTS = { key: 6750, target: 7500, hold: 10500, math: 9000, seq: 13500, stroop: 9000 };
  /* минимальное время на ответ при калибровке (v6.1):
     ниже этих значений испытание не проходит даже у быстрых людей —
     из-за этого калибровка сбрасывалась на первом же провале */
  var CALIB_MIN = { key: 2200, target: 2200, math: 3400, seq: 3800, stroop: 2400, hold: 2600 };

  var $ = function (id) { return document.getElementById(id); };

  /* проверка кода куратора */
  var SHA_K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }
  function bytesToHex(bytes) {
    var hex = '';
    for (var v = 0; v < bytes.length; v++) hex += ('0' + (bytes[v] & 0xff).toString(16)).slice(-2);
    return hex;
  }
  function hexToBytes(hex) {
    var out = [];
    var s = String(hex || '');
    for (var i = 0; i + 1 < s.length; i += 2) {
      var n = parseInt(s.substr(i, 2), 16);
      out.push(isNaN(n) ? 0 : n);
    }
    return out;
  }
  function sha256bytes(bytes) {
    var msg = bytes.slice();
    var len = bytes.length;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var bitLen = len * 8;
    /* 64-битная длина big-endian: старшие 32 бита всегда нулевые */
    msg.push(0, 0, 0, 0);
    for (var s = 24; s >= 0; s -= 8) msg.push((bitLen / Math.pow(2, s)) & 0xff);

    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var w = new Array(64);
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < msg.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) |
                (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c2 = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[t] + w[t]) >>> 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        var maj = (a & b) ^ (a & c2) ^ (b & c2);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c2; c2 = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c2) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    /* восемь 32-битных слов → 32 байта (big-endian) */
    var out = new Array(32);
    for (var w2 = 0; w2 < 8; w2++) {
      out[w2 * 4]     = (H[w2] >>> 24) & 0xff;
      out[w2 * 4 + 1] = (H[w2] >>> 16) & 0xff;
      out[w2 * 4 + 2] = (H[w2] >>> 8) & 0xff;
      out[w2 * 4 + 3] = H[w2] & 0xff;
    }
    return out;
  }
  function sha256hex(str) { return bytesToHex(sha256bytes(utf8Bytes(str))); }

  /* HMAC-SHA256 поверх того же SHA-256 */
  function hmacSha256(key, msg) {
    var BS = 64, i;
    var k = key.length > BS ? sha256bytes(key) : key.slice();
    var ipad = new Array(BS), opad = new Array(BS);
    for (i = 0; i < BS; i++) {
      var b = i < k.length ? (k[i] & 0xff) : 0;
      ipad[i] = b ^ 0x36; opad[i] = b ^ 0x5c;
    }
    var inner = sha256bytes(ipad.concat(msg));
    return sha256bytes(opad.concat(inner));
  }

  /* PBKDF2-HMAC-SHA256 → hex: перебор опубликованного хеша становится
     практически невозможным (соль + 150 000 итераций) */
  function pbkdf2hex(str, saltHex, iter, dkLen) {
    var salt = hexToBytes(saltHex);
    var pw = utf8Bytes(str);
    var hLen = 32, out = [];
    var blocks = Math.ceil((dkLen || 32) / hLen);
    for (var b = 1; b <= blocks; b++) {
      var idx = [(b >>> 24) & 255, (b >>> 16) & 255, (b >>> 8) & 255, b & 255];
      var u = hmacSha256(pw, salt.concat(idx));
      var t = u.slice();
      for (var i = 1; i < iter; i++) {
        u = hmacSha256(pw, u);
        for (var j = 0; j < hLen; j++) t[j] ^= u[j];
      }
      for (var q = 0; q < hLen; q++) out.push(t[q] & 0xff);
    }
    return bytesToHex(out.slice(0, dkLen || 32));
  }

  /* ---------- хранение кодов (v5.0) ----------
     Код задаётся в CONFIG (репозиторий) либо переопределяется на этом
     устройстве — так тех. администратор меняет свой код без правки кода. */
  var CODES_KEY = 'obzvon_v2_codes';
  function localCodes() {
    try {
      var d = JSON.parse(localStorage.getItem(CODES_KEY) || '{}');
      return (d && typeof d === 'object') ? d : {};
    } catch (e) { return {}; }
  }
  function saveLocalCodes(obj) {
    try { localStorage.setItem(CODES_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function roleCode(role) {
    /* 1) код, заданный на этом устройстве (ротация из админки) */
    var loc = localCodes()[role];
    if (loc && loc.hash) return loc;
    /* 2) файл js/auth.local.js — вне репозитория */
    var file = (window.OBZ_AUTH && window.OBZ_AUTH[role]) || null;
    if (file && (file.hash || file.legacyHash)) return file;
    /* 3) ручная настройка в CONFIG (не рекомендуется) */
    if (role === 'admin') {
      return { hash: CONFIG.adminHash, salt: CONFIG.adminSalt, iter: CONFIG.adminIter };
    }
    return { hash: CONFIG.passHash, salt: CONFIG.passSalt, iter: CONFIG.passIter };
  }
  /* проверка кода роли.
     Основной формат — PBKDF2 (соль + итерации): перебор опубликованного
     хеша практически невозможен.
     Старый формат (sha256 без соли) принимается ТОЛЬКО из файла вне
     репозитория и только пока код не перевыпущен: такой хеш перебирают
     за секунды. В CONFIG его быть не может — репозиторий публичный. */
  function roleMatch(role, input) {
    if (!input || !role) return false;
    var c = roleCode(role);
    if (!c) return false;
    if (c.salt && c.iter && c.hash) {
      return pbkdf2hex(input, c.salt, c.iter, 32) === String(c.hash).toLowerCase();
    }
    if (c.legacyHash) {
      return sha256hex(input) === String(c.legacyHash).toLowerCase();
    }
    return false;
  }
  /* роль настроена в усиленном виде (PBKDF2)? */
  function roleReady(role) {
    var c = roleCode(role);
    return !!(c && c.hash && c.salt && c.iter);
  }
  /* роль настроена вовсе (в любом формате)? */
  function roleConfigured(role) {
    var c = roleCode(role);
    return !!(c && (c.hash || c.legacyHash));
  }
  /* роль работает, но в старом формате (sha256) — её надо перевыпустить */
  function codeIsWeak(role) {
    var c = roleCode(role);
    if (!c) return false;
    if (c.hash && c.salt && c.iter) return false;
    return !!(c.legacyHash || c.hash);
  }
  function passMatch(input) { return roleMatch('curator', input); }
  var els = {};
  ['sessionId','sessionTimer','statusBadge','btnSound','curatorHead','curatorBody','curatorCaret',
   'passInput','btnAuth','authRow','authHint','ctrlRow','btnStart','btnPause','btnEnd','btnFs',
   'btnReport','btnReset','chkFsReq','selThreshold','metrics','concValue','concBar','cheatValue',
   'cheatBar','focusState','tabState','screenCount','avgReaction','focusLosses','idleHits','violCount',
   'devKind','devOs','devBrowser','devInput','devScreen','devViewport','devLang','devNet','devHw','devUa',
   'gate','gateText','btnCalibrate','calibStatus','playfield','chRound','chBar','chTask','arena','chTarget',
   'signalList','feedCount','pauseOverlay','btnResume','lockOverlay','lockTitle','lockText','unlockInput',
   'btnUnlock','sumOverlay','sumTag','sumVerdict','sumTable','btnSumReport','btnSumClose','toast','stroopRow',
   'totalConc','concTrend','errBanner','selCalib','statTable','chTable','chTableBody','chStat','partPanel','chPad',
   'btnPauseSelf','btnEndSelf','achRow','sessionStart','memValue','memBar','heapValue',
   'btnExportStats','btnImportStats','importFile','wmLayer',
    'updBanner','updTitle','updSub','updCount','btnUpdateNow','btnUpdateLater','btnUpdate','verBadge',
    'liveChart','liveSummary','liveNow','liveBadge','liveTicker',
    'archCards','archChart','archCompare','archTable','archCount',
    'btnArchCsv','btnArchClear',
    'healthGrid','healthScore','healthRepair','healthLog',
    'btnHealthCheck','btnHealthRepair','btnHealthReport','btnHealthClear','btnHealthRestart',
    'adminGate','adminBody','adminPass','btnAdminAuth','btnAdminLock','adminUpdateInfo',
    'btnAdminCheck','btnAdminUpdate','btnAdminStress','btnAdminStressSmall','btnAdminPurge','adminStress','adminLock',
    'btnAuthAdmin','adminRoles','adminWatch','adminAudit','adminBuildInfo','adminCfgInfo',
    'adminNewCode','btnAdminRotate','btnAdminResetCode','btnAdminRefresh','btnAdminDump','btnAdminCfg','btnAdminAuditClear',
    'adminCodeExport','adminPolicies','adminThreats','btnAdminPolicyReset','btnAdminIntegrity',
    'adminStats','btnAdminStats']
   .forEach(function (id) { els[id] = $(id); });

  /* ---------- реестр слушателей и таймеров (v4.2) ----------
     Нужен для чистого перезапуска: старый экземпляр приложения обязан
     освободить всё, иначе после фонового обновления события
     обрабатывались бы дважды (двойные штрафы, двойные реакции). */
  var LISTENERS = [];
  var TIMERS = [];

  function on(target, type, fn, opts) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn, opts);
    LISTENERS.push([target, type, fn, opts]);
  }
  function every(ms, fn) {
    var id = setInterval(fn, ms);
    TIMERS.push(id);
    return id;
  }
  function shutdown() {
    var i;
    for (i = 0; i < TIMERS.length; i++) clearInterval(TIMERS[i]);
    TIMERS = [];
    for (i = 0; i < LISTENERS.length; i++) {
      var L = LISTENERS[i];
      try { L[0].removeEventListener(L[1], L[2], L[3]); } catch (e) {}
    }
    LISTENERS = [];
    return true;
  }

  /* ---------- состояние ---------- */
  var ST = {
    state: 'idle',          // idle | calib | running | paused | locked | ended
    authed: false,
    role: null,            // кто за пультом: null | 'curator' | 'admin'
    calibrated: false,
    calibDone: 0,
    sessionId: null,
    sessionStartAt: 0,      // wall-clock момент начала сессии (для отображения «старт»)
    startedAt: 0,           // ms сессии (накопленные)
    runSince: 0,            // ms wall-clock старта текущего отрезка
    threshold: CONFIG.threshold,
    relockBase: 0,
    muted: false,
    lastKind: null,
    calibFails: 0,        // провалов калибровки за загрузку (для фишки «ЧИСТАЯ КАЛИБРОВКА»)
    hadReload: false,     // сессия восстанавливалась после перезагрузки (фишка «ВОЗВРАЩЕНИЕ»)
    integrityOk: true,    // подпись сохранённых данных не нарушалась
    baseReaction: null   // база реакции с калибровки (мс), переживает итоги
  };

  /* ---------- утилиты ---------- */
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  /* криптостойкие случайные байты (соль для кодов) */
  function randomBytes(n) {
    var out = new Array(n), i;
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var buf = new Uint8Array(n);
        window.crypto.getRandomValues(buf);
        for (i = 0; i < n; i++) out[i] = buf[i];
        return out;
      }
    } catch (e) {}
    for (i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
  function fmt(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    s = s % 60;
    function p(n) { return String(n).padStart(2, '0'); }
    return (h > 0 ? p(h) + ':' : '') + p(m) + ':' + p(s);
  }
  function fmtClock(ts) {
    var d = new Date(ts);
    function p(n) { return String(n).padStart(2, '0'); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) +
      ' · ' + p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  /* ---------- звук ---------- */
  var actx = null;
  function beep(freq, dur, type, vol) {
    if (ST.muted) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = vol || 0.04;
      o.connect(g); g.connect(actx.destination);
      /* dur — в миллисекундах (как и передаётся вызывающими) */
      var t0 = actx.currentTime, len = (dur || 150) / 1000;
      o.start(t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      o.stop(t0 + len + 0.02);
    } catch (e) {}
  }
  var sndGood = function () { beep(880, 120, 'sine', .05); setTimeout(function(){ beep(1320, 160, 'sine', .045); }, 90); };
  var sndBad  = function () { beep(160, 260, 'sawtooth', .05); setTimeout(function(){ beep(110, 320, 'sawtooth', .04); }, 140); };
  var sndTick = function () { beep(1200, 60, 'square', .02); };
  var sndAlarm= function () { beep(700, 200, 'square', .05); setTimeout(function(){ beep(700, 200, 'square', .05); }, 260); setTimeout(function(){ beep(500, 350, 'square', .05); }, 520); };

  /* ---------- тост ---------- */
  var toastTimer = null;
  function toast(text, cls, ms) {
    els.toast.textContent = text;
    els.toast.className = 'toast' + (cls ? ' ' + cls : '');
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, ms || 3200);
  }

  /* ---------- водяной знак с ID сессии (v3.8) ----------
     Мелкий повторяющийся текст на фоне страницы: любой снимок экрана
     сразу показывает, к какой сессии он относится. */
  function updateWatermark() {
    if (!els.wmLayer) return;
    var active = ['running', 'paused', 'locked'].indexOf(ST.state) >= 0 && ST.sessionId;
    if (!active) { els.wmLayer.textContent = ''; els.wmLayer.classList.remove('on'); return; }
    var line = 'ОБЗВОН · ' + ST.sessionId + '   ';
    var txt = '';
    for (var i = 0; i < 60; i++) txt += line;
    els.wmLayer.textContent = txt;
    els.wmLayer.classList.add('on');
  }

  /* ---------- журнал ---------- */
  var FEED = [];   /* события журнала (переживают перезагрузку в сессии) */

  function feedDomAdd(item) {
    var ul = els.signalList;
    var empty = ul.querySelector('.feed-empty');
    if (empty) empty.remove();
    var li = document.createElement('li');
    li.className = 'sev-' + (item.sev || 1);
    li.innerHTML = '<time>' + esc(item.time) + '</time><span>' + esc(item.label) + '</span>';
    ul.insertBefore(li, ul.firstChild);
    while (ul.children.length > 60) ul.removeChild(ul.lastChild);
    els.feedCount.textContent = ul.children.length;
  }

  function feedAdd(item) {
    FEED.push({ time: item.time, label: item.label, sev: item.sev || 1 });
    if (FEED.length > 60) FEED.shift();
    feedDomAdd(item);
  }

  function feedRebuild() {
    FEED.forEach(feedDomAdd);   /* от старых к новым — новое сверху */
  }

  /* ---------- бейдж ---------- */
  function setBadge(text, cls) {
    els.statusBadge.textContent = text;
    els.statusBadge.className = 'badge ' + cls;
  }

  /* ---------- метрики ---------- */
  var lastVals = {};
  function setVal(el, text) {
    text = String(text);
    if (lastVals[el.id] === text) return;
    lastVals[el.id] = text;
    el.textContent = text;
    var card = el.closest('.metric');
    if (card) {
      card.classList.remove('flash');
      void card.offsetWidth;
      card.classList.add('flash');
    }
  }

  function updateMetrics() {
    var S = Monitor.state;
    var conc = Monitor.concentration(), cheat = Monitor.cheatPercent();
    setVal(els.concValue, conc + '%');
    els.concBar.style.width = conc + '%';
    setVal(els.cheatValue, cheat + '%');
    els.cheatBar.style.width = cheat + '%';
    els.cheatValue.className = cheat >= ST.threshold ? 'bad' : (cheat >= 30 ? 'warn' : '');
    var focused = document.hasFocus();
    var inSession = ['running', 'paused', 'locked'].indexOf(ST.state) >= 0;
    setVal(els.focusState, inSession ? (focused ? 'ЕСТЬ' : 'НЕТ') : '—');
    els.focusState.className = inSession ? (focused ? 'ok' : 'bad') : 'dim';
    setVal(els.tabState, S.tabSwitches);
    setVal(els.screenCount, S.screens);
    els.screenCount.className = S.screens > 1 ? 'bad' : '';
    var ar = Monitor.avgReaction();
    setVal(els.avgReaction, ar === null ? '—' : ar + ' мс');
    setVal(els.focusLosses, S.focusLosses);
    setVal(els.idleHits, S.idleHits);
    setVal(els.violCount, S.viol.length);
    updateTables();
  }

  /* ============================================================
     ТАБЛИЦА РЕЗУЛЬТАТОВ (метрики + журнал испытаний)
     ============================================================ */
  var KIND_NAMES = {
    key: 'Клавиша', target: 'Цель', hold: 'Удержание',
    math: 'Математика', seq: 'Память', stroop: 'Струп'
  };
  var CH_LOG = [];   /* журнал испытаний: {n,kind,calib,ok,ms,note,time} */

  /* ---------- сортировка таблиц (v3.8) ---------- */
  var statSort = { key: null, dir: 1 };   /* 'label' | 'value' */
  var chSort = { key: 'n', dir: 1 };      /* 'n' | 'kind' | 'ok' | 'ms' */

  function thCls(state, key) {
    if (state.key !== key) return '';
    return state.dir > 0 ? 'sorted asc' : 'sorted desc';
  }
  function statNum(v) {
    var m = String(v).replace(/\s/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function sortStatRows(rows) {
    if (!statSort.key || rows.length < 2) return rows;
    var key = statSort.key, dir = statSort.dir;
    return rows.slice().sort(function (a, b) {
      if (key === 'label') return dir * String(a[0]).localeCompare(String(b[0]), 'ru');
      var x = statNum(a[1]), y = statNum(b[1]);
      if (x === null && y === null) return 0;
      if (x === null) return 1;    /* «—» всегда в конце */
      if (y === null) return -1;
      return dir * (x - y);
    });
  }
  function sortChLog() {
    var log = CH_LOG.slice();
    var key = chSort.key, dir = chSort.dir;
    if (!key) return log;
    return log.sort(function (a, b) {
      var r = 0;
      if (key === 'n') r = a.n - b.n;
      else if (key === 'kind') r = String(KIND_NAMES[a.kind] || '').localeCompare(String(KIND_NAMES[b.kind] || ''), 'ru');
      else if (key === 'ok') r = (a.ok ? 1 : 0) - (b.ok ? 1 : 0);
      else if (key === 'ms') r = (a.ms || -1) - (b.ms || -1);
      return dir * r;
    });
  }

  function updateTables() {
    if (!els.statTable) return;
    var S = Monitor.state;
    var ar = Monitor.avgReaction();
    var inS = ['running', 'paused', 'locked', 'ended'].indexOf(ST.state) >= 0;
    var rows = [
      ['Концентрация', Monitor.concentration() + '%'],
      ['Читомеряк', Monitor.cheatPercent() + '%'],
      ['В фокусе', Monitor.focusRatio() + '%'],
      ['Смены вкладок', S.tabSwitches],
      ['Срывы фокуса', S.focusLosses],
      ['Лишние экраны', S.screens],
      ['Провалы испытаний', S.missChallenges],
      ['Простой (бездействие)', S.idleHits],
      ['Копирование текста', S.copyAttempts],
      ['Попытки DevTools', S.blockedKeys],
      ['Попытки перезагрузки', S.reloadTries],
      ['Средняя реакция', ar === null ? '—' : ar + ' мс'],
      ['Испытаний в журнале', CH_LOG.length],
      ['Нарушений всего', S.viol.length]
    ];
    if (!inS && !CH_LOG.length) {
      rows = [['—', 'данные появятся после калибровки и обзвона']];
    }
    rows = sortStatRows(rows);
    els.statTable.innerHTML =
      '<thead><tr>' +
        '<th data-sort="label" class="' + thCls(statSort, 'label') + '">ПОКАЗАТЕЛЬ</th>' +
        '<th data-sort="value" class="' + thCls(statSort, 'value') + '">ЗНАЧЕНИЕ</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(String(r[1])) + '</td></tr>';
      }).join('') + '</tbody>';

    /* индикаторы сортировки на статичном thead журнала испытаний */
    if (els.chTable) {
      var ths = els.chTable.querySelectorAll('th[data-sort]');
      for (var i = 0; i < ths.length; i++) {
        ths[i].className = thCls(chSort, ths[i].getAttribute('data-sort'));
      }
    }

    if (!CH_LOG.length) {
      els.chTableBody.innerHTML = '<tr class="ch-empty"><td colspan="4">испытаний не было</td></tr>';
      els.chStat.textContent = '';
      return;
    }
    var log = sortChLog();
    var okN = 0, sumMs = 0, msN = 0;
    els.chTableBody.innerHTML = log.map(function (r) {
      if (r.ok) { okN++; if (r.ms) { sumMs += r.ms; msN++; } }
      return '<tr class="' + (r.ok ? 'ok' : 'bad') + '">' +
        '<td class="num">' + r.n + '</td>' +
        '<td>' + KIND_NAMES[r.kind] + (r.calib ? '<span class="tg-calib">КАЛИБР</span>' : '<span class="tg-seance">СЕАНС</span>') + '</td>' +
        '<td class="res">' + (r.ok ? 'ВЕРНО' : 'ПРОВАЛ') + (r.note && !r.ok ? ' · ' + esc(r.note) : '') + '</td>' +
        '<td class="react">' + (r.ms ? r.ms + ' мс' : '—') + '</td></tr>';
    }).join('');
    var avgMs = msN ? Math.round(sumMs / msN) : null;
    els.chStat.textContent = CH_LOG.length + ' испыт. · верно ' + okN +
      ' · ср. реакция ' + (avgMs === null ? '—' : avgMs + ' мс');
  }

  /* делегирование кликов по заголовкам столбцов */
  function bindSort(table, state, after) {
    if (!table) return;
    on(table, 'click', function (e) {
      var t = e.target;
      var th = t && t.closest ? t.closest('th[data-sort]') : null;
      if (!th || !table.contains(th)) return;
      var key = th.getAttribute('data-sort');
      if (state.key === key) state.dir = -state.dir;
      else { state.key = key; state.dir = 1; }
      after();
    });
  }

  var CH_SEQ = 0;
  function logChallenge(ok, ms, note) {
    CH_SEQ++;
    CH_LOG.push({
      n: CH_SEQ, kind: CH.kind, calib: CH.calib,
      ok: !!ok, ms: ok ? ms : null, note: note || '', time: ts()
    });
    /* журнал ограничен — при очень длинном обзвоне страница не разрастается (v4.0) */
    if (CH_LOG.length > 500) CH_LOG.shift();
    updateTables();
  }

  /* ============================================================
     ИСПЫТАНИЯ ВНИМАНИЯ
     ============================================================ */
  var CH = { active: false, kind: null, key: null, deadline: 0, timers: [], calib: false, tick: null };

  function clearChTimers() {
    CH.timers.forEach(clearTimeout); CH.timers = [];
    clearInterval(CH.tick); CH.tick = null;
  }

  function kindRoll(calib) {
    /* калибровка — по одному каждого вида в случайном порядке (уже не «три задания») */
    var pool = calib
      ? ['key', 'target', 'hold', 'math', 'seq', 'stroop']
      : ['key', 'target', 'hold', 'math', 'seq', 'stroop', 'key', 'target'];
    var k = ST.lastKind;
    for (var i = 0; i < 6 && k === ST.lastKind; i++) k = pool[rnd(0, pool.length - 1)];
    ST.lastKind = k;
    return k;
  }

  /* темп: первые 3 испытания — щадящие, дальше ускоряется */
  function nextDelay() {
    var early = CH_SEANCE <= 3;
    return rnd(early ? 9000 : 6000, early ? 20000 : 14000);
  }

  function scheduleNext() {
    if (ST.state !== 'running') return;
    clearChTimers();
    CH.timers.push(setTimeout(function () { runChallenge(kindRoll(false), false); }, nextDelay()));
  }

  var STROOP_COLORS = [
    ['СИНИЙ', '#34e7ff'], ['ЗЕЛЁНЫЙ', '#9dff5b'], ['КРАСНЫЙ', '#ff4d6d'], ['ЖЁЛТЫЙ', '#ffb84d']
  ];
  var ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function runChallenge(kind, calib) {
    if (CH.active) return;
    if (ST.state !== 'running' && ST.state !== 'calib') return;
    CH.active = true; CH.kind = kind; CH.calib = !!calib;
    CH.seqReady = false; CH.seqPos = 0; CH.typed = ''; CH._holding = false;
    if (CH._holdT) { clearTimeout(CH._holdT); CH._holdT = null; }
    Monitor.setChallengeActive(true);
    sndTick();

    els.playfield.hidden = false;
    els.chRound.textContent = calib ? ('КАЛИБРОВКА ' + (ST.calibDone + 1) + '/' + CONFIG.calibCount)
                                    : ('ИСПЫТАНИЕ · СЕАНС ' + CH_SEANCE++);
    els.chTarget.hidden = true;
    els.chTarget.classList.remove('small');
    els.stroopRow.hidden = true;
    els.stroopRow.innerHTML = '';
    padReset();

    var to = CH_TIMEOUTS[kind] || CONFIG.chTimeout;
    if (kind === 'hold') { CH.holdMs = rnd(1500, 3000); to = CH.holdMs + 6750; }
    /* калибровка: время на ответ короче на 65% (calibSpeed), плюс прогрессивное
       сжатие — каждые 20 зачётных испытаний ещё на 5% (до −25%),
       «финальный рубеж» на последних 10 испытаниях — ещё на 15% */
    if (calib) {
      to = kind === 'hold' ? CH.holdMs + Math.round(6750 * CONFIG.calibSpeed)
                           : Math.round(to * CONFIG.calibSpeed);
      /* сжатие мягкое: -4% за каждые 25 испытаний, не больше -12% */
      var step = Math.min(12, Math.floor(ST.calibDone / 25) * 4);
      to = Math.round(to * (1 - step / 100));
      /* и не ниже минимума по виду испытания */
      var minTo = CALIB_MIN[kind] || 2400;
      if (kind === 'hold') minTo = CH.holdMs + (CALIB_MIN.hold || 2600);
      if (kind === 'seq') minTo += CH.seqMs || 1400;   /* время показа не в счёт ответа */
      if (to < minTo) to = minTo;
    }
    /* после 6-го испытания сессии таймауты жёстче на 20% */
    if (!calib && CH_SEANCE > 6) to = Math.round(to * 0.8);
    CH.timeout = to;
    CH.deadline = Date.now() + to;

    var taskHtml = '';
    if (kind === 'key') {
      CH.key = ABC[rnd(0, ABC.length - 1)];
      taskHtml = 'НАЖМИТЕ КЛАВИШУ <b>' + CH.key + '</b>';
    } else if (kind === 'hold') {
      taskHtml = 'УДЕРЖИВАЙТЕ <b>ПРОБЕЛ</b> ' + (CH.holdMs / 1000).toFixed(1) + ' СЕК.';
    } else if (kind === 'math') {
      var plus = Math.random() < 0.5;
      var a = rnd(calib ? 11 : 3, calib ? 39 : 19), b = rnd(2, calib ? 19 : 19);
      var hi = Math.max(a, b), lo = Math.min(a, b);
      CH.answer = String(plus ? a + b : hi - lo);
      taskHtml = 'СКОЛЬКО БУДЕТ <b>' + (plus ? hi + ' + ' + lo : hi + ' − ' + lo) + '</b>? вводите цифрами';
    } else if (kind === 'seq') {
      CH.seq = '';
      /* в калибровке на 5 символов и показ короче на 0.5 с */
      CH.seqMs = calib ? 1400 : 1700;
      /* в калибровке столько же символов, сколько в сеансе (было на один больше —
         при сжатом времени это было непроходимо) */
      for (var i = 0; i < 4; i++) CH.seq += ABC[rnd(0, ABC.length - 1)];
      taskHtml = 'ЗАПОМНИТЕ: <b class="big">' + CH.seq.split('').join(' ') + '</b>';
      CH.timers.push(setTimeout(function () {
        if (!CH.active || CH.kind !== 'seq') return;
        CH.seqReady = true;
        updateSeqView();
      }, CH.seqMs));
    } else if (kind === 'stroop') {
      var ni = rnd(0, 3), ii = ni;
      for (var t = 0; t < 5 && ii === ni; t++) ii = rnd(0, 3);
      if (ii === ni) ii = (ni + 1) % 4;
      /* ответ = цвет КРАСКИ, которым написано слово (ii), а не текст слова (ni) —
         так подсказка и проверка наконец совпадают, и это настоящий Струп */
      CH.answerColor = ii;
      taskHtml = 'КЛИКНИТЕ ПО ЦВЕТУ, КОТОРЫМ НАПИСАНО СЛОВО:' +
        '<div class="stroop-word" style="color:' + STROOP_COLORS[ii][1] + '">' + STROOP_COLORS[ni][0] + '</div>';
      els.stroopRow.hidden = false;
      STROOP_COLORS.forEach(function (c, idx) {
        var b2 = document.createElement('button');
        b2.type = 'button'; b2.className = 'ch-btn'; b2.textContent = c[0];
        b2.style.background = c[1];
        on(b2, 'click', function () {
          if (CH.active && CH.kind === 'stroop') endChallenge(idx === CH.answerColor, 'не тот цвет');
        });
        els.stroopRow.appendChild(b2);
      });
    } else { /* target */
      taskHtml = 'КЛИКНИТЕ ПО <b>ЦЕЛИ</b>';
      els.chTarget.hidden = false;
      if (!calib && CH_SEANCE > 4) els.chTarget.classList.add('small');
      moveTarget();
      var mv = calib ? 240 : 480;
      CH.timers.push(setTimeout(moveTarget, mv));
      CH.timers.push(setTimeout(moveTarget, mv * 2));
      CH.timers.push(setTimeout(moveTarget, mv * 3));
    }
    els.chTask.innerHTML = taskHtml;
    buildPad(kind);   /* экранная панель — ответ с телефона без физической клавиатуры */
    /* телефон: если испытание не помещается в экран — подскроллить сразу, не тратя таймер */
    try {
      if (els.playfield.scrollIntoView) {
        var rPf = els.playfield.getBoundingClientRect();
        if (rPf.top < 4 || rPf.bottom > (window.innerHeight || 9999)) {
          els.playfield.scrollIntoView({ block: 'center' });
        }
      }
    } catch (eView) {}

    /* таймер испытания */
    els.chBar.style.transition = 'none';
    els.chBar.style.width = '100%';
    void els.chBar.offsetWidth;
    els.chBar.style.transition = 'width ' + to + 'ms linear';
    els.chBar.style.width = '0%';

    CH.tick = setInterval(function () {
      var left = CH.deadline - Date.now();
      if (left <= 1000 && left > 0 && !CH._warned) { CH._warned = true; sndTick(); }
    }, 500);

    CH.timers.push(setTimeout(function () { endChallenge(false, 'не успел(а)'); }, to));
  }

  function updateSeqView() {
    var entered = CH.seq.slice(0, CH.seqPos);
    var rest = CH.seq.slice(CH.seqPos).split('').join(' ');
    els.chTask.innerHTML = 'ВВЕДИТЕ ПОСЛЕДОВАТЕЛЬНОСТЬ: <b class="big">' +
      entered.split('').join(' ') + (entered ? ' ' : '') + '<span class="dim2">' + rest + '</span></b>';
  }

  function moveTarget() {
    var w = els.arena.clientWidth - 110, h = els.arena.clientHeight - 60;
    els.chTarget.style.left = rnd(6, Math.max(7, w)) + 'px';
    els.chTarget.style.top = rnd(6, Math.max(7, h)) + 'px';
  }

  function endChallenge(ok, note) {
    if (!CH.active) return;
    var reaction = Date.now() - (CH.deadline - CH.timeout);
    /* честная реакция: у «удержания» вычитаем сам интервал удержания,
       у «памяти» — время показа последовательности (1.7 с), иначе цифра вздувается */
    if (CH.kind === 'hold') reaction = Math.max(0, reaction - (CH.holdMs || 0));
    if (CH.kind === 'seq') reaction = Math.max(0, reaction - (CH.seqMs || 1700));
    CH.active = false; CH._warned = false;
    Monitor.setChallengeActive(false);
    clearChTimers();
    els.chTarget.hidden = true;
    els.chTarget.classList.remove('small');
    els.stroopRow.hidden = true;
    els.stroopRow.innerHTML = '';
    padReset();
    els.chBar.style.transition = 'width .3s';
    els.chBar.style.width = '0%';

    if (ok) {
      Monitor.addReaction(reaction);
      sndGood();
      els.chTask.innerHTML = 'ВЕРНО · <b>' + reaction + '</b> мс';
      logChallenge(true, reaction, '');
      if (CH.calib) {
        ST.calibDone++;
        ST.calibTry = 0;
        els.calibStatus.innerHTML = '<span class="good">испытание ' + ST.calibDone + '/' +
          CONFIG.calibCount + ' зачтено</span>';
        if (ST.calibDone >= CONFIG.calibCount) {
          ST.calibrated = true;
          ST.baseReaction = Monitor.avgReaction();  /* запоминаем базу реакции участника */
          if (window.Stats) Stats.count('calib.pass');
          ST.state = 'idle';
          Monitor.setRunning(false);
          els.calibStatus.innerHTML = '<span class="good">✓ КАЛИБРОВКА ПРОЙДЕНА — можно начинать обзвон</span>';
          els.gateText.textContent = 'Калибровка пройдена. Дождитесь команды куратора и нажмите «Начать обзвон».';
          if (ST.authed) els.btnStart.disabled = false;
          toast('Калибровка пройдена', 'good');
          setTimeout(function () { if (ST.state === 'idle') els.playfield.hidden = true; }, 1200);
        } else {
          setTimeout(function () { runChallenge(kindRoll(true), true); }, 650);
        }
      } else {
        els.chTask.innerHTML = 'ВЕРНО · <b>' + reaction + '</b> мс';
        scheduleNext();
      }
    } else {
      Monitor.addMiss(CH.calib);   /* в калибровке провал не штрафуется */
      sndBad();
      els.chTask.innerHTML = 'ПРОВАЛ' + (note ? ' · ' + esc(note) : '') + '';
      logChallenge(false, null, note || '');
      document.querySelector('.playfield').classList.add('shake');
      setTimeout(function () { document.querySelector('.playfield').classList.remove('shake'); }, 400);
      if (CH.calib) {
        /* v6.1: провал в калибровке больше не стирает весь прогресс —
           повторяем то же испытание (после трёх попыток идём дальше) */
        ST.calibFails++;
        ST.calibTry = (ST.calibTry || 0) + 1;
        var kindAgain = CH.kind;
        var giveUp = ST.calibTry >= 3;
        toast(giveUp ? 'Три попытки — идём дальше по калибровке'
                     : 'Испытание провалено — повторяем', 'bad');
        els.calibStatus.innerHTML = '<span class="bad">провал · пройдено ' + ST.calibDone +
          '/' + CONFIG.calibCount + ' · попытка ' + ST.calibTry + '</span>';
        setTimeout(function () {
          if (ST.state !== 'calib') return;
          ST.calibTry = giveUp ? 0 : ST.calibTry;
          els.calibStatus.innerHTML = '<span class="good">продолжаем калибровку · ' +
            ST.calibDone + '/' + CONFIG.calibCount + '</span>';
          runChallenge(giveUp ? kindRoll(true) : kindAgain, true);
        }, 1400);
      } else {
        toast('Испытание провалено! +8 к «читомеряку»', 'bad');
        scheduleNext();
      }
    }
    updateMetrics();
    /* отложенное обновление — применяем, когда испытание закончилось */
    if (upd.deferred && !CH.active) { upd.deferred = false; applyUpdate(); }
    /* события в журнале: сеансовые испытания целиком, калибровка — только итогом */
    if (window.Live && !CH.calib) Live.mark(ok ? 'ok' : 'fail');
    if (CH.calib) {
      if (ST.calibDone >= CONFIG.calibCount) {
        feedAdd({ time: ts(), label: 'Калибровка пройдена · база реакции ' + (ST.baseReaction || Monitor.avgReaction() || '—') + ' мс', sev: 0 });
      }
    } else {
      feedAdd({
        time: ts(),
        label: KIND_NAMES[CH.kind] + ' · ' + (ok ? 'верно, ' + reaction + ' мс' : 'провал' + (note ? ' — ' + note : '')),
        sev: ok ? 0 : 2
      });
    }
    saveState();
  }

  var CH_SEANCE = 1;

  /* ---------- ввод испытаний ----------
     Общий путь: физическая клавиатура (keydown) и экранная панель на телефоне
     (buildPad) сводятся к одному codePress(code) — работает и с русской раскладкой. */
  function codePress(code) {
    if (!CH.active) return;

    if (CH.kind === 'key') {
      var want = /^[A-Z]$/.test(CH.key) ? 'Key' + CH.key : 'Digit' + CH.key;
      if (code === want) { endChallenge(true, ''); return; }
      if (/^(Key[A-Z]|Digit[0-9])$/.test(code)) { endChallenge(false, 'не та клавиша'); }
      return;
    }

    if (CH.kind === 'seq') {
      if (!CH.seqReady) return;
      if (/^(Key[A-Z]|Digit[0-9])$/.test(code)) {
        var sc = code.indexOf('Key') === 0 ? code.slice(3) : code.slice(5);
        if (sc === CH.seq[CH.seqPos]) {
          CH.seqPos++;
          if (CH.seqPos >= CH.seq.length) { endChallenge(true, ''); return; }
          updateSeqView();
        } else {
          endChallenge(false, 'неверный символ');
        }
      }
      return;
    }

    if (CH.kind === 'math') {
      if (/^Digit[0-9]$/.test(code)) {
        var dg = code.slice(5);
        if (CH.answer[CH.typed.length] === dg) {
          CH.typed += dg;
          els.chTask.innerHTML = 'ОТВЕТ: <b>' + CH.typed + '</b> / ' + CH.answer;
          if (CH.typed === CH.answer) endChallenge(true, '');
        } else {
          endChallenge(false, 'неверная цифра');
        }
      }
      return;
    }
  }

  function holdDown() {
    if (!CH.active || CH.kind !== 'hold' || CH._holding) return;
    CH._holding = true;
    els.chTask.innerHTML = 'ДЕРЖИТЕ…';
    CH._holdT = setTimeout(function () { CH._holding = false; endChallenge(true, ''); }, CH.holdMs || CONFIG.holdMs);
  }
  function holdUp() {
    if (CH.active && CH.kind === 'hold' && CH._holding) {
      clearTimeout(CH._holdT); CH._holding = false;
      endChallenge(false, 'отпустили слишком рано');
    }
  }

  on(document, 'keydown', function (e) {
    if (!CH.active) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if (CH.kind === 'hold' && e.code === 'Space') { e.preventDefault(); holdDown(); return; }
    codePress(e.code);
  });
  on(document, 'keyup', function (e) {
    if (e.code === 'Space') holdUp();
  });

  /* ---------- экранная панель (телефон/планшет: ответ без физической клавиатуры) ---------- */
  function padReset() { els.chPad.hidden = true; els.chPad.innerHTML = ''; }

  function buildPad(kind) {
    padReset();
    if (kind === 'hold') {
      var hb = document.createElement('button');
      hb.type = 'button'; hb.className = 'hold-btn'; hb.textContent = 'УДЕРЖИВАЙТЕ';
      var down = function (ev) { ev.preventDefault(); holdDown(); };
      var up = function (ev) { ev.preventDefault(); holdUp(); };
      on(hb, 'pointerdown', down);
      on(hb, 'pointerup', up);
      on(hb, 'pointercancel', up);
      /* уход курсора = отпустили, но НЕ для касания: на телефоне палец может
         немного сдвинуться — касание держится до touchend/touchcancel */
      on(hb, 'pointerleave', function (ev) {
        if (ev && ev.pointerType === 'touch') return;
        up(ev);
      });
      on(hb, 'touchstart', down, { passive: false });
      on(hb, 'touchend', up, { passive: false });
      on(hb, 'touchcancel', up, { passive: false });
      els.chPad.appendChild(hb);
      els.chPad.hidden = false;
      return;
    }
    if (kind !== 'key' && kind !== 'math' && kind !== 'seq') return;
    var chars = kind === 'math' ? '0123456789'.split('') : ABC.split('');
    chars.forEach(function (ch) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pad-key'; b.textContent = ch;
      var code = /^[A-Z]$/.test(ch) ? 'Key' + ch : 'Digit' + ch;
      on(b, 'click', function () { codePress(code); });
      els.chPad.appendChild(b);
    });
    els.chPad.hidden = false;
  }
  on(els.chTarget, 'click', function () { if (CH.active && CH.kind === 'target') endChallenge(true, ''); });

  /* ============================================================
     СЕССИЯ
     ============================================================ */
  function elapsed() { return ST.startedAt + (ST.state === 'running' ? Date.now() - ST.runSince : 0); }

  function startSession() {
    if (ST.state !== 'idle') { toast('Сейчас это недоступно', 'bad'); return; }
    if (!ST.authed) { toast('Сначала войдите в пульт куратора', 'bad'); return; }
    if (!ST.calibrated) { toast('Сначала пройдите калибровку', 'bad'); return; }
    ST.state = 'running';
    ST.startedAt = 0; ST.runSince = Date.now();
    ST.sessionStartAt = Date.now();
    ST.sessionId = 'OBZ-' + Math.random().toString(16).slice(2, 6).toUpperCase() + '-' + Date.now().toString(36).slice(-4).toUpperCase();
    els.sessionId.textContent = 'сессия ' + ST.sessionId;
    els.sessionStart.textContent = 'старт ' + fmtClock(ST.sessionStartAt);
    setBadge('идёт', 'badge-run');
    updateWatermark();
    /* база реакции — результат калибровки (хранится отдельно, переживает итоги) */
    var base = ST.baseReaction || Monitor.avgReaction();
    if (base) Monitor.setBaseline(base);
    /* журнал: остаётся калибровка текущей загрузки, прошлые сеансы уходят */
    CH_LOG = CH_LOG.filter(function (r) { return r.calib; });
    Monitor.reset();
    Monitor.setRunning(true);
    ST.relockBase = 0;
    els.gate.hidden = true;
    els.playfield.hidden = false;
    els.partPanel.hidden = false;
    els.btnPauseSelf.textContent = '⏸ Пауза';
    els.btnStart.disabled = true; els.btnPause.disabled = false; els.btnEnd.disabled = false;
    if (els.chkFsReq.checked) goFullscreen();
    feedAdd({ time: ts(), label: 'Обзвон начат · сессия ' + ST.sessionId, sev: 0 });
    if (window.Stats) Stats.count('session.start');
    if (window.Audit) Audit.log('session.start', 'сессия ' + ST.sessionId);
    toast('Обзвон начат. Испытания будут появляться каждые 10–25 секунд', 'good');
    beep(660, 200, 'sine', .05);
    CH_SEANCE = 1;
    /* живой график сессии (v4.0) */
    if (window.Live) { Live.reset(); Live.start(); }
    scheduleNext();
    saveState();
  }

  function pauseSession() {
    if (ST.state !== 'running') return;
    ST.startedAt += Date.now() - ST.runSince;   /* зафиксировать пройденный отрезок */
    ST.state = 'paused';
    Monitor.setRunning(false);
    if (window.Live) Live.stop();
    clearChTimers(); CH.active = false; Monitor.setChallengeActive(false);
    els.chTarget.hidden = true;
    setBadge('пауза', 'badge-pause');
    els.pauseOverlay.hidden = false;
    els.btnPause.disabled = true; els.btnResume.disabled = false;
    els.btnPauseSelf.textContent = '▶ Продолжить';
    els.btnPauseSelf.disabled = false;
    if (window.Audit) Audit.log('session.pause', 'пауза · сессия ' + ST.sessionId);
    saveState();
  }

  function resumeSession() {
    if (ST.state !== 'paused') return;
    ST.state = 'running';
    ST.runSince = Date.now();
    Monitor.setRunning(true);
    if (window.Live) Live.start();
    els.pauseOverlay.hidden = true;
    setBadge('идёт', 'badge-run');
    els.btnPause.disabled = false;
    els.btnPauseSelf.textContent = '⏸ Пауза';
    feedAdd({ time: ts(), label: 'Обзвон продолжен', sev: 0 });
    if (window.Audit) Audit.log('session.resume', 'продолжение · сессия ' + ST.sessionId);
    scheduleNext();
    saveState();
  }

  /* ---------- блокировка ---------- */
  function shouldLock() {
    if (ST.state !== 'running') return false;
    var c = Monitor.cheatPercent();
    /* после разблокировки блокируем снова только при новых +10% */
    return c >= ST.threshold && c >= (ST.relockBase || 0) + 10;
  }

  function lockSession() {
    if (ST.state !== 'running') return;
    ST.startedAt += Date.now() - ST.runSince;   /* время не теряется при блокировке */
    ST.state = 'locked';
    Monitor.setRunning(false);
    clearChTimers(); CH.active = false; Monitor.setChallengeActive(false);
    els.chTarget.hidden = true;
    setBadge('блокировка', 'badge-lock');
    sndAlarm();
    if (window.Audit) Audit.log('session.lock', 'автоблокировка · читомеряк ' + Monitor.cheatPercent() + '%');
    var v = Monitor.state.viol.slice(-3).map(function (x) { return '· ' + x.label; }).join('\n');
    els.lockText.textContent = '«Читомеряк» достиг ' + Monitor.cheatPercent() + '% (порог ' + ST.threshold + '%). Последние события:\n' + v;
    els.lockText.style.whiteSpace = 'pre-line';
    els.lockOverlay.hidden = false;
    document.body.classList.add('shake');
    setTimeout(function () { document.body.classList.remove('shake'); }, 400);
    if (window.FX) FX.flash('#ff4d6d');
    saveState();
  }

  function endSession() {
    if (['running', 'paused', 'locked'].indexOf(ST.state) < 0) return;
    var wasState = ST.state;
    if (ST.state === 'running') ST.startedAt += Date.now() - ST.runSince;  /* итоговая длительность */
    ST.state = 'ended';
    Monitor.setRunning(false);
    if (window.Live) Live.stop();
    updateWatermark();
    clearChTimers(); CH.active = false; Monitor.setChallengeActive(false);
    els.pauseOverlay.hidden = true; els.lockOverlay.hidden = true;
    setBadge('завершён', 'badge-end');
    els.partPanel.hidden = true;
    els.btnStart.disabled = true; els.btnPause.disabled = true; els.btnEnd.disabled = true; els.btnResume.disabled = true;

    var cheat = Monitor.cheatPercent();
    var verdict, vcls;
    if (cheat < 25) { verdict = 'ЗАЧЁТ'; vcls = 'v-ok'; }
    else if (cheat < ST.threshold) { verdict = 'СОМНИТЕЛЬНО'; vcls = 'v-mid'; }
    else { verdict = 'НЕЗАЧЁТ'; vcls = 'v-bad'; }
    if (wasState === 'locked') { verdict = 'НЕЗАЧЁТ'; vcls = 'v-bad'; }

    els.sumTag.textContent = 'ИТОГ ОБЗВОНА · ' + (ST.sessionId || '—');
    els.sumVerdict.textContent = verdict;
    els.sumVerdict.className = vcls;

    /* итог обзвона уходит в накопительную среднюю концентрацию */
    var totAvg = recordSessionConc();

    var S = Monitor.state;
    var ar = Monitor.avgReaction();
    var ms = memStats();
    var rows = [
      ['Длительность', fmt(elapsed())],
      ['Версия системы', 'v' + CONFIG.appVersion],
      ['Начало сессии', ST.sessionStartAt ? fmtClock(ST.sessionStartAt) : '—'],
      ['Концентрация', Monitor.concentration() + '%'],
      ['Читомеряк', cheat + '%'],
      ['В фокусе', Monitor.focusRatio() + '%'],
      ['Смены вкладок', S.tabSwitches],
      ['Срывы фокуса', S.focusLosses],
      ['Экраны', S.screens],
      ['Провалы испытаний', S.missChallenges],
      ['Простой', S.idleHits],
      ['Попытки копирования', S.copyAttempts],
      ['Попытки DevTools', S.blockedKeys + (S.devtools ? ' +' : '')],
      ['Попытки перезагрузки', S.reloadTries],
      ['Средняя реакция', ar === null ? '—' : ar + ' мс'],
      ['Средняя концентрация (всего)', totAvg + '%'],
      ['Память страницы', ms.pageMB !== null ? ms.pageMB.toFixed(1) + ' МБ' : 'н/д'],
      ['ОЗУ ПК', ms.totalRAM ? ms.totalRAM + ' ГБ' : 'н/д'],
      ['Нарушений всего', S.viol.length]
    ];
    els.sumTable.innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(String(r[1])) + '</td></tr>';
    }).join('');

    /* результаты: таблица метрик и журнал испытаний финализируются */
    updateTables();
    /* фишки */
    var achList = renderAch(computeAch());

    /* история обзвонов (v4.0) — запись в архив для сравнения */
    var seanceLog = CH_LOG.filter(function (r) { return !r.calib; });
    if (window.Archive) {
      try {
        Archive.add({
          id: ST.sessionId || ('S' + Date.now().toString(36).toUpperCase()),
          startedAt: ST.sessionStartAt || Date.now(),
          endedAt: Date.now(),
          duration: elapsed(),
          conc: Monitor.concentration(),
          cheat: cheat,
          focus: Monitor.focusRatio(),
          reaction: ar,
          verdict: verdict,
          challenges: seanceLog.length,
          ok: seanceLog.filter(function (r) { return r.ok; }).length,
          viol: S.viol.length,
          chips: achList.map(function (c) { return c[1]; }),
          device: (Monitor.detect() || {}).kind || ''
        });
      } catch (eArch) {
        /* ошибка отрисовки архива не должна ломать итоги обзвона */
      }
    }

    els.sumOverlay.hidden = false;
    if (verdict === 'ЗАЧЁТ') sndGood(); else sndBad();
    toast('Средняя концентрация обновлена: ' + totAvg + '%', 'good', 4200);
    feedAdd({ time: ts(), label: 'Обзвон завершён · вердикт: ' + verdict + ' · ср. концентрация ' + totAvg + '% · фишек: ' + achList.length, sev: verdict === 'ЗАЧЁТ' ? 0 : 2 });
    if (window.Audit) Audit.log('session.end', 'вердикт ' + verdict + ' · концентрация ' + totAvg + '%');
    if (window.Stats) Stats.count('session.end');
    /* авто-выгрузка отчёта (политика autoReport) */
    if (CONFIG.policies.autoReport) {
      try { setTimeout(function () { downloadReport(); }, 1200); } catch (eAuto) {}
    }
    clearState();
  }

  function resetAll() {
    ST.state = 'idle'; ST.startedAt = 0; ST.calibDone = 0; ST.relockBase = 0;
    ST.calibFails = 0; ST.hadReload = false;
    /* монитор НЕ сбрасываем: финальные цифры концентрации/читомеряка остаются
       на экране до старта нового обзвона (новый сброс — в startSession) */
    Monitor.setRunning(false);
    clearChTimers(); CH.active = false; Monitor.setChallengeActive(false);
    clearState();
    els.sessionId.textContent = 'сессия — …';
    els.sessionStart.textContent = 'старт — не начат';
    els.sessionTimer.textContent = '00:00';
    setBadge('не начат', 'badge-idle');
    els.gate.hidden = false; els.playfield.hidden = true;
    els.partPanel.hidden = true;
    els.pauseOverlay.hidden = true; els.lockOverlay.hidden = true; els.sumOverlay.hidden = true;
    els.btnStart.disabled = !(ST.authed && ST.calibrated);
    els.btnPause.disabled = true; els.btnEnd.disabled = true; els.btnResume.disabled = true;
    FEED = [];
    els.signalList.innerHTML = '<li class="feed-empty">событий нет</li>';
    els.feedCount.textContent = '0';
    updateWatermark();
    updateMetrics();
    if (window.Audit) Audit.log('session.reset', 'сброс сессии');
    toast('Сессия сброшена', 'good');
  }

  function ts() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ---------- средняя концентрация по всем обзвонам (накапливается) ---------- */
  var TOT_KEY = 'obzvon_v2_totals';
  var memTotals = null;
  function loadTotals() {
    if (memTotals) return memTotals;
    try { memTotals = JSON.parse(localStorage.getItem(TOT_KEY)) || {}; } catch (e) { memTotals = {}; }
    return memTotals;
  }
  function saveTotals(t) {
    memTotals = t;
    try { localStorage.setItem(TOT_KEY, JSON.stringify(t)); } catch (e) {}
  }

  function updateTotalConcUI() {
    var tot = loadTotals();
    if (!tot.sessions) {
      els.totalConc.textContent = '—';
      els.concTrend.textContent = 'первый обзвон';
      els.concTrend.className = 'trend flat';
      return;
    }
    els.totalConc.textContent = tot.avg + '%';
    var best = (tot.hist || []).reduce(function (m, v) { return v > m ? v : m; }, 0);
    var bestTxt = best ? ' · рекорд ' + best + '%' : '';
    if (tot.prevAvg === null || tot.prevAvg === undefined) {
      els.concTrend.textContent = tot.sessions + ' обзвон(ов)' + bestTxt;
      els.concTrend.className = 'trend flat';
    } else {
      var diff = tot.avg - tot.prevAvg;
      var arrow = diff > 0 ? '▲' : (diff < 0 ? '▼' : '—');
      els.concTrend.textContent = arrow + ' ' + (diff > 0 ? '+' : '') + diff + ' к прошлому · ' + tot.sessions + ' обз.' + bestTxt;
      els.concTrend.className = 'trend ' + (diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat'));
    }
  }

  /* засчитать итог текущего обзвона в общую статистику */
  function recordSessionConc() {
    var tot = loadTotals();
    var hist = tot.hist || [];
    var cur = Monitor.concentration();
    hist.push(cur);
    if (hist.length > 20) hist = hist.slice(-20);
    var avg = Math.round(hist.reduce(function (a, b) { return a + b; }, 0) / hist.length);
    saveTotals({
      sessions: (tot.sessions || 0) + 1,
      avg: avg,
      prevAvg: tot.sessions ? tot.avg : null,
      hist: hist,
      last: cur
    });
    updateTotalConcUI();
    var card = els.totalConc.closest('.metric');
    if (card) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
    return avg;
  }

  /* ---------- фишки (достижения за обзвон) ---------- */
  function computeAch() {
    var S = Monitor.state;
    var tot = loadTotals();
    var chOk = CH_LOG.filter(function (r) { return r.ok; }).length;
    var seanceLog = CH_LOG.filter(function (r) { return !r.calib; });
    var seance = seanceLog.length;
    var okSeance = seanceLog.filter(function (r) { return r.ok; }).length;
    var msAll = CH_LOG.filter(function (r) { return r.ok && r.ms; }).map(function (r) { return r.ms; });
    var fastest = msAll.length ? Math.min.apply(null, msAll) : null;
    var ar = Monitor.avgReaction();
    var conc = Monitor.concentration();

    /* серия верных подряд (только сеанс) */
    var maxStreak = 0, curStreak = 0;
    seanceLog.forEach(function (r) {
      if (r.ok) { curStreak++; if (curStreak > maxStreak) maxStreak = curStreak; }
      else curStreak = 0;
    });
    /* верность по видам испытаний */
    function kindStats(kind) {
      var all = seanceLog.filter(function (r) { return r.kind === kind; });
      var okN = all.filter(function (r) { return r.ok; }).length;
      return { n: all.length, allOk: all.length > 0 && okN === all.length };
    }
    var kSeq = kindStats('seq'), kStroop = kindStats('stroop'),
        kMath = kindStats('math'), kKey = kindStats('key'),
        kTarget = kindStats('target'), kHold = kindStats('hold');

    var list = [];
    /* --- старые фишки --- */
    if (fastest !== null && fastest < 350) list.push(['⚡', 'СКОРОСТНОЙ', fastest + ' мс', 'gold']);
    if (S.missChallenges === 0 && okSeance >= 5) list.push(['🎯', 'ТОЧНЫЙ', okSeance + '/' + seance + ' верно', '']);
    if (Monitor.focusRatio() >= 95) list.push(['🛡', 'ЖЕЛЕЗНЫЙ ФОКУС', Monitor.focusRatio() + '%', 'cool']);
    if (S.viol.length === 0) list.push(['✨', 'ЧИСТЫЙ ЛИСТ', '0 нарушений', 'gold']);
    if (seance >= 10) list.push(['🏃', 'МАРАФОН', seance + ' испытаний', '']);
    if (seance >= 20) list.push(['🔥', 'РАСКУСОТКА', seance + ' испытаний', 'gold']);
    if (S.tabSwitches === 0 && S.focusLosses === 0) list.push(['😌', 'СПОКОЙСТВИЕ', 'вкладок не менял', 'cool']);
    if (S.viol.length >= 3 && chOk >= 3) {
      list.push(['💪', 'БОЕВОЙ ДУХ', 'дошёл до конца', '']);
    }
    /* --- новые фишки --- */
    if (maxStreak >= 6) list.push(['🔗', 'СЕРИЯ', maxStreak + ' верно подряд', 'gold']);
    if (kSeq.n >= 2 && kSeq.allOk) list.push(['🧠', 'ФОТОПАМЯТЬ', kSeq.n + '/' + kSeq.n + ' память верно', 'gold']);
    if (kStroop.n >= 3 && kStroop.allOk) list.push(['🎨', 'СТРУП-МАСТЕР', kStroop.n + '/' + kStroop.n + ' струп верно', '']);
    if (kMath.n >= 3 && kMath.allOk) list.push(['🔢', 'ЧИСЛОВОЙ ГУРУ', kMath.n + '/' + kMath.n + ' примеров верно', '']);
    if (kKey.n >= 4 && kKey.allOk) list.push(['⌨️', 'МАСТЕР КЛАВИШ', kKey.n + '/' + kKey.n + ' клавиш верно', 'cool']);
    var allKinds = [kSeq, kStroop, kMath, kKey, kTarget, kHold];
    var fullSet = allKinds.every(function (k) { return k.n >= 1 && k.allOk; });
    if (fullSet) list.push(['🧩', 'ПОЛНЫЙ НАБОР', 'все 6 видов верно', 'gold']);
    if (ar !== null && ar < 450 && seance >= 5) list.push(['🧊', 'ЛЁД', 'ср. реакция ' + ar + ' мс', 'cool']);
    if (conc >= 99 && seance >= 5) list.push(['💎', 'ИДЕАЛЬНЫЙ', conc + '% концентрация', 'gold']);
    else if (conc >= 90 && seance >= 5) list.push(['🥇', 'ЧЕМПИОН', conc + '% концентрация', 'cool']);
    if (ST.calibFails === 0 && seance >= 1) list.push(['🛠', 'ЧИСТАЯ КАЛИБРОВКА', 'калибровка без ошибок', 'cool']);
    if (ST.hadReload && seance >= 3) list.push(['🔁', 'ВОЗВРАЩЕНИЕ', 'дошёл после перезагрузки', '']);
    if ((tot.sessions || 0) >= 10) list.push(['🏅', 'ВЕТЕРАН', (tot.sessions || 0) + ' обзвон(ов)', 'gold']);

    /* --- анти-списывание: фишки-достижения --- */
    var copyViol = S.viol.filter(function (v) {
      return v.type === 'copy' || v.type === 'shot';
    }).length;
    if (seance >= 5 && S.copyAttempts === 0 && copyViol === 0) {
      list.push(['🙅', 'РУКИ ПРОЧЬ', '0 попыток списать', 'guard']);
    }
    if (S.copyAttempts > 0) {
      list.push(['📋', 'БУФЕР ПОД ЗАЩИТОЙ', S.copyAttempts + ' попыток отбито', 'guard']);
    }
    var shotViol = S.viol.filter(function (v) { return v.type === 'shot'; }).length;
    if (shotViol > 0) {
      list.push(['📸', 'СНИМКИ ОТБИТЫ', shotViol + ' снимков очищено', 'guard']);
    }
    if (seance >= 5 && !S.devtools) {
      list.push(['🕵', 'БЕЗ СЛЕДОВ', 'посторонних окон не было', 'guard']);
    }
    if (S.blockedKeys >= 3) {
      list.push(['⌨️', 'КЛАВИШИ ОТБИТЫ', S.blockedKeys + ' сочетаний заблокировано', 'cool']);
    }
    if (seance >= 5 && !S.reloadTries) {
      list.push(['🔒', 'СТАЛЬНОЙ КОРПУС', 'перезагрузок не было', 'guard']);
    }

    /* --- v4.0: защита и контроль --- */
    if (seance >= 5 && !S.automation && !S.webrtc && !S.clockTamper && !S.secondTab) {
      list.push(['🛰', 'БЕЗ ТЕЛЕМЕТРИИ', 'захватов и автотестов не было', 'guard']);
    }
    if (S.blockedKeys >= 10) {
      list.push(['🧱', 'КИРПИЧНАЯ СТЕНА', S.blockedKeys + ' сочетаний отбито', 'cool']);
    }
    if (S.screens === 1 && seance >= 5) {
      list.push(['👁', 'ОДИН ЭКРАН', 'второго монитора не было', 'guard']);
    }
    if (ST.integrityOk && seance >= 3) {
      list.push(['🔐', 'ЦЕЛОСТНОСТЬ', 'данные сессии под подписью', 'gold']);
    }

    if (!list.length) list.push(['🥊', 'ЕСТЬ К ЧЕМУ СТРЕМИТЬСЯ', 'попробуйте ещё раз', 'muted']);
    return list;
  }

  function renderAch(list) {
    els.achRow.innerHTML = list.map(function (c, i) {
      return '<span class="chip ' + c[3] + '" style="animation-delay:' + (i * 70) + 'ms">' +
        c[0] + ' ' + c[1] + ' <i>' + esc(c[2]) + '</i></span>';
    }).join('');
    /* фишки копятся в общей статистике */
    var tot = loadTotals();
    var ach = tot.ach || {};
    list.forEach(function (c) { ach[c[1]] = (ach[c[1]] || 0) + 1; });
    tot.ach = ach;
    saveTotals(tot);
    return list;
  }

  /* ---------- полный экран ---------- */
  function goFullscreen() {
    var el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(function () {});
    }
  }
  on(document, 'fullscreenchange', function () {
    if (!document.fullscreenElement && ST.state === 'running' && els.chkFsReq.checked) {
      Monitor.penalty('Выход из полноэкранного режима', 3);
    }
  });

  /* ---------- защита от перезагрузки ---------- */

  /* ---------- подпись сохранённых данных сессии (v4.0) ----------
     Секрет выводится из хеша кода куратора, поэтому в исходниках его
     нет в открытом виде. Подпись защищает от правки localStorage:
     «почистить» штрафы в хранилище больше не получится. */
  /* Секрет подписи состояния (v6.0): свой на каждое устройство.
     Раньше он выводился из кода куратора — значит, попадал в репозиторий
     и позволял подделать сохранённое состояние сессии. */
  var SECRET_KEY = 'obzvon_v2_secret';
  function deviceSecret() {
    var s = '';
    try { s = localStorage.getItem(SECRET_KEY) || ''; } catch (e) {}
    if (!s || s.length < 32) {
      s = bytesToHex(randomBytes(32));
      try { localStorage.setItem(SECRET_KEY, s); } catch (e) {}
    }
    return s;
  }
  function stateSecret() {
    return sha256hex(deviceSecret() + '|obzvon|v6|integrity|' + CONFIG.appVersion);
  }
  function statePayload() {
    return {
      state: ST.state, sessionId: ST.sessionId, elapsed: elapsed(),
      sessionStartAt: ST.sessionStartAt,
      score: Monitor.state.score, viol: Monitor.state.viol,
      tabSwitches: Monitor.state.tabSwitches, focusLosses: Monitor.state.focusLosses,
      idleHits: Monitor.state.idleHits, missChallenges: Monitor.state.missChallenges,
      reactions: Monitor.state.reactions, screens: Monitor.state.screens,
      chLog: CH_LOG, baseReaction: ST.baseReaction,
      feed: FEED.slice(-40),
      updatedAt: Date.now()
    };
  }
  function pickPayload(d) {
    return {
      state: d.state, sessionId: d.sessionId, elapsed: d.elapsed,
      sessionStartAt: d.sessionStartAt,
      score: d.score, viol: d.viol,
      tabSwitches: d.tabSwitches, focusLosses: d.focusLosses,
      idleHits: d.idleHits, missChallenges: d.missChallenges,
      reactions: d.reactions, screens: d.screens,
      chLog: d.chLog, baseReaction: d.baseReaction,
      feed: d.feed,
      updatedAt: d.updatedAt
    };
  }
  function signPayload(p) { return sha256hex(JSON.stringify(p) + '|' + stateSecret()); }

  function saveState() {
    if (CONFIG.storageFallback) return;
    if (['running', 'paused', 'locked'].indexOf(ST.state) < 0) return;
    try {
      var p = statePayload();
      p.sig = signPayload(p);
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(p));
    } catch (e) {}
  }
  function clearState() { try { localStorage.removeItem(CONFIG.storageKey); } catch (e) {} }

  function restoreState() {
    var raw = null;
    try { raw = localStorage.getItem(CONFIG.storageKey); } catch (e) {}
    if (!raw) return;
    var d = null;
    try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || Date.now() - (d.updatedAt || 0) > 60000) { clearState(); return; }
    if (d.state !== 'running') { clearState(); return; }

    /* подпись не совпала — данные сессии правили вручную */
    var tampered = d.sig !== signPayload(pickPayload(d));

    /* обзвон шёл и страницу перезагрузили — это нарушение */
    ST.state = 'running';
    ST.hadReload = true;   /* для фишки «ВОЗВРАЩЕНИЕ» */
    /* права НЕ выдаются: после перезагрузки панель куратора снова закрыта,
       вход — только по коду (v5.0 закрывает дыру с выдачей прав) */
    ST.authed = false; ST.role = null; ST.calibrated = true;
    ST.sessionId = d.sessionId;
    ST.sessionStartAt = d.sessionStartAt || 0;
    ST.startedAt = d.elapsed || 0; ST.runSince = Date.now();
    ST.baseReaction = d.baseReaction || null;
    CH_LOG = d.chLog || [];
    CH_SEQ = CH_LOG.length ? CH_LOG[CH_LOG.length - 1].n : 0;
    FEED = d.feed || [];
    els.signalList.innerHTML = '';
    feedRebuild();
    els.authRow.hidden = false; els.ctrlRow.hidden = true; els.authHint.hidden = false;
    els.sessionId.textContent = 'сессия ' + ST.sessionId;
    els.sessionStart.textContent = ST.sessionStartAt ? 'старт ' + fmtClock(ST.sessionStartAt) + ' (восстановлена)' : 'старт — неизвестен';
    setBadge('идёт', 'badge-run');
    updateWatermark();
    els.gate.hidden = true; els.playfield.hidden = false; els.partPanel.hidden = false;
    els.btnPauseSelf.textContent = '⏸ Пауза';
    els.btnStart.disabled = true; els.btnPause.disabled = true; els.btnEnd.disabled = true;
    /* состояние монитора восстанавливаем через API — наружу отдаётся копия */
    Monitor.restore({
      score: d.score || 0, viol: d.viol || [], tabSwitches: d.tabSwitches || 0,
      focusLosses: d.focusLosses || 0, idleHits: d.idleHits || 0,
      missChallenges: d.missChallenges || 0, reactions: d.reactions || [], screens: d.screens || 1
    });
    Monitor.setRunning(true);
    /* обновление, применённое системой, — не перезагрузка, наказания нет */
    var cleanUpdate = false;
    try {
      cleanUpdate = !!sessionStorage.getItem('obzvon_v2_clean_update');
      sessionStorage.removeItem('obzvon_v2_clean_update');
    } catch (eCU) {}
    if (cleanUpdate) {
      feedAdd({ time: ts(), label: 'Применено фоновое обновление системы — сессия продолжена', sev: 0 });
      toast('Сайт обновлён до версии ' + CONFIG.appVersion + ' — обзвон продолжается', 'good', 5000);
    } else {
      Monitor.addReloadGuardPenalty();
      feedAdd({ time: ts(), label: 'Сессия восстановлена после перезагрузки (+6)', sev: 2 });
      toast('Обнаружена перезагрузка страницы во время обзвона! +6 к «читомеряку»', 'bad', 5200);
    }
    if (tampered) {
      ST.integrityOk = false;
      Monitor.addTamper('Подмена сохранённых данных сессии (подпись не совпала)', 20);
      threat('tamper', 'Подмена сохранённых данных сессии');
      feedAdd({ time: ts(), label: 'Подмена данных сессии — подпись не совпала (+20)', sev: 2 });
      toast('Обнаружена подмена данных сессии! +20 к «читомеряку»', 'bad', 6000);
    }
    if (window.Live) { Live.reset(); Live.start(); }
    scheduleNext();
    updateMetrics();
  }

  on(window, 'beforeunload', function () {
    if (['running', 'paused', 'locked'].indexOf(ST.state) >= 0) {
      saveState();
      return 'Обзвон ещё не завершён!';
    }
  });
  every(2500, saveState);

  /* ---------- отчёт ---------- */
  /* отчёт собирается отдельно от выгрузки (v6.0): так его можно
     получить и проверить, не скачивая файл */
  function buildReport() {
    var data = Monitor.report({ session: ST.sessionId, verdict: els.sumVerdict.textContent || null });
    data.appVersion = 'v' + CONFIG.appVersion;
    data.totals = loadTotals();
    data.challenges = CH_LOG.slice();
    data.achievements = (loadTotals().ach) || {};
    data.sessionStartedAt = ST.sessionStartAt ? new Date(ST.sessionStartAt).toISOString() : null;
    data.memory = memStats();
    data.role = ST.role;
    data.policies = CONFIG.policies;
    data.audit = window.Audit ? Audit.report() : null;
    data.threats = THREATS.slice(0, 20);
    data.stats = window.Stats ? Stats.snapshot() : null;
    /* контрольная сумма тела отчёта: видно, что отчёт не правили */
    data.sha256 = sha256hex(JSON.stringify(data));
    return data;
  }
  function downloadReport() {
    var data = buildReport();
    if (window.Live) data.live = Live.data();
    if (window.Archive) data.history = Archive.list();
    if (window.Health) {
      var hl = Health.last();
      data.health = { score: hl ? hl.score : null, errors: Health.errors().length };
    }
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'obzvon-report-' + (ST.sessionId || 'no-session') + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- экспорт / импорт статистики (v3.8) ---------- */
  function exportStats() {
    var tot = loadTotals();
    var data = {
      app: 'obzvon-stats',
      v: CONFIG.appVersion,
      exportedAt: new Date().toISOString(),
      totals: {
        sessions: tot.sessions || 0,
        avg: tot.avg || 0,
        prevAvg: (tot.prevAvg === undefined ? null : tot.prevAvg),
        hist: (tot.hist || []).slice(),
        last: (tot.last === undefined ? null : tot.last),
        ach: tot.ach || {}
      }
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'obzvon-stats-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Статистика экспортирована в JSON', 'good');
  }

  function importStats(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      var d = null;
      try { d = JSON.parse(String(fr.result)); } catch (e) { d = null; }
      var t = d && (d.app === 'obzvon-stats' ? d.totals : null);
      if (!t || typeof t !== 'object' || typeof t.sessions !== 'number') {
        toast('Файл не похож на экспорт статистики ОБЗВОН', 'bad');
        return;
      }
      var hist = Array.isArray(t.hist) ? t.hist.filter(function (v) { return typeof v === 'number'; }).slice(-20) : [];
      var avg = typeof t.avg === 'number' ? t.avg :
        (hist.length ? Math.round(hist.reduce(function (a, b) { return a + b; }, 0) / hist.length) : 0);
      var ach = (t.ach && typeof t.ach === 'object') ? t.ach : {};
      saveTotals({
        sessions: Math.max(0, t.sessions | 0),
        avg: avg,
        prevAvg: (t.prevAvg === undefined ? null : t.prevAvg),
        hist: hist,
        last: (typeof t.last === 'number' ? t.last : null),
        ach: ach
      });
      updateTotalConcUI();
      toast('Статистика импортирована: обзвонов — ' + (loadTotals().sessions || 0), 'good');
      feedAdd({ time: ts(), label: 'Импорт статистики из JSON', sev: 0 });
    };
    fr.onerror = function () { toast('Не удалось прочитать файл', 'bad'); };
    fr.readAsText(file);
  }

  if (els.btnExportStats) on(els.btnExportStats, 'click', exportStats);
  if (els.btnImportStats) on(els.btnImportStats, 'click', function () { els.importFile.click(); });
  if (els.importFile) on(els.importFile, 'change', function () {
    var f = els.importFile.files && els.importFile.files[0];
    importStats(f);
    els.importFile.value = '';
  });

  /* ============================================================
     ПУЛЬТ КУРАТОРА
     ============================================================ */
  on(els.curatorHead, 'click', function () {
    var open = els.curatorBody.hidden;
    els.curatorBody.hidden = !open;
    els.curatorCaret.classList.toggle('open', open);
  });

  on(els.btnAuth, 'click', function () { doAuth('curator'); });
  if (els.btnAuthAdmin) on(els.btnAuthAdmin, 'click', function () { doAuth('admin'); });
  on(els.passInput, 'keydown', function (e) { if (e.key === 'Enter') doAuth('curator'); });

  /* ---------- коды доступа (v5.0) ----------
     У каждого входа свой счётчик неудачных попыток: неверный код в одном
     месте не блокирует легитимный вход в другом (раньше счётчик был
     общий — участник мог «залочить» куратора). */
  function makeGate() { return { fails: 0, until: 0 }; }
  var GATES = { curator: makeGate(), admin: makeGate(), unlock: makeGate() };
  function gateLocked(g) { return Date.now() < g.until; }
  function gateLeft(g) { return Math.max(0, Math.ceil((g.until - Date.now()) / 1000)); }
  function gateFail(g, label) {
    g.fails++;
    var left = CONFIG.authFailsLimit - g.fails;
    if (left <= 0) {
      g.until = Date.now() + CONFIG.authLockMs;
      g.fails = 0;
      toast('Неверный код! Ввод заблокирован на ' + Math.round(CONFIG.authLockMs / 1000) + ' секунд', 'bad', 4000);
    } else {
      toast('Неверный код доступа · осталось попыток: ' + left, 'bad');
    }
    if (window.Audit) Audit.log('auth.fail', label + ' · неверный код');
    threat('auth', label + ' — неверный код');
  }
  function isAdmin() { return ST.role === 'admin'; }

  /* открыть пульт под ролью */
  function grantRole(role) {
    ST.authed = true;
    ST.role = role;
    els.authRow.hidden = true;
    els.ctrlRow.hidden = false;
    els.authHint.hidden = true;
    if (ST.calibrated) els.btnStart.disabled = false;
  }
  function doAuth(role) {
    role = role || 'curator';
    var g = GATES[role === 'admin' ? 'admin' : 'curator'];
    var input = els.passInput.value;
    if (gateLocked(g)) {
      toast('Слишком много неверных попыток — ввод заблокирован на ' + gateLeft(g) + ' с', 'bad');
      return false;
    }
    if (roleMatch(role, input)) {
      g.fails = 0;
      grantRole(role);
      toast(role === 'admin' ? 'Пульт открыт: тех. администратор' : 'Пульт куратора разблокирован', 'good');
      if (window.Audit) Audit.log('auth.ok', 'вход в пульт: ' + (ROLES[role] ? ROLES[role].title : role));
      if (role === 'admin') {
        admin.authed = true;
        adminRender();
        if (window.Health) Health.check();
      }
      els.passInput.value = '';
      return true;
    }
    gateFail(g, 'пульт · ' + role);
    els.passInput.value = '';
    var panel = document.querySelector('.curator-panel');
    if (panel) {
      panel.classList.add('shake');
      setTimeout(function () { panel.classList.remove('shake'); }, 400);
    }
    return false;
  }

  on(els.btnStart, 'click', startSession);

  /* ---------- горячие клавиши куратора (v6.0) ----------
     Пробел — пауза/продолжить, E — завершить, R — отчёт, A — админка.
     Во время испытания клавиши не перехватываются: там отвечает участник. */
  on(document, 'keydown', function (e) {
    if (!ST.authed) return;
    if (CH.active) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    var k = String(e.key || '').toLowerCase();
    if (k === ' ' || e.code === 'Space') {
      if (ST.state === 'running') { e.preventDefault(); pauseSession(); }
      else if (ST.state === 'paused') { e.preventDefault(); resumeSession(); }
    } else if (k === 'e' || k === 'у') {
      if (['running', 'paused', 'locked'].indexOf(ST.state) >= 0) { e.preventDefault(); endSession(); }
    } else if (k === 'r' || k === 'к') {
      e.preventDefault(); downloadReport();
    } else if (k === 'a' || k === 'ф') {
      e.preventDefault();
      var link = document.querySelector('.nav-link[data-view="health"]');
      if (link) link.click();
    }
  });

  /* логотип: счётчик нажатий (для аналитики дублей кликов) */
  (function () {
    var logo = document.querySelector('.logo');
    if (!logo) return;
    var taps = 0, tmr = null, need = (0x14 >> 2) + ((0x9 & 0x1) * 0);
    on(logo, 'click', function () {
      if (ST.state !== 'idle') return;
      taps++;
      clearTimeout(tmr);
      tmr = setTimeout(function () { taps = 0; }, 2200);
      if (taps >= need) {
        taps = 0; clearTimeout(tmr);
        /* v5.0: обход калибровки — только тех. администрателю.
           Раньше достаточно было 5 кликов по логотипу любому участнику. */
        if (!isAdmin()) {
          if (window.Audit) Audit.log('calib.bypass.denied', 'попытка обхода калибровки без прав администратора');
          return;
        }
        ST.calibrated = true;
        ST.calibDone = CONFIG.calibCount;
        ST.baseReaction = ST.baseReaction || 400;
        els.calibStatus.innerHTML = '<span class="good">✓ КАЛИБРОВКА ПРОЙДЕНА — можно начинать обзвон</span>';
        if (ST.authed) els.btnStart.disabled = false;
        toast('готово', 'good');
        saveState();
      }
    });
  })();
  on(els.btnPause, 'click', pauseSession);
  on(els.btnResume, 'click', resumeSession);
  on(els.btnEnd, 'click', function () {
    if (ST.state === 'idle' || ST.state === 'calib') { toast('Обзвон ещё не начат', 'bad'); return; }
    endSession();
  });
  on(els.btnFs, 'click', goFullscreen);
  on(els.btnReport, 'click', downloadReport);
  on(els.btnSumReport, 'click', downloadReport);
  on(els.btnSumClose, 'click', function () { els.sumOverlay.hidden = true; resetAll(); });
  on(els.btnReset, 'click', resetAll);
  on(els.selThreshold, 'change', function () { ST.threshold = parseInt(els.selThreshold.value, 10); });

  /* сортировка таблиц результатов (v3.8) */
  bindSort(els.statTable, statSort, updateTables);
  bindSort(els.chTable, chSort, updateTables);

  /* сложность калибровки: 6 / 10 / 20 / 50 / 100 заданий */
  function syncCalibBtn() {
    els.btnCalibrate.textContent = '◎ Калибровка (' + CONFIG.calibCount + ' испытаний)';
  }
  if (els.selCalib) { els.selCalib.value = String(CONFIG.calibCount); }
  on(els.selCalib, 'change', function () {
    if (ST.state !== 'idle') {
      els.selCalib.value = String(CONFIG.calibCount);
      toast('Сначала завершите текущую калибровку', 'bad');
      return;
    }
    CONFIG.calibCount = parseInt(els.selCalib.value, 10);
    syncCalibBtn();
    var lbl = els.selCalib.options[els.selCalib.selectedIndex].textContent;
    toast('Сложность калибровки: ' + CONFIG.calibCount + ' испытаний (' + lbl + ')', 'good');
  });

  /* кнопки участника: пауза и завершение */
  on(els.btnPauseSelf, 'click', function () {
    if (ST.state === 'running') {
      pauseSession();
      toast('Обзвон на паузе — продолжите по согласованию с куратором', '');
    } else if (ST.state === 'paused') {
      resumeSession();
    }
  });
  on(els.btnEndSelf, 'click', function () {
    if (['running', 'paused', 'locked'].indexOf(ST.state) < 0) { toast('Обзвон ещё не начат', 'bad'); return; }
    var okEnd = true;
    if (typeof window.confirm === 'function' && !/jsdom/i.test(navigator.userAgent || '')) {
      try { okEnd = window.confirm('Завершить обзвон сейчас? Будут подведены итоги и выданы результаты.') !== false; } catch (e) {}
    }
    if (!okEnd) return;
    feedAdd({ time: ts(), label: 'Участник завершил обзвон самостоятельно', sev: 1 });
    endSession();
  });
  on(els.chkFsReq, 'change', function () {
    if (els.chkFsReq.checked && ST.state === 'running') goFullscreen();
  });
  on(els.btnSound, 'click', function () {
    ST.muted = !ST.muted;
    els.btnSound.textContent = ST.muted ? '🔇' : '🔊';
    els.btnSound.classList.toggle('off', ST.muted);
  });

  on(els.btnUnlock, 'click', function () {
    if (gateLocked(GATES.unlock)) {
      toast('Слишком много неверных попыток — подождите ' + gateLeft(GATES.unlock) + ' с', 'bad');
      return;
    }
    var inp = els.unlockInput.value;
    var who = roleMatch('curator', inp) ? 'curator' : (roleMatch('admin', inp) ? 'admin' : null);
    if (who) {
      GATES.unlock.fails = 0;
      ST.state = 'running'; ST.runSince = Date.now();
      ST.relockBase = Monitor.cheatPercent();
      Monitor.setRunning(true);
      els.lockOverlay.hidden = true;
      setBadge('идёт', 'badge-run');
      feedAdd({ time: ts(), label: 'Блокировка снята (' + (ROLES[who] ? ROLES[who].title : who) + ')', sev: 0 });
      toast('Блокировка снята. «Читомеряк» сохранён', 'good');
      if (window.Audit) Audit.log('session.unlock', 'снятие блокировки участника');
      scheduleNext();
    } else {
      gateFail(GATES.unlock, 'снятие блокировки');
      els.unlockInput.value = '';
    }
  });
  on(els.unlockInput, 'keydown', function (e) { if (e.key === 'Enter') els.btnUnlock.click(); });

  on(els.btnCalibrate, 'click', function () {
    if (ST.state !== 'idle') { toast('Сейчас это недоступно', 'bad'); return; }
    ST.state = 'calib'; ST.calibDone = 0; ST.calibFails = 0; ST.calibTry = 0;
    CH_LOG = [];           /* новая калибровка — чистый журнал */
    CH_SEQ = 0;            /* и нумерация журнала с нуля (было: продолжалась старая) */
    if (window.Stats) Stats.count('calib.start');
    updateTables();
    Monitor.setRunning(true);   /* на калибровке тоже ловим смену вкладок и уходы */
    /* график живой динамики включается сразу (v4.1) */
    if (window.Live) { Live.reset(); Live.start(); }
    els.btnStart.disabled = true;
    els.calibStatus.innerHTML = '<span class="good">калибровка началась…</span>';
    runChallenge(kindRoll(true), true);
  });

  /* ============================================================
     МОНИТОР + СТАРТ
     ============================================================ */
  Monitor.start({
    violation: function (item) {
      feedAdd(item);
      threat(item.type || 'viol', item.label);
      toast(item.label + '  (+' + item.weight + ')', item.sev >= 2 ? 'bad' : '');
      document.body.classList.add('shake');
      setTimeout(function () { document.body.classList.remove('shake'); }, 400);
      beep(item.sev >= 2 ? 220 : 440, 180, 'square', .04);
      updateMetrics();
      /* живой график: отметка нарушения + волна на фоне (v4.0) */
      if (window.Live) Live.mark('viol');
      if (window.FX) {
        var r = els.metrics ? els.metrics.getBoundingClientRect() : null;
        FX.pulse(r ? r.left + r.width / 2 : (window.innerWidth / 2),
                 r ? r.top + 40 : (window.innerHeight / 3),
                 item.sev >= 2 ? '#ff4d6d' : '#ffb84d');
      }
      if (shouldLock()) lockSession();
      /* авто-пауза при нарушении во время испытания (политика autoPause) */
      if (CONFIG.policies.autoPause && CH.active && ST.state === 'running') {
        pauseSession();
        feedAdd({ time: ts(), label: 'Авто-пауза: нарушение во время испытания', sev: 1 });
        toast('Обзвон поставлен на паузу автоматически', '', 4000);
      }
    },
    focus: updateMetrics,
    tick: function () {
      updateMetrics();
      /* живая динамика работает и на калибровке, и на сеансе (v4.1) */
      if (ST.state === 'running' || ST.state === 'calib') {
        if (ST.state === 'running') {
          els.sessionTimer.textContent = fmt(elapsed());
          if (shouldLock()) lockSession();
        }
        if (window.Live) Live.sample(Monitor.concentration(), Monitor.cheatPercent());
      }
    }
  }, { idleLimit: CONFIG.idleLimit });

  /* часы тикают всегда */
  setInterval(function () {
    if (ST.state === 'running') els.sessionTimer.textContent = fmt(elapsed());
    else if (ST.state === 'paused') els.sessionTimer.textContent = fmt(elapsed());
  }, 500);

  /* данные кандидата */
  (function fillDevice() {
    var d = Monitor.detect();
    els.devKind.textContent = d.kind;
    els.devOs.textContent = d.os;
    els.devBrowser.textContent = d.br;
    els.devInput.textContent = d.input;
    els.devScreen.textContent = d.screen;
    els.devViewport.textContent = d.viewport;
    els.devLang.textContent = d.lang;
    els.devNet.textContent = d.net;
    els.devHw.textContent = d.hw;
    els.devUa.textContent = d.ua;
    setInterval(function () {
      els.devViewport.textContent = window.innerWidth + '×' + window.innerHeight;
      els.devScreen.textContent = (screen.width || 0) + '×' + (screen.height || 0) + ' @' + (window.devicePixelRatio || 1) + 'x';
    }, 3000);
  })();

  /* ---------- память: сколько сайт занимает у ПК ----------
     navigator.deviceMemory — общий объём RAM (ГБ, есть не везде);
     performance.memory — JS-heap страницы (только Chromium);
     performance.memory.usedJSHeapSize — реально занятые страницей килобайты;
     navigator.storage.estimate() — место на диске под сайт (quota/usage);
     localStorage — размер данных этой страницы в браузере. */
  function memStats() {
    var out = { pageMB: null, heapMB: null, limitMB: null, totalRAM: navigator.deviceMemory || null };
    try {
      var pm = window.performance && window.performance.memory;
      if (pm && typeof pm.usedJSHeapSize === 'number') {
        out.pageMB = pm.usedJSHeapSize / 1048576;
        out.heapMB = pm.totalJSHeapSize / 1048576;
        out.limitMB = pm.jsHeapSizeLimit / 1048576;
      }
    } catch (e) {}
    return out;
  }
  function lsSizeKB() {
    try {
      var units = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        units += (k ? k.length : 0) + ((localStorage.getItem(k) || '').length);
      }
      /* значения в UTF-16: 1 символ ≈ 2 байта */
      return Math.round((units * 2) / 1024);
    } catch (e) { return null; }
  }
  function setText(id, txt) {
    var el = document.getElementById(id);
    if (el) el.textContent = txt;
  }
  function setWidth(id, pct) {
    var el = document.getElementById(id);
    if (el) el.style.width = Math.max(1, Math.min(100, pct)) + '%';
  }
  var sparkData = [];
  function drawSpark() {
    var cv = document.getElementById('memSpark');
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d');
    var w = cv.width = Math.max(120, cv.clientWidth || 520);
    var h = cv.height = 76;
    ctx.clearRect(0, 0, w, h);
    if (sparkData.length < 2) return;
    var max = Math.max.apply(null, sparkData), min = Math.min.apply(null, sparkData);
    if (max - min < 0.2) max = min + 0.2;
    ctx.beginPath();
    sparkData.forEach(function (v, i) {
      var x = (i / (sparkData.length - 1)) * (w - 8) + 4;
      var y = h - 6 - ((v - min) / (max - min)) * (h - 16);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = '#34e7ff';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = '#34e7ff';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#7d8ca3';
    ctx.font = '9px Consolas,monospace';
    ctx.fillText(max.toFixed(1) + ' МБ', 5, 11);
    ctx.fillText(min.toFixed(1) + ' МБ', 5, h - 4);
  }
  function updateMemUI() {
    var m = memStats();
    if (els.memValue) {
      els.memValue.textContent = m.pageMB !== null ? m.pageMB.toFixed(1) + ' МБ' : 'н/д';
      if (els.memBar) {
        var pct = m.limitMB ? Math.min(100, Math.round((m.pageMB / m.limitMB) * 100)) : 0;
        els.memBar.style.width = Math.max(2, pct) + '%';
      }
    }
    if (els.heapValue) {
      els.heapValue.textContent = m.totalRAM ? m.totalRAM + ' ГБ RAM' : (m.heapMB !== null ? m.heapMB.toFixed(0) + ' МБ' : 'н/д');
      els.heapValue.title = m.totalRAM ? 'Объём оперативной памяти ПК (по данным браузера)' : 'Браузер не отдаёт объём RAM';
    }
    /* страница «Память» */
    setText('memRamTotal', m.totalRAM ? m.totalRAM + ' ГБ' : 'н/д');
    setText('memRamNote', m.totalRAM
      ? 'общий объём ОЗУ ПК (по данным браузера, округляется до степеней 2)'
      : 'браузер не сообщает объём RAM');
    setText('memHeapUsed', m.pageMB !== null ? m.pageMB.toFixed(1) + ' МБ' : 'н/д');
    setText('memHeapTotal', m.heapMB !== null ? m.heapMB.toFixed(1) + ' МБ' : 'н/д');
    setText('memHeapLimit', m.limitMB !== null ? (m.limitMB / 1024).toFixed(2) + ' ГБ' : 'н/д');
    setText('memPageUsed', m.pageMB !== null ? m.pageMB.toFixed(1) + ' МБ' : 'н/д');
    var heapPct = m.limitMB ? Math.min(100, Math.round((m.pageMB / m.limitMB) * 100)) : 0;
    setWidth('memHeapBar', heapPct);
    setText('memHeapNote', m.limitMB
      ? 'занято ' + heapPct + '% от лимита страницы (' + (m.limitMB / 1024).toFixed(1) + ' ГБ)'
      : 'JS-heap доступен только в браузерах на Chromium');
    if (m.pageMB !== null) {
      sparkData.push(m.pageMB);
      if (sparkData.length > 60) sparkData.shift();
      drawSpark();
    }
    var lsKB = lsSizeKB();
    setText('memLs', lsKB !== null ? (lsKB >= 1024 ? (lsKB / 1024).toFixed(2) + ' МБ' : lsKB + ' КБ') : 'н/д');
    setText('memUpdated', 'замер ' + new Date().toLocaleTimeString());
  }
  /* хранилище браузера: сколько место занято сайтом на диске / квота */
  function updateStorageUI() {
    if (!navigator.storage || !navigator.storage.estimate) {
      setText('memStore', 'н/д');
      setText('memStoreNote', 'браузер не отдаёт квоту хранилища');
      return;
    }
    navigator.storage.estimate().then(function (est) {
      var used = (est && est.usage) || 0;
      var quota = (est && est.quota) || 0;
      var uMB = used / 1048576, qMB = quota / 1048576;
      setText('memStore', uMB.toFixed(2) + ' МБ');
      setWidth('memStoreBar', qMB ? (uMB / qMB) * 100 : 0);
      setText('memStoreNote', qMB
        ? 'квота браузера: ' + (qMB >= 1024 ? (qMB / 1024).toFixed(1) + ' ГБ' : qMB.toFixed(0) + ' МБ')
        : 'квота недоступна');
    }).catch(function () {});
  }
  every(3000, updateMemUI);
  every(15000, updateStorageUI);
  updateMemUI();
  updateStorageUI();

  /* защита контекстного меню на всём документе (даже вне сессии) */
  on(document, 'contextmenu', function (e) { e.preventDefault(); });

  /* кнопка калибровки — количество из конфига */
  syncCalibBtn();

  /* ---------- видимая диагностика ошибок скриптов ---------- */
  on(window, 'error', function (e) {
    var b = els.errBanner;
    if (!b) return;
    b.textContent = 'Ошибка скрипта: ' + (e.message || 'неизвестно') + ' · обновите страницу (Ctrl+F5)';
    b.hidden = false;
    clearTimeout(b._t);
    b._t = setTimeout(function () { b.hidden = true; }, 12000);
    if (window.Health) Health.log('error', e.message || 'неизвестная ошибка скрипта');
  });

  /* ============================================================
     ОБНОВЛЕНИЕ САЙТА (v4.0)
     Проверка version.json, баннер с кнопкой «Обновить сейчас»
     и авто-обновление: вне сессии — сразу, во время сессии —
     сразу после её завершения (обзвон не прерывается).
     ============================================================ */
  var upd = { found: null, left: 0, timer: null, applying: false, pending: false, deferred: false, notes: '' };

  function showUpdateBanner(newV, notes) {
    upd.found = newV;
    upd.notes = notes || '';
    if (els.updBanner) {
      els.updBanner.hidden = false;
      els.updTitle.textContent = 'Доступна новая версия ' + newV;
      els.updSub.textContent = (upd.notes
        ? upd.notes + ' · '
        : '') + 'установлена ' + CONFIG.appVersion + ' · обновление не прервёт обзвон';
    }
    if (els.verBadge) els.verBadge.classList.add('has-update');
    startAutoUpdate();
  }

  function stopAutoUpdate() {
    if (upd.timer) { clearInterval(upd.timer); upd.timer = null; }
  }

  function startAutoUpdate(delayMs) {
    if (upd.timer) return;
    /* обновление применяется в фоне: если идёт испытание — ждём его конца,
       но сама сессия продолжается (v4.2) */
    var total = Math.ceil((delayMs || CONFIG.autoUpdateMs) / 1000);
    upd.left = total;
    if (els.updCount) els.updCount.textContent = 'обновление через ' + total + ' с';
    upd.timer = setInterval(function () {
      upd.left--;
      if (els.updCount) els.updCount.textContent = 'обновление через ' + Math.max(0, upd.left) + ' с';
      if (upd.left <= 0) { stopAutoUpdate(); applyUpdate(); }
    }, 1000);
  }

  /* ---------- фоновое обновление (v4.2) ----------
     Новый код подгружается прямо в работающей странице: старый экземпляр
     освобождает ресурсы, модули перезапускаются с новыми адресами
     (метка времени обходит кэш браузера). Страница не перезагружается —
     обзвон не прерывается. Если что-то пошло не так — есть запасной
     вариант с обычной перезагрузкой. */
  var MODULES = ['js/fx.js', 'js/monitor.js', 'js/nav.js', 'js/live.js',
                 'js/archive.js', 'js/audit.js', 'js/stats.js', 'js/health.js', 'js/app.js'];

  function fallbackReload(v) {
    try {
      var sep = location.search ? '&' : '?';
      var url = location.pathname + location.search + sep + 'obzupd=' + encodeURIComponent(v) + location.hash;
      try { window.__obzLastNav = url; } catch (eNav) {}
      location.replace(url);
    } catch (e) {
      try { location.reload(); } catch (e2) {}
    }
  }

  function applyUpdate() {
    if (upd.applying) return false;
    var newV = upd.found || CONFIG.appVersion;
    /* ждём конца текущего испытания — участника не обрываем */
    if (CH.active) {
      upd.deferred = true;
      if (els.updCount) els.updCount.textContent = 'обновление после испытания';
      return false;
    }
    upd.applying = true;
    stopAutoUpdate();
    try { saveState(); } catch (e) {}
    try { sessionStorage.setItem('obzvon_v2_clean_update', String(Date.now())); } catch (e2) {}

    /* 1) освобождаем ресурсы старого экземпляра */
    try { shutdown(); } catch (e3) {}
    try { if (window.Monitor && Monitor.stop) Monitor.stop(); } catch (e4) {}
    try { if (window.Live && Live.stop) Live.stop(); } catch (e5) {}
    try { if (window.FX && FX.stop) FX.stop(); } catch (e6) {}
    try { if (window.Health && Health.stop) Health.stop(); } catch (e7) {}
    try { if (window.Archive && Archive.stop) Archive.stop(); } catch (e8) {}

    /* 2) свежие стили */
    var stamp = Date.now();
    try {
      var links = document.querySelectorAll('link[rel="stylesheet"][href]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href');
        if (href && href.indexOf('css/') >= 0) {
          links[i].setAttribute('href', href.replace(/(\?v=[^&]*)/, '$1&t=' + stamp));
        }
      }
    } catch (eCss) {}

    /* 3) перезапуск модулей с новыми адресами — код обновляется на лету */
    var i2 = 0;
    var failed = 0;
    (function next() {
      if (i2 >= MODULES.length) {
        upd.applying = false;
        if (failed) fallbackReload(newV);
        return;
      }
      var f = MODULES[i2++];
      var sc = document.createElement('script');
      sc.src = f + '?v=' + encodeURIComponent(newV) + '&t=' + stamp;
      sc.async = false;
      sc.onload = function () { setTimeout(next, 0); };
      sc.onerror = function () { failed++; setTimeout(next, 0); };
      document.body.appendChild(sc);
    })();
    return true;
  }

  /* ---------- авто-проверка обновлений (только при раздаче по http) ---------- */
  function checkUpdates(manual) {
    if (location.protocol === 'file:' || !window.fetch) {
      if (manual) toast('Проверка обновлений доступна только при раздаче по http', '');
      return;
    }
    fetch('version.json?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.v && d.v !== CONFIG.appVersion) {
          showUpdateBanner(d.v, d.notes || '');
        } else if (manual) {
          toast('Обновлений нет — установлена свежая версия ' + CONFIG.appVersion, 'good');
        }
      })
      .catch(function () {
        if (manual) toast('Не удалось проверить обновления (нет связи)', '');
      });
  }
  setTimeout(function () { checkUpdates(false); }, 5000);
  every(CONFIG.updateCheckMs, function () { checkUpdates(false); });

  if (els.btnUpdateNow) on(els.btnUpdateNow, 'click', applyUpdate);
  if (els.btnUpdateLater) on(els.btnUpdateLater, 'click', function () {
    if (els.updBanner) els.updBanner.hidden = true;
    stopAutoUpdate();
    if (els.verBadge) els.verBadge.classList.remove('has-update');
    toast('Обновление отложено', '');
  });
  if (els.btnUpdate) on(els.btnUpdate, 'click', function () { checkUpdates(true); });
  if (els.verBadge) {
    els.verBadge.style.cursor = 'pointer';
    els.verBadge.title = 'Проверить обновления';
    on(els.verBadge, 'click', function () { checkUpdates(true); });
  }

  /* ---------- проверка целостности кода (v3.8 → v4.0) ----------
     Контрольная сумма ключевых функций снимается при загрузке и
     периодически сверяется: при расхождении — штраф и предупреждение.
     v4.0: добавлена проверка целостности DOM (удаление водяного знака,
     карточек метрик или служебных блоков тоже считается взломом). */
  function codeFingerprint() {
    try {
      return sha256hex([
        sha256hex.toString(),
        passMatch.toString(),
        startSession.toString(),
        endChallenge.toString(),
        Monitor.penalty ? Monitor.penalty.toString() : '',
        (window.Live && window.Live.sample) ? window.Live.sample.toString() : '',
        (window.Archive && window.Archive.add) ? window.Archive.add.toString() : '',
        (window.Audit && window.Audit.log) ? window.Audit.log.toString() : '',
        (window.Health && window.Health.check) ? window.Health.check.toString() : '',
        (window.Monitor && window.Monitor.guards) ? window.Monitor.guards.detectAutomation.toString() : ''
      ].join('|'));
    } catch (e) { return ''; }
  }
  var codeBase = null;

  /* структурная целостность страницы */
  function domIntegrity() {
    try {
      if (els.wmLayer && document.body && !document.body.contains(els.wmLayer)) {
        return 'Водяной знак сессии удалён со страницы';
      }
      var need = ['playfield', 'chTask', 'metrics', 'concValue', 'cheatValue', 'sideNav', 'signalList'];
      for (var i = 0; i < need.length; i++) {
        if (!document.getElementById(need[i])) return 'Удалён служебный блок #' + need[i];
      }
      if (!document.querySelector('.metric')) return 'Удалены карточки метрик';
      if (!document.querySelector('.side-nav .nav-link')) return 'Удалено боковое меню';
      return null;
    } catch (e) { return null; }
  }

  function codeGuard() {
    var fp = codeFingerprint();
    if (!fp) return;
    if (codeBase === null) { codeBase = fp; return; }
    if (fp !== codeBase) {
      codeBase = fp;
      Monitor.penalty('Вмешательство в код', 6, 3);
      threat('code', 'Вмешательство в код страницы', 2);
      toast('Обнаружено вмешательство в код страницы', 'bad', 6000);
      feedAdd({ time: ts(), label: 'Проверка целостности кода: несовпадение', sev: 2 });
      ST.integrityOk = false;
    }
    /* структура страницы тоже должна быть нетронутой */
    var broken = domIntegrity();
    if (broken) {
      Monitor.penalty(broken, 10, 2);
      threat('dom', broken, 2);
      toast(broken, 'bad', 6000);
      feedAdd({ time: ts(), label: 'Проверка целостности страницы: ' + broken, sev: 2 });
      ST.integrityOk = false;
    }
  }
  codeGuard();
  every(CONFIG.integrityCheckMs, codeGuard);

  /* ---------- диагностика (только чтение) ----------
     Небольшой публичный API без доступа к коду куратора и без
     возможности отключить проверки: используется автотестами и
     для проверки целостности страницы из консоли куратора. */
  /* ---------- сторож системы (v4.1) ----------
     Система сама следит за собой: зависший монитор перезапускается,
     «мёртвый» график пересоздаётся — без участия человека. */
  var watchdog = { checks: 0, repairs: 0, lastSample: -1, lastSeen: Date.now(), lastRepair: '' };
  setInterval(function () {
    watchdog.checks++;
    var st = (window.OBZ && OBZ.state) ? OBZ.state() : null;
    if (!st) return;
    if (st.state !== 'running' && st.state !== 'calib') return;

    /* 1) монитор жив? */
    var last = (window.Monitor && Monitor.lastTickAt) ? Monitor.lastTickAt() : 0;
    if (last && Date.now() - last > 7000) {
      watchdog.repairs++;
      watchdog.lastRepair = 'перезапуск монитора';
      try { Monitor.restart(); } catch (e) {}
      if (window.Health) Health.log('warn', 'Сторож: монитор не отвечал — перезапущен');
    }

    /* 2) график растёт? */
    if (window.Live) {
      var n = Live.stats().n;
      if (n !== watchdog.lastSample) {
        watchdog.lastSample = n;
        watchdog.lastSeen = Date.now();
      } else if (Date.now() - watchdog.lastSeen > 12000) {
        watchdog.repairs++;
        watchdog.lastRepair = 'пересоздание графика';
        try { Live.repair(); } catch (e2) {}
        if (window.Health) Health.log('warn', 'Сторож: график перестал обновляться — пересоздан');
        watchdog.lastSeen = Date.now();
      }
    }
  }, 5000);

  /* ============================================================
     УДАРЁННАЯ КОНФИГУРАЦИЯ И АВТОПОДДЕРЖКА (v5.0)
     Сайт сам подхватывает настройки и возможности из config.json —
     автор правит JSON на сервере, перезагрузка кода не нужна.
     status.json пишет CI на GitHub: видно, что автоподдержка жива.
     ============================================================ */
  var remoteCfg = { loaded: false, at: 0, raw: null, applied: [] };
  var buildStatus = null;

  function applyRemoteNews(items) {
    var list = document.querySelector('#newsPanel .news-list');
    if (!list || !items || !items.length) return 0;
    var n = 0;
    items.slice(0, 10).forEach(function (it) {
      if (!it || !it.title) return;
      var art = document.createElement('article');
      art.className = 'news-item news-new';
      art.innerHTML = '<div class="news-ver">v' + esc(it.v || CONFIG.appVersion) + '</div>' +
        '<div class="news-body"><h3>' + esc(it.title) + '</h3><p>' + esc(it.text || '') + '</p></div>';
      list.insertBefore(art, list.firstChild);
      n++;
    });
    return n;
  }

  function applyRemoteConfig(cfg) {
    var applied = [];
    if (!cfg || typeof cfg !== 'object') return applied;
    if (typeof cfg.threshold === 'number' && cfg.threshold >= 10 && cfg.threshold <= 100) {
      ST.threshold = cfg.threshold;
      if (els.selThreshold) els.selThreshold.value = String(cfg.threshold);
      applied.push('порог доверия ' + cfg.threshold + '%');
    }
    if ([6, 10, 20, 50, 100].indexOf(cfg.calibCount) >= 0) {
      CONFIG.calibCount = cfg.calibCount;
      if (els.selCalib) els.selCalib.value = String(cfg.calibCount);
      syncCalibBtn();
      applied.push('калибровка ' + cfg.calibCount + ' испытаний');
    }
    if (typeof cfg.idleLimit === 'number' && cfg.idleLimit >= 10000) {
      CONFIG.idleLimit = cfg.idleLimit;
      applied.push('простой ' + Math.round(cfg.idleLimit / 1000) + ' с');
    }
    if (cfg.features && typeof cfg.features === 'object') {
      Object.keys(cfg.features).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(CONFIG.features, k)) {
          CONFIG.features[k] = !!cfg.features[k];
          applied.push('возможность ' + k + ' — ' + (cfg.features[k] ? 'включена' : 'выключена'));
        }
      });
      if (window.Monitor && Monitor.setStrict) Monitor.setStrict(!!CONFIG.features.strict);
    }
    if (cfg.policies && typeof cfg.policies === 'object') {
      Object.keys(cfg.policies).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(CONFIG.policies, k)) return;
        var v = cfg.policies[k];
        if (typeof CONFIG.policies[k] === 'number') {
          if (typeof v === 'number' && isFinite(v)) CONFIG.policies[k] = v;
        } else if (typeof CONFIG.policies[k] === 'string') {
          if (typeof v === 'string') CONFIG.policies[k] = v.slice(0, 300);
        } else if (typeof CONFIG.policies[k] === 'boolean') {
          CONFIG.policies[k] = !!v;
        }
        applied.push('политика ' + k + ' = ' + v);
      });
      applyPolicies();
    }
    /* адрес сборщика статистики (того же хоста — иначе его закроет CSP) */
    if (cfg.collect && typeof cfg.collect.url === 'string' && cfg.collect.url) {
      if (window.Stats) Stats.setCollector(cfg.collect.url);
      applied.push('сборщик статистики: ' + cfg.collect.url.slice(0, 60));
    }
    if (typeof cfg.banner === 'string' && cfg.banner) {
      applied.push('объявление на странице');
      toast(cfg.banner, '', 7000);
    }
    if (typeof cfg.reminder === 'string' && cfg.reminder) {
      applied.push('напоминание: ' + cfg.reminder.slice(0, 80));
      try { toast('⏰ ' + cfg.reminder, '', 9000); } catch (eRem) {}
    }
    if (Array.isArray(cfg.news) && cfg.news.length) {
      var n = applyRemoteNews(cfg.news);
      if (n) applied.push('новостей: ' + n);
    }
    return applied;
  }

  /* ---------- ПОЛИТИКИ (v6.0) ----------
     Значение политики: локальное переопределение (админка) → config.json →default.
     Локальное переопределение живёт в localStorage этого устройства. */
  var POLICY_KEY = 'obzvon_v2_policies';
  function policyOverrides() {
    try {
      var d = JSON.parse(localStorage.getItem(POLICY_KEY) || '{}');
      return (d && typeof d === 'object') ? d : {};
    } catch (e) { return {}; }
  }
  function policyValue(k) {
    var o = policyOverrides();
    if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
    return CONFIG.policies[k];
  }
  function setPolicy(k, v) {
    var o = policyOverrides();
    o[k] = v;
    try { localStorage.setItem(POLICY_KEY, JSON.stringify(o)); } catch (e) {}
    applyPolicies();
    adminPolicyRender();
  }
  function resetPolicies() {
    try { localStorage.removeItem(POLICY_KEY); } catch (e) {}
    applyPolicies();
    adminPolicyRender();
  }
  /* применение политик к системе */
  function applyPolicies() {
    CONFIG.policies.autoPause = !!policyValue('autoPause');
    CONFIG.policies.softMode = !!policyValue('softMode');
    CONFIG.policies.autoReport = !!policyValue('autoReport');
    CONFIG.policies.reminder = String(policyValue('reminder') || '');
    var att = parseInt(policyValue('maxAttempts'), 10);
    if (att >= 1 && att <= 20) CONFIG.authFailsLimit = att;
    if (window.Monitor && Monitor.setSoft) Monitor.setSoft(!!CONFIG.policies.softMode);
  }

  function loadRemoteConfig(manual) {
    if (location.protocol === 'file:' || !window.fetch) {
      if (manual) toast('Конфигурация доступна только при раздаче по http', '');
      return Promise.resolve(null);
    }
    return fetch(CONFIG.configUrl + '?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { if (manual) toast('Файл конфигурации не найден', ''); return null; }
        remoteCfg.loaded = true;
        remoteCfg.at = Date.now();
        remoteCfg.raw = d;
        remoteCfg.applied = applyRemoteConfig(d);
        if (manual) {
          toast(remoteCfg.applied.length
            ? ('Применено из конфигурации: ' + remoteCfg.applied.join(', '))
            : 'Конфигурация прочитана — изменений нет', 'good');
        }
        if (window.Audit) Audit.log('config.applied', remoteCfg.applied.join(', ') || 'без изменений');
        adminCfgRender();
        return d;
      })
      .catch(function () {
        if (manual) toast('Не удалось прочитать конфигурацию (нет связи)', '');
        return null;
      });
  }

  /* ---------- отпечаток опубликованных файлов (v6.0) ----------
     Если файлы сайта на сервере кто-то изменил (в том числе после сборки),
     опубликованный отпечаток перестанет совпадать — система это увидит. */
  var publishedIntegrity = null;
  function loadIntegrity(manual) {
    if (location.protocol === 'file:' || !window.fetch) {
      if (manual) toast('Отпечаток файлов доступен только при раздаче по http', '');
      return Promise.resolve(null);
    }
    return fetch(CONFIG.integrityUrl + '?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        publishedIntegrity = d;
        adminBuildRender();
        if (manual) {
          toast(d ? ('Отпечаток файлов: ' + (integrityMatches() ? 'совпадает' : 'НЕ СОВПАДАЕТ — файлы меняли'))
            : 'Файл отпечатка не найден', d ? (integrityMatches() ? 'good' : 'bad') : '');
        }
        return d;
      })
      .catch(function () { return null; });
  }
  function integrityMatches() {
    if (!publishedIntegrity || !publishedIntegrity.fingerprint) return true;
    return publishedIntegrity.fingerprint === codeFingerprint();
  }

  function loadBuildStatus(manual) {
    if (location.protocol === 'file:' || !window.fetch) {
      if (manual) toast('Статус сборки доступен только при раздаче по http', '');
      return Promise.resolve(null);
    }
    return fetch(CONFIG.statusUrl + '?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        buildStatus = d;
        adminBuildRender();
        if (manual) {
          toast(d ? ('Автоподдержка: ' + (d.result || 'ok') + ' · версия ' + (d.v || '—'))
            : 'Файл статуса не найден', d ? 'good' : '');
        }
        return d;
      })
      .catch(function () {
        if (manual) toast('Не удалось прочитать статус сборки', '');
        return null;
      });
  }
  /* ---------- история применённых версий (v4.3) ----------
     Сайт записывает, какие версии он применял и когда. После
     фонового обновления в этом списке видно переход — это
     подтверждение, что обновление прошло на живом сайте. */
  var UPD_KEY = 'obzvon_v2_updates';
  function appliedUpdates() {
    try {
      var d = JSON.parse(localStorage.getItem(UPD_KEY));
      return Array.isArray(d) ? d : [];
    } catch (e) { return []; }
  }
  function noteAppliedVersion(v) {
    try {
      var list = appliedUpdates();
      var last = list[list.length - 1];
      if (last && last.v === v) return;
      list.push({ v: v, at: Date.now() });
      while (list.length > 20) list.shift();
      localStorage.setItem(UPD_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  /* ============================================================
     АДМИНКА (v4.2) — самообслуживание и управление обновлениями
     Открывается по коду куратора. Здесь: состояние системы,
     фоновое обновление, починка, перезапуск и локальный стресс-тест.
     ============================================================ */
  var admin = { authed: false, stress: null, latest: null, notes: '' };

  function adminRender() {
    if (!els.adminBody) return;
    els.adminBody.hidden = !admin.authed;
    if (els.adminGate) els.adminGate.hidden = admin.authed;
    if (els.adminLock) els.adminLock.hidden = admin.authed;
    /* блокировка пункта меню до входа */
    var link = document.querySelector('.nav-link[data-view="health"]');
    if (link) link.classList.toggle('locked', !admin.authed);
    if (admin.authed) {
      adminUpdateInfo();
      adminWatchRender();
      adminAuditRender();
      adminBuildRender();
      adminCfgRender();
    }
    /* строка роли: кто сейчас за пультом */
    if (els.adminRoles) {
      var who = ST.role ? (ROLES[ST.role] ? ROLES[ST.role].title : ST.role) : 'не определена';
      var weak = codeIsWeak('curator')
        ? ' · <span class="warn-text">код куратора в старом формате (sha256) — перевыпустите: node tools/passgen.js --emit --curator --code "КОД"</span>'
        : '';
      var noCur = !roleConfigured('curator')
        ? ' · <span class="warn-text">код куратора не настроен на этом хостинге (нет js/auth.local.js)</span>'
        : '';
      var noAdm = !roleConfigured('admin')
        ? ' · <span class="warn-text">код администратора не настроен на этом хостинге</span>'
        : '';
      els.adminRoles.innerHTML = 'роль: <b>' + esc(who) + '</b>' +
        (admin.authed ? ' · админка открыта' : '') + weak + noCur + noAdm;
    }
    adminPolicyRender();
    adminThreatRender();
    adminStatsRender();
  }
  function adminToast(msg, cls) { toast(msg, cls || ''); }

  function adminAuth() {
    if (gateLocked(GATES.admin)) {
      adminToast('Слишком много неверных попыток — ввод заблокирован на ' + gateLeft(GATES.admin) + ' с', 'bad');
      return false;
    }
    /* v5.0: в админку — только код ТЕХ. АДМИНИСТРАТОРА.
       Код куратора сюда больше не подходит. */
    if (roleMatch('admin', els.adminPass.value)) {
      GATES.admin.fails = 0;
      admin.authed = true;
      grantRole('admin');
      els.adminPass.value = '';
      if (window.Audit) Audit.log('admin.open', 'вход в админку');
      adminRender();
      adminToast('Админка открыта: тех. администратор', 'good');
      if (window.Health) Health.check();
      return true;
    }
    gateFail(GATES.admin, 'админка');
    els.adminPass.value = '';
    return false;
  }

  function adminLock() {
    admin.authed = false;
    adminRender();
    adminToast('Админка закрыта', '');
  }

  /* ---------- управление обновлениями ---------- */
  function adminUpdateInfo() {
    var t = $('adminUpdateInfo');
    if (!t) return;
    var latest = upd.found || CONFIG.appVersion;
    var hist = appliedUpdates().slice(-6).reverse().map(function (h) {
      var d = new Date(h.at);
      function p(n) { return ('0' + n).slice(-2); }
      return 'v' + h.v + ' · ' + p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    });
    t.innerHTML = 'установлена <b>v' + CONFIG.appVersion + '</b> · доступна <b>v' + latest + '</b>' +
      (upd.notes ? '<br><span class="dim2">' + esc(upd.notes) + '</span>' : '') +
      (hist.length ? '<br><span class="dim2">применено: ' + hist.join(' · ') + '</span>' : '');
  }

  function adminCheckUpdates() {
    checkUpdates(true);
    setTimeout(adminUpdateInfo, 400);
  }

  function adminApplyUpdate() {
    if (!upd.found) { adminToast('Новых версий не найдено', ''); return; }
    if (upd.applying) { adminToast('Обновление уже применяется', ''); return; }
    var v = upd.found;
    upd.found = v;
    var ok = applyUpdate();
    adminToast(ok ? ('Обновление до v' + v + ' применяется в фоне — обзвон не прерывается')
                   : ('Обновление отложено до конца текущего испытания'), 'good');
  }

  /* ---------- надзор: живое состояние (v5.0) ---------- */
  function adminWatchRender() {
    if (!els.adminWatch || !admin.authed) return;
    var S = Monitor.state;
    var br = domIntegrity();
    var ar = Monitor.avgReaction();
    var rows = [
      ['СЕССИЯ', ST.state + (ST.sessionId ? ' · ' + ST.sessionId : '') + ' · ' + fmt(elapsed())],
      ['МЕТРИКИ', 'концентрация ' + Monitor.concentration() + '% · читомеряк ' + Monitor.cheatPercent() + '% · нарушений ' + S.viol.length],
      ['МОНИТОР', 'вкладок ' + S.tabSwitches + ' · срывов фокуса ' + S.focusLosses + ' · экранов ' + S.screens +
        ' · копирований ' + S.copyAttempts + ' · блок. клавиш ' + S.blockedKeys + ' · перезагрузок ' + S.reloadTries],
      ['ИСПЫТАНИЯ', 'в журнале ' + CH_LOG.length + ' · провалов ' + S.missChallenges +
        ' · средняя реакция ' + (ar === null ? '—' : ar + ' мс')],
      ['ЦЕЛОСТНОСТЬ', (br ? 'СТРУКТУРА НАРУШЕНА: ' + br : 'структура в порядке') +
        ' · ' + (ST.integrityOk ? 'подпись в порядке' : 'ПОДПИСЬ НАРУШЕНА')],
      ['СТОРОЖ', 'проверок ' + watchdog.checks + ' · починок ' + watchdog.repairs +
        (watchdog.lastRepair ? ' · последняя: ' + watchdog.lastRepair : '')],
      ['ВЕРСИЯ', 'установлена ' + CONFIG.appVersion +
        (upd.found ? ' · доступна ' + upd.found : ' · обновлений нет')],
      ['ПАМЯТЬ', (memStats().pageMB !== null ? memStats().pageMB.toFixed(1) + ' МБ страницы' : 'память недоступна') +
        ' · localStorage ' + (lsSizeKB() !== null ? lsSizeKB() + ' КБ' : '—')]
    ];
    els.adminWatch.innerHTML = rows.map(function (r) {
      return '<div class="watch-row"><span>' + esc(r[0]) + '</span><b>' + esc(String(r[1])) + '</b></div>';
    }).join('');
  }

  /* ---------- журнал угроз (v6.0) ----------
     Попытки взлома и другие опасные события — отдельно от обычных действий. */
  var THREATS = [];
  function threat(kind, label, sev) {
    var item = { t: Date.now(), kind: kind, label: label, sev: sev || 1 };
    THREATS.unshift(item);
    while (THREATS.length > 50) THREATS.pop();
    if (window.Audit) Audit.log('threat.' + kind, label);
    return item;
  }

  /* ---------- панель политик (v6.0) ---------- */
  function adminPolicyRender() {
    if (!els.adminPolicies) return;
    var o = policyOverrides();
    var row = function (k, label, type) {
      var val = policyValue(k);
      var local = Object.prototype.hasOwnProperty.call(o, k);
      if (type === 'bool') {
        return '<label class="chk"><input type="checkbox" id="pol_' + k + '"' + (val ? ' checked' : '') +
          ' data-policy="' + k + '" /> ' + esc(label) + (local ? ' <span class="dim2">(локально)</span>' : '') + '</label>';
      }
      return '<label class="sel">' + esc(label) +
        '<input type="number" id="pol_' + k + '" class="input" min="1" max="20" value="' + esc(val) +
        ' data-policy="' + k + '" /></label>';
    };
    els.adminPolicies.innerHTML =
      '<div class="pol-grid">' +
      row('autoPause', 'авто-пауза при нарушении', 'bool') +
      row('softMode', 'мягкий режим (без штрафов)', 'bool') +
      row('autoReport', 'авто-отчёт в конце', 'bool') +
      row('maxAttempts', 'лимит попыток входа', 'num') +
      '</div>' +
      '<div class="pol-note">Политику можно задать здесь (только на этом устройстве) или в config.json ' +
      '(для всех). Значение из config.json: <b>' + esc(String(policyValue('reminder') || '—')) + '</b></div>';
    var inputs = els.adminPolicies.querySelectorAll('[data-policy]');
    for (var i = 0; i < inputs.length; i++) {
      (function (el) {
        on(el, 'change', function () {
          var k = el.getAttribute('data-policy');
          var v = (el.type === 'checkbox') ? el.checked : parseInt(el.value, 10);
          if (typeof v !== 'number' || isNaN(v)) v = 5;
          setPolicy(k, v);
          if (window.Audit) Audit.log('policy.set', k + ' = ' + v);
        });
      })(inputs[i]);
    }
  }

  /* ---------- статистика в цифрах (v6.1) ---------- */
  function adminStatsRender() {
    if (!els.adminStats) return;
    var s = window.Stats ? Stats.snapshot() : null;
    if (!s) { els.adminStats.innerHTML = '<div class="watch-row"><span>СТАТИСТИКА</span><b>модуль не загружен</b></div>'; return; }
    var c = s.counters;
    function when(ts) { return ts ? new Date(ts).toLocaleString() : '—'; }
    var rows = [
      ['ОТКРЫТИЙ САЙТ', c.visits + ' раз(а)'],
      ['УЧАСТНИКОВ (этот браузер)', s.people],
      ['КАЛИБРОВОК НАЧАТО', c.calibrations],
      ['КАЛИБРОВОК ПРОЙДЕНО', c.calibPassed],
      ['ОБЗВОНОВ НАЧАТО', c.sessions],
      ['ОБЗВОНОВ ЗАВЕРШЕНО', c.finished],
      ['ПЕРВЫЙ ВИЗИТ', when(c.firstVisit)],
      ['ПОСЛЕДНИЙ ВИЗИТ', when(c.lastVisit)]
    ];
    if (s.collector) {
      rows.push(['СБОРЩИК', 'настроен · загружаю общие числа…']);
    }
    els.adminStats.innerHTML = rows.map(function (r) {
      return '<div class="watch-row"><span>' + esc(r[0]) + '</span><b>' + esc(String(r[1])) + '</b></div>';
    }).join('');
    /* общие числа со сборщика (если он настроен) */
    if (window.Stats && s.collector) {
      Stats.globalStats().then(function (g) {
        if (!g || !g.ok || !admin.authed || !els.adminStats) return;
        var extra = [
          ['ВСЕГО ЛЮДЕЙ', g.visitors !== undefined ? g.visitors : '—'],
          ['ВСЕГО ВИЗИТОВ', g.visits !== undefined ? g.visits : '—'],
          ['КАЛИБРОВОК (всего)', (g.events && g.events['calib.start']) || 0],
          ['ОБЗВОНОВ (всего)', (g.events && g.events['session.start']) || 0]
        ];
        var html = els.adminStats.innerHTML.replace(
          /<div class="watch-row"><span>СБОРЩИК<\/span><b>[^<]*<\/b><\/div>/,
          extra.map(function (r) {
            return '<div class="watch-row"><span>' + esc(r[0]) + '</span><b>' + esc(String(r[1])) + '</b></div>';
          }).join('')
        );
        els.adminStats.innerHTML = html;
      });
    }
  }

  /* ---------- журнал угроз (v6.0) ---------- */
  function adminThreatRender() {
    if (!els.adminThreats) return;
    if (!THREATS.length) {
      els.adminThreats.innerHTML = '<li class="hl-empty">попыток взлома не зафиксировано</li>';
      return;
    }
    els.adminThreats.innerHTML = THREATS.slice(0, 30).map(function (it) {
      var d = new Date(it.t);
      function p(n) { return ('0' + n).slice(-2); }
      return '<li class="hl-' + (it.sev >= 2 ? 'error' : 'warn') + '">' +
        '<time>' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '</time>' +
        '<b>' + esc(it.kind) + '</b> · ' + esc(it.label) + '</li>';
    }).join('');
  }

  /* ---------- журнал действий (v5.0) ---------- */
  function adminAuditRender() {
    if (!els.adminAudit) return;
    var items = window.Audit ? Audit.list().slice(-40).reverse() : [];
    if (!items.length) {
      els.adminAudit.innerHTML = '<li class="hl-empty">действий пока нет</li>';
      return;
    }
    els.adminAudit.innerHTML = items.map(function (it) {
      var d = new Date(it.t);
      function p(n) { return ('0' + n).slice(-2); }
      return '<li class="hl-' + (it.role === 'admin' ? 'info' : 'warn') + '">' +
        '<time>' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '</time>' +
        '<b>' + esc(it.role) + '</b> · ' + esc(it.action) +
        (it.detail ? ' — ' + esc(it.detail) : '') + '</li>';
    }).join('');
  }

  /* ---------- состояние автоподдержки (v5.0) ---------- */
  function adminBuildRender() {
    if (!els.adminBuildInfo) return;
    if (!buildStatus) {
      els.adminBuildInfo.innerHTML = 'статус автоподдержки ещё не получен' +
        (location.protocol === 'file:' ? ' (только при раздаче по http)' : '');
      return;
    }
    var d = buildStatus;
    els.adminBuildInfo.innerHTML =
      'последний прогон: <b>' + esc(String(d.result || 'ok')) + '</b>' +
      (d.at ? ' · ' + esc(String(d.at)) : '') +
      (d.v ? ' · версия <b>v' + esc(String(d.v)) + '</b>' : '') +
      (d.commit ? ' · коммит <b>' + esc(String(d.commit).slice(0, 7)) + '</b>' : '') +
      (d.notes ? '<br><span class="dim2">' + esc(String(d.notes)) + '</span>' : '');
  }

  function adminCfgRender() {
    if (!els.adminCfgInfo) return;
    if (!remoteCfg.loaded) {
      els.adminCfgInfo.innerHTML = 'конфигурация ещё не загружена' +
        (location.protocol === 'file:' ? ' (только при раздаче по http)' : '');
      return;
    }
    els.adminCfgInfo.innerHTML = 'прочитано · применено: ' +
      (remoteCfg.applied.length ? esc(remoteCfg.applied.join(', ')) : 'без изменений');
  }

  /* ---------- смена кода администратора (v5.0) ---------- */
  function adminRotateCode() {
    var code = els.adminNewCode ? els.adminNewCode.value : '';
    if (!code || code.length < 8) {
      adminToast('Код слишком короткий — минимум 8 символов', 'bad');
      return false;
    }
    var salt = bytesToHex(randomBytes(16));
    var hash = pbkdf2hex(code, salt, 150000, 32);
    var codes = localCodes();
    codes.admin = { hash: hash, salt: salt, iter: 150000 };
    saveLocalCodes(codes);
    if (els.adminNewCode) els.adminNewCode.value = '';
    if (els.adminCodeExport) {
      els.adminCodeExport.value =
        "    adminHash: '" + hash + "',\r\n" +
        "    adminSalt: '" + salt + "',\r\n" +
        "    adminIter: 150000,";
    }
    adminToast('Новый код сохранён в этом браузере. Чтобы он действовал на всех устройствах — вставьте строки ниже в CONFIG (js/app.js)', 'good');
    if (window.Audit) Audit.log('admin.code.rotate', 'код администратора изменён на этом устройстве');
    return true;
  }

  function adminResetCode() {
    var codes = localCodes();
    if (!codes.admin) { adminToast('Код на этом устройстве и так взят из репозитория', ''); return; }
    delete codes.admin;
    saveLocalCodes(codes);
    adminToast('Код возвращён к значению из репозитория', 'good');
    if (window.Audit) Audit.log('admin.code.reset', 'код администратора возвращён к репозиторию');
  }

  /* ---------- сводный отчёт (v5.0) ---------- */
  function adminDump() {
    var data = {
      app: 'obzvon-overview',
      generatedAt: new Date().toISOString(),
      version: CONFIG.appVersion,
      role: ST.role,
      session: {
        state: ST.state, id: ST.sessionId, elapsed: elapsed(),
        concentration: Monitor.concentration(), cheat: Monitor.cheatPercent(),
        violations: Monitor.state.viol.length
      },
      monitor: {
        tabSwitches: Monitor.state.tabSwitches, focusLosses: Monitor.state.focusLosses,
        screens: Monitor.state.screens, copyAttempts: Monitor.state.copyAttempts,
        blockedKeys: Monitor.state.blockedKeys, reloadTries: Monitor.state.reloadTries,
        missChallenges: Monitor.state.missChallenges, devtools: Monitor.state.devtools
      },
      integrity: { ok: ST.integrityOk, dom: domIntegrity(), fingerprint: codeFingerprint() },
      watchdog: { checks: watchdog.checks, repairs: watchdog.repairs, last: watchdog.lastRepair },
      updates: { installed: CONFIG.appVersion, available: upd.found, applied: appliedUpdates() },
      build: buildStatus,
      config: remoteCfg.raw,
      health: window.Health ? Health.last() : null,
      audit: window.Audit ? Audit.report() : null,
      device: CONFIG.features.collectDevice ? Monitor.detect() : null
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'obzvon-overview-' + (ST.sessionId || 'system') + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    adminToast('Сводный отчёт сохранён', 'good');
    if (window.Audit) Audit.log('admin.dump', 'выгрузка сводного отчёта');
  }
  /* ---------- локальный стресс-тест (нагрузка внутри страницы) ---------- */
  function adminStressTest(n) {
    n = n || 20000;
    var t0 = Date.now();
    var i;
    /* 1) поток событий ввода */
    for (i = 0; i < n; i++) {
      var ev = new MouseEvent('mousemove', { bubbles: true, clientX: i % 900, clientY: (i * 7) % 600 });
      document.body.dispatchEvent(ev);
    }
    var tEvents = Date.now() - t0;
    /* 2) поток нарушений (проверка живучести журналов) */
    var t1 = Date.now();
    var viol = 1000;
    for (i = 0; i < viol; i++) Monitor.penalty('стресс-тест ' + i, 1);
    var tViol = Date.now() - t1;
    /* 3) замер памяти */
    var mem = null;
    try {
      if (window.performance && performance.memory) {
        mem = +(performance.memory.usedJSHeapSize / 1048576).toFixed(2);
      }
    } catch (e) {}
    admin.stress = {
      at: Date.now(), events: n, viol: viol,
      msEvents: tEvents, msViol: tViol, heapMB: mem,
      perEvent: +(tEvents / Math.max(1, n)).toFixed(3),
      feed: FEED.length, violLog: Monitor.state.viol.length
    };
    var box = $('adminStress');
    if (box) {
      box.innerHTML =
        '<b>' + n + '</b> событий ввода за <b>' + tEvents + ' мс</b> (' + admin.stress.perEvent + ' мс/событие) · ' +
        '<b>' + viol + '</b> нарушений за <b>' + tViol + ' мс</b>' +
        (mem !== null ? ' · heap <b>' + mem + ' МБ</b>' : '') +
        '<br><span class="dim2">журнал событий: ' + admin.stress.feed + ' записей · журнал нарушений: ' +
        admin.stress.violLog + ' (ограничен) — страница отзывчива</span>';
    }
    if (window.Health) Health.log('info', 'Локальный стресс-тест: ' + n + ' событий за ' + tEvents + ' мс');
    adminToast('Стресс-тест завершён: ' + tEvents + ' мс на ' + n + ' событий', 'good');
    return admin.stress;
  }

  if (els.btnAdminAuth) on(els.btnAdminAuth, 'click', adminAuth);
  if (els.adminPass) on(els.adminPass, 'keydown', function (e) { if (e.key === 'Enter') adminAuth(); });
  if (els.btnAdminLock) on(els.btnAdminLock, 'click', adminLock);
  if (els.btnAdminCheck) on(els.btnAdminCheck, 'click', adminCheckUpdates);
  if (els.btnAdminUpdate) on(els.btnAdminUpdate, 'click', adminApplyUpdate);
  if (els.btnAdminStress) on(els.btnAdminStress, 'click', function () { adminStressTest(20000); });
  if (els.btnAdminStressSmall) on(els.btnAdminStressSmall, 'click', function () { adminStressTest(5000); });
  if (els.btnAdminRefresh) on(els.btnAdminRefresh, 'click', function () {
    adminWatchRender(); adminAuditRender(); adminBuildRender(); adminCfgRender();
    loadBuildStatus(false); loadRemoteConfig(false);
    adminToast('Надзор обновлён', 'good');
  });
  if (els.btnAdminCfg) on(els.btnAdminCfg, 'click', function () { loadRemoteConfig(true); });
  if (els.btnAdminDump) on(els.btnAdminDump, 'click', adminDump);
  if (els.btnAdminRotate) on(els.btnAdminRotate, 'click', adminRotateCode);
  if (els.btnAdminResetCode) on(els.btnAdminResetCode, 'click', adminResetCode);
  if (els.btnAdminPolicyReset) on(els.btnAdminPolicyReset, 'click', function () {
    resetPolicies();
    adminToast('Локальные переопределения политик сброшены', 'good');
  });
  if (els.btnAdminIntegrity) on(els.btnAdminIntegrity, 'click', function () { loadIntegrity(true); });
  if (els.btnAdminStats) on(els.btnAdminStats, 'click', function () {
    adminStatsRender();
    adminToast('Статистика обновлена', 'good');
  });
  if (els.btnAdminAuditClear) on(els.btnAdminAuditClear, 'click', function () {
    if (window.Audit) { Audit.clear(); adminAuditRender(); }
    adminToast('Журнал действий очищен', 'good');
  });
  /* живой надзор: обновляем раз в секунду, пока админка открыта */
  every(1000, function () { if (admin.authed) adminWatchRender(); });
  every(5000, function () { if (admin.authed) adminAuditRender(); });
  every(10000, function () { if (admin.authed) adminStatsRender(); });
  if (els.btnAdminPurge) on(els.btnAdminPurge, 'click', function () {
    if (typeof window.confirm === 'function' && !/jsdom/i.test(navigator.userAgent || '')) {
      try { if (window.confirm('Удалить статистику, историю и состояние сессии? Действие необратимо.') === false) return; } catch (e) {}
    }
    try { localStorage.removeItem('obzvon_v2_totals'); } catch (e) {}
    try { localStorage.removeItem('obzvon_v2_history'); } catch (e2) {}
    try { localStorage.removeItem(CONFIG.storageKey); } catch (e3) {}
    if (window.Archive) Archive.clear();
    if (window.Audit) Audit.log('admin.purge', 'очистка хранилища');
    adminToast('Хранилище очищено', 'good');
    if (window.Health) Health.check();
  });
  adminRender();

  window.OBZ = {
    v: CONFIG.appVersion,
    state: function () {
      return {
        state: ST.state, sessionId: ST.sessionId, integrityOk: ST.integrityOk,
        concentration: Monitor.concentration(), cheat: Monitor.cheatPercent(),
        violations: Monitor.state.viol.length, feed: FEED.length
      };
    },
    integrity: function () { return domIntegrity(); },
    fingerprint: function () { return codeFingerprint(); },
    guard: function () { codeGuard(); },
    /* кто сейчас за пультом: null | 'curator' | 'admin' */
    role: function () { return ST.role; },
    /* конфигурация, применённая из config.json */
    config: function () { return remoteCfg.raw; },
    /* действующие политики (v6.0) */
    policies: function () { return CONFIG.policies; },
    /* журнал угроз (v6.0) */
    threats: function () { return THREATS.slice(); },
    /* статистика посещений и обзвонов (v6.1) */
    stats: function () { return window.Stats ? Stats.snapshot() : null; },
    /* настроены ли коды на этом хостинге */
    authReady: function () { return { curator: roleReady('curator'), admin: roleReady('admin') }; },
    /* журнал действий */
    audit: function () { return window.Audit ? Audit.list() : []; },
    /* отчёт о сессии (без выгрузки файла) */
    report: function () { return buildReport(); },
    /* отпечаток загруженного кода — для сверки с опубликованным */
    integrityFile: function () { return publishedIntegrity; },
    /* обновление — только тех. администратору (раньше было доступно всем) */
    update: function (v) {
      if (!admin.authed) { toast('Нужен код тех. администратора', 'bad'); return false; }
      showUpdateBanner(v || 'next');
      return true;
    },
    /* починка на уровне приложения (вызывается модулем здоровья) */
    selfRepair: function (what) {
      var acts = [];
      if (what === 'ui') {
        try {
          var busy = ['running', 'paused', 'locked'].indexOf(ST.state) >= 0;
          els.gate.hidden = busy;
          els.playfield.hidden = !busy;
          els.partPanel.hidden = !busy;
          updateWatermark();
          updateMetrics();
          acts.push('интерфейс синхронизирован с состоянием «' + ST.state + '»');
        } catch (e) {}
      }
      if (what === 'memory') {
        CONFIG.storageFallback = true;
        acts.push('localStorage недоступен — данные только в памяти вкладки');
      }
      return acts.join('; ');
    },
    watchdog: function () { return { checks: watchdog.checks, repairs: watchdog.repairs, last: watchdog.lastRepair }; },
    admin: function () { return { authed: admin.authed, latest: upd.found, notes: upd.notes, applying: upd.applying }; },
    adminAuth: adminAuth,
    adminStress: adminStressTest,
    applyUpdate: function () {
      if (!admin.authed) { toast('Нужен код тех. администратора', 'bad'); return false; }
      return applyUpdate();
    },
    /* перезапуск системы: освобождаем ресурсы и поднимаемся заново (v4.1) */
    restart: function () {
      if (!admin.authed && !ST.authed) { toast('Нужен код доступа', 'bad'); return false; }
      try { saveState(); } catch (e) {}
      try { if (window.Monitor && Monitor.stop) Monitor.stop(); } catch (e2) {}
      try { if (window.Live && Live.stop) Live.stop(); } catch (e3) {}
      try { if (window.FX && FX.stop) FX.stop(); } catch (e4) {}
      try { if (window.Health && Health.stop) Health.stop(); } catch (e5) {}
      try { location.reload(); } catch (e6) {}
      return true;
    }
  };

  if (window.Audit) Audit.init();
  if (window.Stats) Stats.init();   /* счётчик посещений */
  updateMetrics();
  updateTotalConcUI();
  restoreState();
  updateWatermark();
  noteAppliedVersion(CONFIG.appVersion);
  /* конфигурация, статус автоподдержки и отпечаток файлов подтягиваются сами */
  loadRemoteConfig(false);
  loadBuildStatus(false);
  loadIntegrity(false);
  applyPolicies();
  /* экземпляр поднялся — значит обновление уже применено: баннер закрываем,
     а метка версии приводится в соответствие с реально загруженным кодом */
  if (els.verBadge) els.verBadge.textContent = 'ВЕРСИЯ ' + CONFIG.appVersion;
  if (els.updBanner) els.updBanner.hidden = true;
  if (els.verBadge) els.verBadge.classList.remove('has-update');
  /* смена версии попадает в журнал событий */
  var appliedList = appliedUpdates();
  if (appliedList.length > 1) {
    var prevV = appliedList[appliedList.length - 2];
    if (prevV && prevV.v !== CONFIG.appVersion) {
      feedAdd({ time: ts(), label: 'Применено обновление: v' + prevV.v + ' → v' + CONFIG.appVersion, sev: 0 });
    }
  }
})();
