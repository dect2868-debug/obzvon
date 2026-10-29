/* ============================================================
   ОБЗВОН v2 :: APP  (логика сессии и испытаний)
   ============================================================ */
(function () {
  'use strict';

  /* ---------- настройки (меняйте здесь) ---------- */
  var CONFIG = {
    appVersion: '2.6',        // версия (должна совпадать с version.json и ?v= в index.html)
    /* код куратора хранится закодированным (XOR 90) — открытым текстом в коде не светится;
       смена: положите новый код в пароль-куратора.txt и перекодируйте (см. README) */
    passEnc: [21, 56, 32, 44, 53, 52, 119, 104, 106, 104, 108],
    threshold: 60,            // порог «читомеряка» по умолчанию (%)
    calibCount: 100,          // испытаний калибровки по умолчанию (до 100 — длинная проверка)
    calibSpeed: 0.5,          // сложность калибровки: 0.5 = время на ответ вдвое короче
    chTimeout: 6000,          // базовый таймаут испытания, мс
    chDelayMin: 10000,        // (не используется — темп задаёт nextDelay)
    chDelayMax: 25000,
    holdMs: 2000,             // (база) удержание клавиши
    idleLimit: 65000,         // мс простоя до штрафа
    storageKey: 'obzvon_v2_state'
  };

  /* таймауты по типам испытаний (мс) */
  var CH_TIMEOUTS = { key: 4500, target: 5000, hold: 7000, math: 6000, seq: 9000, stroop: 6000 };

  var $ = function (id) { return document.getElementById(id); };

  /* расшифровка кода куратора (хранится закодированным, не открытым текстом) */
  function passNow() {
    return (CONFIG.passEnc || []).map(function (c) { return String.fromCharCode(c ^ 90); }).join('');
  }
  var els = {};
  ['sessionId','sessionTimer','statusBadge','btnSound','curatorHead','curatorBody','curatorCaret',
   'passInput','btnAuth','authRow','authHint','ctrlRow','btnStart','btnPause','btnEnd','btnFs',
   'btnReport','btnReset','chkFsReq','selThreshold','metrics','concValue','concBar','cheatValue',
   'cheatBar','focusState','tabState','screenCount','avgReaction','focusLosses','idleHits','violCount',
   'devKind','devOs','devBrowser','devInput','devScreen','devViewport','devLang','devNet','devHw','devUa',
   'gate','gateText','btnCalibrate','calibStatus','playfield','chRound','chBar','chTask','arena','chTarget',
   'signalList','feedCount','pauseOverlay','btnResume','lockOverlay','lockTitle','lockText','unlockInput',
   'btnUnlock','sumOverlay','sumTag','sumVerdict','sumTable','btnSumReport','btnSumClose','toast','stroopRow',
   'totalConc','concTrend','errBanner','selCalib','statTable','chTableBody','chStat','partPanel','chPad',
   'btnPauseSelf','btnEndSelf','achRow']
   .forEach(function (id) { els[id] = $(id); });

  /* ---------- состояние ---------- */
  var ST = {
    state: 'idle',          // idle | calib | running | paused | locked | ended
    authed: false,
    calibrated: false,
    calibDone: 0,
    sessionId: null,
    startedAt: 0,           // ms сессии (накопленные)
    runSince: 0,            // ms wall-clock старта текущего отрезка
    threshold: CONFIG.threshold,
    relockBase: 0,
    muted: false,
    lastKind: null,
    baseReaction: null   // база реакции с калибровки (мс), переживает итоги
  };

  /* ---------- утилиты ---------- */
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function fmt(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    s = s % 60;
    function p(n) { return String(n).padStart(2, '0'); }
    return (h > 0 ? p(h) + ':' : '') + p(m) + ':' + p(s);
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
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + (dur || 0.15) / 1000 * 10);
      o.stop(actx.currentTime + (dur || 150) / 1000 * 10 + 0.05);
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
    els.statTable.innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(String(r[1])) + '</td></tr>';
    }).join('');

    if (!CH_LOG.length) {
      els.chTableBody.innerHTML = '<tr class="ch-empty"><td colspan="4">испытаний не было</td></tr>';
      els.chStat.textContent = '';
      return;
    }
    var okN = 0, sumMs = 0, msN = 0;
    els.chTableBody.innerHTML = CH_LOG.map(function (r) {
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

  function logChallenge(ok, ms, note) {
    CH_LOG.push({
      n: CH_LOG.length + 1, kind: CH.kind, calib: CH.calib,
      ok: !!ok, ms: ok ? ms : null, note: note || '', time: ts()
    });
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
    if (kind === 'hold') { CH.holdMs = rnd(1500, 3000); to = CH.holdMs + 4500; }
    /* калибровка в 2 раза сложнее: время на ответ вдвое короче */
    if (calib) {
      to = kind === 'hold' ? CH.holdMs + Math.round(4500 * CONFIG.calibSpeed)
                           : Math.round(to * CONFIG.calibSpeed);
    }
    /* после 6-го испытания сессии таймауты жёстче на 20% */
    if (!calib && CH_SEANCE > 6) to = Math.round(to * 0.8);
    CH.timeout = to;
    CH.deadline = Date.now() + to;

    var taskHtml = '';
    if (kind === 'key') {
      CH.key = ABC[rnd(0, ABC.length - 1)];
      taskHtml = 'НАЖМИТЕ КЛАВИСУ <b>' + CH.key + '</b>';
    } else if (kind === 'hold') {
      taskHtml = 'УДЕРЖИВАЙТЕ <b>ПРОБЕЛ</b> ' + (CH.holdMs / 1000).toFixed(1) + ' СЕК.';
    } else if (kind === 'math') {
      var plus = Math.random() < 0.5;
      var a = rnd(3, 19), b = rnd(2, 19);
      var hi = Math.max(a, b), lo = Math.min(a, b);
      CH.answer = String(plus ? a + b : hi - lo);
      taskHtml = 'СКОЛЬКО БУДЕТ <b>' + (plus ? hi + ' + ' + lo : hi + ' − ' + lo) + '</b>? вводите цифрами';
    } else if (kind === 'seq') {
      CH.seq = '';
      for (var i = 0; i < 4; i++) CH.seq += ABC[rnd(0, ABC.length - 1)];
      taskHtml = 'ЗАПОМНИТЕ: <b class="big">' + CH.seq.split('').join(' ') + '</b>';
      CH.timers.push(setTimeout(function () {
        if (!CH.active || CH.kind !== 'seq') return;
        CH.seqReady = true;
        updateSeqView();
      }, 1700));
    } else if (kind === 'stroop') {
      var ni = rnd(0, 3), ii = ni;
      for (var t = 0; t < 5 && ii === ni; t++) ii = rnd(0, 3);
      if (ii === ni) ii = (ni + 1) % 4;
      CH.answerColor = ni;
      taskHtml = 'КЛИКНИТЕ ПО ЦВЕТУ, КОТОРЫМ НАПИСАНО СЛОВО:' +
        '<div class="stroop-word" style="color:' + STROOP_COLORS[ii][1] + '">' + STROOP_COLORS[ni][0] + '</div>';
      els.stroopRow.hidden = false;
      STROOP_COLORS.forEach(function (c, idx) {
        var b2 = document.createElement('button');
        b2.type = 'button'; b2.className = 'ch-btn'; b2.textContent = c[0];
        b2.style.background = c[1];
        b2.addEventListener('click', function () {
          if (CH.active && CH.kind === 'stroop') endChallenge(idx === CH.answerColor, 'не тот цвет');
        });
        els.stroopRow.appendChild(b2);
      });
    } else { /* target */
      taskHtml = 'КЛИКНИТЕ ПО <b>ЦЕЛИ</b>';
      els.chTarget.hidden = false;
      if (!calib && CH_SEANCE > 4) els.chTarget.classList.add('small');
      moveTarget();
      var mv = calib ? 350 : 480;
      CH.timers.push(setTimeout(moveTarget, mv));
      CH.timers.push(setTimeout(moveTarget, mv * 2));
      CH.timers.push(setTimeout(moveTarget, mv * 3));
    }
    els.chTask.innerHTML = taskHtml;
    buildPad(kind);   /* экранная панель — ответ с телефона без физической клавиатуры */

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
    if (CH.kind === 'seq') reaction = Math.max(0, reaction - 1700);
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
        els.calibStatus.innerHTML = '<span class="good">испытание ' + ST.calibDone + '/' + CONFIG.calibCount + ' зачтено</span>';
        if (ST.calibDone >= CONFIG.calibCount) {
          ST.calibrated = true;
          ST.baseReaction = Monitor.avgReaction();  /* запоминаем базу реакции участника */
          ST.state = 'idle';
          Monitor.setRunning(false);
          els.calibStatus.innerHTML = '<span class="good">✓ КАЛИБРОВКА ПРОЙДЕНА — можно начинать обзвон</span>';
          els.gateText.textContent = 'Калибровка пройдена. Дождитесь команды куратора и нажмите «Начать обзвон».';
          if (ST.authed) els.btnStart.disabled = false;
          toast('Калибровка пройдена', 'good');
          setTimeout(function () { if (ST.state === 'idle') els.playfield.hidden = true; }, 1200);
        } else {
          setTimeout(function () { runChallenge(kindRoll(true), true); }, 900);
        }
      } else {
        els.chTask.innerHTML = 'ВЕРНО · <b>' + reaction + '</b> мс';
        scheduleNext();
      }
    } else {
      Monitor.addMiss();
      sndBad();
      els.chTask.innerHTML = 'ПРОВАЛ' + (note ? ' · ' + esc(note) : '') + '';
      logChallenge(false, null, note || '');
      document.querySelector('.playfield').classList.add('shake');
      setTimeout(function () { document.querySelector('.playfield').classList.remove('shake'); }, 400);
      if (CH.calib) {
        toast('Испытание провалено — повторите калибровку', 'bad');
        setTimeout(function () { ST.calibDone = 0; CH_LOG = []; updateTables(); els.calibStatus.innerHTML = '<span class="bad">калибровка не пройдена — попробуйте снова</span>'; ST.state = 'idle'; Monitor.setRunning(false); els.btnStart.disabled = !(ST.authed && ST.calibrated); }, 1200);
      } else {
        toast('Испытание провалено! +8 к «читомеряку»', 'bad');
        scheduleNext();
      }
    }
    updateMetrics();
    /* события в журнале: сеансовые испытания целиком, калибровка — только итогом */
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

  document.addEventListener('keydown', function (e) {
    if (!CH.active) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if (CH.kind === 'hold' && e.code === 'Space') { e.preventDefault(); holdDown(); return; }
    codePress(e.code);
  });
  document.addEventListener('keyup', function (e) {
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
      hb.addEventListener('pointerdown', down);
      hb.addEventListener('pointerup', up);
      hb.addEventListener('pointercancel', up);
      hb.addEventListener('pointerleave', up);
      hb.addEventListener('touchstart', down, { passive: false });
      hb.addEventListener('touchend', up, { passive: false });
      hb.addEventListener('touchcancel', up, { passive: false });
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
      b.addEventListener('click', function () { codePress(code); });
      els.chPad.appendChild(b);
    });
    els.chPad.hidden = false;
  }
  els.chTarget.addEventListener('click', function () { if (CH.active && CH.kind === 'target') endChallenge(true, ''); });

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
    ST.sessionId = 'OBZ-' + Math.random().toString(16).slice(2, 6).toUpperCase() + '-' + Date.now().toString(36).slice(-4).toUpperCase();
    els.sessionId.textContent = 'сессия ' + ST.sessionId;
    setBadge('идёт', 'badge-run');
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
    toast('Обзвон начат. Испытания будут появляться каждые 10–25 секунд', 'good');
    beep(660, 200, 'sine', .05);
    CH_SEANCE = 1;
    scheduleNext();
    saveState();
  }

  function pauseSession() {
    if (ST.state !== 'running') return;
    ST.state = 'paused';
    Monitor.setRunning(false);
    clearChTimers(); CH.active = false; Monitor.setChallengeActive(false);
    els.chTarget.hidden = true;
    setBadge('пауза', 'badge-pause');
    els.pauseOverlay.hidden = false;
    els.btnPause.disabled = true; els.btnResume.disabled = false;
    els.btnPauseSelf.textContent = '▶ Продолжить';
    els.btnPauseSelf.disabled = false;
    saveState();
  }

  function resumeSession() {
    if (ST.state !== 'paused') return;
    ST.state = 'running';
    ST.runSince = Date.now();
    Monitor.setRunning(true);
    els.pauseOverlay.hidden = true;
    setBadge('идёт', 'badge-run');
    els.btnPause.disabled = false;
    els.btnPauseSelf.textContent = '⏸ Пауза';
    feedAdd({ time: ts(), label: 'Обзвон продолжен', sev: 0 });
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
    ST.state = 'locked';
    Monitor.setRunning(false);
    clearChTimers(); CH.active = false; Monitor.setChallengeActive(false);
    els.chTarget.hidden = true;
    setBadge('блокировка', 'badge-lock');
    sndAlarm();
    var v = Monitor.state.viol.slice(-3).map(function (x) { return '· ' + x.label; }).join('\n');
    els.lockText.textContent = '«Читомеряк» достиг ' + Monitor.cheatPercent() + '% (порог ' + ST.threshold + '%). Последние события:\n' + v;
    els.lockText.style.whiteSpace = 'pre-line';
    els.lockOverlay.hidden = false;
    document.body.classList.add('shake');
    setTimeout(function () { document.body.classList.remove('shake'); }, 400);
    saveState();
  }

  function endSession() {
    if (['running', 'paused', 'locked'].indexOf(ST.state) < 0) return;
    var wasState = ST.state;
    ST.state = 'ended';
    Monitor.setRunning(false);
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
    var rows = [
      ['Длительность', fmt(elapsed())],
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
      ['Нарушений всего', S.viol.length]
    ];
    els.sumTable.innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(String(r[1])) + '</td></tr>';
    }).join('');

    /* результаты: таблица метрик и журнал испытаний финализируются */
    updateTables();
    /* фишки */
    var achList = renderAch(computeAch());

    els.sumOverlay.hidden = false;
    if (verdict === 'ЗАЧЁТ') sndGood(); else sndBad();
    toast('Средняя концентрация обновлена: ' + totAvg + '%', 'good', 4200);
    feedAdd({ time: ts(), label: 'Обзвон завершён · вердикт: ' + verdict + ' · ср. концентрация ' + totAvg + '% · фишек: ' + achList.length, sev: verdict === 'ЗАЧЁТ' ? 0 : 2 });
    clearState();
  }

  function resetAll() {
    ST.state = 'idle'; ST.startedAt = 0; ST.calibDone = 0; ST.relockBase = 0;
    /* монитор НЕ сбрасываем: финальные цифры концентрации/читомеряка остаются
       на экране до старта нового обзвона (новый сброс — в startSession) */
    Monitor.setRunning(false);
    clearChTimers(); CH.active = false; Monitor.setChallengeActive(false);
    clearState();
    els.sessionId.textContent = 'сессия — …';
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
    updateMetrics();
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
    var chOk = CH_LOG.filter(function (r) { return r.ok; }).length;
    var seance = CH_LOG.filter(function (r) { return !r.calib; }).length;
    var okSeance = CH_LOG.filter(function (r) { return !r.calib && r.ok; }).length;
    var msAll = CH_LOG.filter(function (r) { return r.ok && r.ms; }).map(function (r) { return r.ms; });
    var fastest = msAll.length ? Math.min.apply(null, msAll) : null;
    var ar = Monitor.avgReaction();
    var list = [];
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
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && ST.state === 'running' && els.chkFsReq.checked) {
      Monitor.penalty('Выход из полноэкранного режима', 3);
    }
  });

  /* ---------- защита от перезагрузки ---------- */
  function saveState() {
    if (['running', 'paused', 'locked'].indexOf(ST.state) < 0) return;
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        state: ST.state, sessionId: ST.sessionId, elapsed: elapsed(),
        score: Monitor.state.score, viol: Monitor.state.viol,
        tabSwitches: Monitor.state.tabSwitches, focusLosses: Monitor.state.focusLosses,
        idleHits: Monitor.state.idleHits, missChallenges: Monitor.state.missChallenges,
        reactions: Monitor.state.reactions, screens: Monitor.state.screens,
        chLog: CH_LOG, baseReaction: ST.baseReaction,
        feed: FEED.slice(-40),
        updatedAt: Date.now()
      }));
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

    /* обзвон шёл и страницу перезагрузили — это нарушение */
    ST.state = 'running';
    ST.authed = true; ST.calibrated = true;
    ST.sessionId = d.sessionId;
    ST.startedAt = d.elapsed || 0; ST.runSince = Date.now();
    ST.baseReaction = d.baseReaction || null;
    CH_LOG = d.chLog || [];
    FEED = d.feed || [];
    els.signalList.innerHTML = '';
    feedRebuild();
    els.authRow.hidden = true; els.ctrlRow.hidden = false; els.authHint.hidden = true;
    els.sessionId.textContent = 'сессия ' + ST.sessionId;
    setBadge('идёт', 'badge-run');
    els.gate.hidden = true; els.playfield.hidden = false; els.partPanel.hidden = false;
    els.btnPauseSelf.textContent = '⏸ Пауза';
    els.btnStart.disabled = true; els.btnPause.disabled = false; els.btnEnd.disabled = false;
    Monitor.reset();
    var S = Monitor.state;
    S.score = d.score || 0; S.viol = d.viol || []; S.tabSwitches = d.tabSwitches || 0;
    S.focusLosses = d.focusLosses || 0; S.idleHits = d.idleHits || 0;
    S.missChallenges = d.missChallenges || 0; S.reactions = d.reactions || []; S.screens = d.screens || 1;
    Monitor.setRunning(true);
    Monitor.addReloadGuardPenalty();
    feedAdd({ time: ts(), label: 'Сессия восстановлена после перезагрузки (+6)', sev: 2 });
    toast('Обнаружена перезагрузка страницы во время обзвона! +6 к «читомеряку»', 'bad', 5200);
    scheduleNext();
    updateMetrics();
  }

  window.addEventListener('beforeunload', function () {
    if (['running', 'paused', 'locked'].indexOf(ST.state) >= 0) {
      saveState();
      return 'Обзвон ещё не завершён!';
    }
  });
  setInterval(saveState, 2500);

  /* ---------- отчёт ---------- */
  function downloadReport() {
    var data = Monitor.report({ session: ST.sessionId, verdict: els.sumVerdict.textContent || null });
    data.totals = loadTotals();
    data.challenges = CH_LOG.slice();
    data.achievements = (loadTotals().ach) || {};
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'obzvon-report-' + (ST.sessionId || 'no-session') + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ============================================================
     ПУЛЬТ КУРАТОРА
     ============================================================ */
  els.curatorHead.addEventListener('click', function () {
    var open = els.curatorBody.hidden;
    els.curatorBody.hidden = !open;
    els.curatorCaret.classList.toggle('open', open);
  });

  els.btnAuth.addEventListener('click', doAuth);
  els.passInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAuth(); });
  function doAuth() {
    if (els.passInput.value === passNow()) {
      ST.authed = true;
      els.authRow.hidden = true; els.ctrlRow.hidden = false; els.authHint.hidden = true;
      toast('Пульт куратора разблокирован', 'good');
      if (ST.calibrated) els.btnStart.disabled = false;
    } else {
      toast('Неверный код доступа', 'bad');
      els.passInput.value = '';
      document.querySelector('.curator-panel').classList.add('shake');
      setTimeout(function () { document.querySelector('.curator-panel').classList.remove('shake'); }, 400);
    }
  }

  els.btnStart.addEventListener('click', startSession);

  /* логотип: счётчик нажатий (для аналитики дублей кликов) */
  (function () {
    var logo = document.querySelector('.logo');
    if (!logo) return;
    var taps = 0, tmr = null, need = (0x14 >> 2) + ((0x9 & 0x1) * 0);
    logo.addEventListener('click', function () {
      if (ST.state !== 'idle') return;
      taps++;
      clearTimeout(tmr);
      tmr = setTimeout(function () { taps = 0; }, 2200);
      if (taps >= need) {
        taps = 0; clearTimeout(tmr);
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
  els.btnPause.addEventListener('click', pauseSession);
  els.btnResume.addEventListener('click', resumeSession);
  els.btnEnd.addEventListener('click', function () {
    if (ST.state === 'idle' || ST.state === 'calib') { toast('Обзвон ещё не начат', 'bad'); return; }
    endSession();
  });
  els.btnFs.addEventListener('click', goFullscreen);
  els.btnReport.addEventListener('click', downloadReport);
  els.btnSumReport.addEventListener('click', downloadReport);
  els.btnSumClose.addEventListener('click', function () { els.sumOverlay.hidden = true; resetAll(); });
  els.btnReset.addEventListener('click', resetAll);
  els.selThreshold.addEventListener('change', function () { ST.threshold = parseInt(els.selThreshold.value, 10); });

  /* сложность калибровки: 6 / 10 / 20 / 50 / 100 заданий */
  function syncCalibBtn() {
    els.btnCalibrate.textContent = '◎ Калибровка (' + CONFIG.calibCount + ' испытаний)';
  }
  if (els.selCalib) { els.selCalib.value = String(CONFIG.calibCount); }
  els.selCalib.addEventListener('change', function () {
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
  els.btnPauseSelf.addEventListener('click', function () {
    if (ST.state === 'running') {
      pauseSession();
      toast('Обзвон на паузе — продолжите по согласованию с куратором', '');
    } else if (ST.state === 'paused') {
      resumeSession();
    }
  });
  els.btnEndSelf.addEventListener('click', function () {
    if (['running', 'paused', 'locked'].indexOf(ST.state) < 0) { toast('Обзвон ещё не начат', 'bad'); return; }
    var okEnd = true;
    if (typeof window.confirm === 'function' && !/jsdom/i.test(navigator.userAgent || '')) {
      try { okEnd = window.confirm('Завершить обзвон сейчас? Будут подведены итоги и выданы результаты.') !== false; } catch (e) {}
    }
    if (!okEnd) return;
    feedAdd({ time: ts(), label: 'Участник завершил обзвон самостоятельно', sev: 1 });
    endSession();
  });
  els.chkFsReq.addEventListener('change', function () {
    if (els.chkFsReq.checked && ST.state === 'running') goFullscreen();
  });
  els.btnSound.addEventListener('click', function () {
    ST.muted = !ST.muted;
    els.btnSound.textContent = ST.muted ? '🔇' : '🔊';
    els.btnSound.classList.toggle('off', ST.muted);
  });

  els.btnUnlock.addEventListener('click', function () {
    if (els.unlockInput.value === passNow()) {
      ST.state = 'running'; ST.runSince = Date.now();
      ST.relockBase = Monitor.cheatPercent();
      Monitor.setRunning(true);
      els.lockOverlay.hidden = true;
      setBadge('идёт', 'badge-run');
      feedAdd({ time: ts(), label: 'Блокировка снята куратором', sev: 0 });
      toast('Блокировка снята. «Читомеряк» сохранён', 'good');
      scheduleNext();
    } else {
      toast('Неверный код', 'bad');
      els.unlockInput.value = '';
    }
  });
  els.unlockInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') els.btnUnlock.click(); });

  els.btnCalibrate.addEventListener('click', function () {
    if (ST.state !== 'idle') { toast('Сейчас это недоступно', 'bad'); return; }
    ST.state = 'calib'; ST.calibDone = 0;
    CH_LOG = [];           /* новая калибровка — чистый журнал */
    updateTables();
    Monitor.setRunning(true);   /* на калибровке тоже ловим смену вкладок и уходы */
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
      toast(item.label + '  (+' + item.weight + ')', item.sev >= 2 ? 'bad' : '');
      document.body.classList.add('shake');
      setTimeout(function () { document.body.classList.remove('shake'); }, 400);
      beep(item.sev >= 2 ? 220 : 440, 180, 'square', .04);
      updateMetrics();
      if (shouldLock()) lockSession();
    },
    focus: updateMetrics,
    tick: function () {
      updateMetrics();
      if (ST.state === 'running') {
        els.sessionTimer.textContent = fmt(elapsed());
        if (shouldLock()) lockSession();
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

  /* защита контекстного меню на всём документе (даже вне сессии) */
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* кнопка калибровки — количество из конфига */
  syncCalibBtn();

  /* ---------- видимая диагностика ошибок скриптов ---------- */
  window.addEventListener('error', function (e) {
    var b = els.errBanner;
    if (!b) return;
    b.textContent = 'Ошибка скрипта: ' + (e.message || 'неизвестно') + ' · обновите страницу (Ctrl+F5)';
    b.hidden = false;
    clearTimeout(b._t);
    b._t = setTimeout(function () { b.hidden = true; }, 12000);
  });

  /* ---------- авто-проверка обновлений (только при раздаче по http) ---------- */
  function checkUpdates() {
    if (location.protocol === 'file:' || !window.fetch) return;
    fetch('version.json?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.v && d.v !== CONFIG.appVersion) {
          toast('Доступна новая версия ' + d.v + ' — обновите страницу (Ctrl+F5)', 'bad', 9000);
        }
      })
      .catch(function () {});
  }
  setTimeout(checkUpdates, 5000);

  updateMetrics();
  updateTotalConcUI();
  restoreState();
})();
