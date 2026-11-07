/* ============================================================
   ОБЗВОН v7.10 · LIVE — живая динамика сессии
   График концентрации и «читомеряка» в реальном времени,
   отметки испытаний и нарушений, живая лента событий.
   v4.1: самопочинка (repair), адаптация к размеру окна,
   работает с самого начала обзвона (включая калибровку),
   значения в шапке панели и пульсирующий индикатор LIVE.
   ============================================================ */
(function () {
  'use strict';

  var MAX_SAMPLES = 1200;  /* замер раз в секунду ≈ 20 минут сессии */
  var MAX_MARKS = 600;
  var H = 150;             /* высота графика, px */

  var cv = null, ctx = null;
  var samples = [];        /* {t: мс от старта, c: концентрация, x: читомеряк} */
  var marks = [];          /* {t, kind: ok|fail|viol, label} */
  var t0 = 0;
  var timer = null;
  var running = false;
  var last = { c: 0, x: 0 };
  var lastEvent = '';
  var stats = { max: 0, min: 100, sum: 0, n: 0, peakCheat: 0 };
  var ro = null;
  var animTimer = null;     /* плавная перерисовка во время сессии (v4.8) */

  function el(id) { return document.getElementById(id); }

  /* ---------- canvas: создаём и восстанавливаем при необходимости ---------- */

  /* если элемент графика удалили — создаём его заново (самопочинка v4.1) */
  function recreateCanvas() {
    var host = el('livePanel') || el('liveSummary');
    if (!host) return null;
    var box = host.querySelector('.panel-body') || host;
    var nc = document.createElement('canvas');
    nc.id = 'liveChart';
    nc.width = 640; nc.height = H;
    nc.setAttribute('aria-label', 'График концентрации и читомеряка');
    var first = box.querySelector('canvas');
    if (first && first.parentNode) first.parentNode.replaceChild(nc, first);
    else box.insertBefore(nc, box.firstChild);
    return nc;
  }

  function ensureCanvas() {
    cv = el('liveChart');
    if (!cv) { cv = recreateCanvas(); ctx = null; }
    if (!cv) return false;
    if (!ctx) {
      try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
    }
    /* контекст мог быть потерян — пробуем пересоздать */
    if (!ctx && cv.getContext) {
      try { ctx = cv.getContext('2d'); } catch (e2) { ctx = null; }
    }
    return !!ctx;
  }

  function observe() {
    if (ro || !window.ResizeObserver) return;
    try {
      ro = new ResizeObserver(function () { resize(); });
      if (cv && cv.parentNode) ro.observe(cv.parentNode);
    } catch (e) { ro = null; }
  }

  function resize() {
    if (!ensureCanvas()) return;
    var w = Math.max(200, cv.clientWidth || 640);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function init() {
    ensureCanvas();
    observe();
    window.addEventListener('resize', resize, { passive: true });
    resize();
    updateSummary();
    updateNow();
  }

  /* самопочинка: если canvas пропал или контекст не отдал — пересоздаём */
  function repair() {
    var ok = ensureCanvas();
    if (!ok) return false;
    observe();
    resize();
    updateSummary();
    updateNow();
    return true;
  }

  function fmtT(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    function p(n) { return ('0' + n).slice(-2); }
    if (h > 0) return h + ':' + p(m) + ':' + p(sec);
    return m > 0 ? m + ':' + p(sec) : (sec + ' с');
  }

  function fmtClock(ts) {
    var d = new Date(ts);
    function p(n) { return ('0' + n).slice(-2); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ---------- данные ---------- */

  function reset() {
    samples = [];
    marks = [];
    t0 = Date.now();
    last = { c: 0, x: 0 };
    lastEvent = '';
    stats = { max: 0, min: 100, sum: 0, n: 0, peakCheat: 0 };
    updateSummary();
    updateNow();
    updateTicker();
    draw();
  }

  function sample(conc, cheat) {
    var c = Math.max(0, Math.min(100, Math.round(conc || 0)));
    var x = Math.max(0, Math.min(100, Math.round(cheat || 0)));
    last.c = c; last.x = x;
    if (!t0) t0 = Date.now();          /* первый замер задаёт начало отсчёта */
    var t = Date.now() - t0;
    samples.push({ t: t, c: c, x: x });
    if (samples.length > MAX_SAMPLES) samples.shift();
    stats.max = Math.max(stats.max, c);
    stats.min = Math.min(stats.min, c);
    stats.peakCheat = Math.max(stats.peakCheat, x);
    stats.sum += c; stats.n++;
    updateSummary();
    updateNow();
    draw();
  }

  function mark(kind, label) {
    if (!samples.length && !t0) t0 = Date.now();
    marks.push({ t: Date.now() - t0, kind: kind || 'viol', label: label || '' });
    if (marks.length > MAX_MARKS) marks.shift();
    if (label) { lastEvent = label; updateTicker(); }
    draw();
  }

  function start() {
    if (running) return;
    running = true;
    if (!t0) t0 = Date.now();
    clearInterval(timer);
    timer = setInterval(function () { sample(last.c, last.x); }, 1000);
    /* мягкая перерисовка 20 раз в секунду: «живая точка» на конце линии
       и ореол дышат плавно, без рывков (v4.8) */
    clearInterval(animTimer);
    animTimer = setInterval(draw, 50);
    setLive(true);
  }

  function stop() {
    running = false;
    clearInterval(timer);
    timer = null;
    clearInterval(animTimer);
    animTimer = null;
    setLive(false);
    updateSummary();
    draw();
  }

  function setLive(on) {
    var badge = el('liveBadge');
    if (!badge) return;
    badge.hidden = !on;
    if (on) badge.classList.add('on');
  }

  /* ---------- значения в шапке и сводка ---------- */

  function updateNow() {
    var box = el('liveNow');
    if (!box) return;
    box.innerHTML = 'КОНЦ <b>' + last.c + '%</b> · ЧИТ <b>' + last.x + '%</b>';
  }

  function updateSummary() {
    var box = el('liveSummary');
    if (!box) return;
    var avg = stats.n ? Math.round(stats.sum / stats.n) : 0;
    var parts = [];
    parts.push('средняя <b>' + avg + '%</b>');
    parts.push('пик <b>' + (stats.n ? stats.max : 0) + '%</b>');
    parts.push('минимум <b>' + (stats.n ? stats.min : 0) + '%</b>');
    parts.push('макс. читомеряк <b>' + stats.peakCheat + '%</b>');
    parts.push('замеров <b>' + stats.n + '</b>');
    box.innerHTML = parts.join(' · ');
  }

  function updateTicker() {
    var box = el('liveTicker');
    if (!box) return;
    if (!lastEvent) { box.textContent = 'событий пока нет'; box.classList.remove('has'); return; }
    box.textContent = fmtClock(Date.now()) + ' · ' + lastEvent;
    box.classList.add('has');
  }

  /* ---------- отрисовка ---------- */

  function draw() {
    if (!ensureCanvas()) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.width / dpr || cv.clientWidth || 640;
    var h = H;
    ctx.clearRect(0, 0, w, h);

    var padL = 30, padR = 44, padT = 12, padB = 20;
    var gw = Math.max(10, w - padL - padR);
    var gh = Math.max(10, h - padT - padB);

    /* сетка — рисуется всегда, чтобы панель не выглядела «мёртвой» */
    ctx.font = '9px Consolas,monospace';
    ctx.textBaseline = 'middle';
    [0, 25, 50, 75, 100].forEach(function (v) {
      var y = padT + gh - (v / 100) * gh;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
      ctx.fillStyle = 'rgba(140,155,175,.7)';
      ctx.textAlign = 'right';
      ctx.fillText(v + '', padL - 5, y);
    });

    if (samples.length < 2) {
      /* ожидание: пульсирующая линия + подсказка */
      var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
      ctx.strokeStyle = 'rgba(140,175,205,' + (0.18 + pulse * 0.18).toFixed(3) + ')';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(padL, padT + gh / 2);
      ctx.lineTo(padL + gw, padT + gh / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(140,155,175,.7)';
      ctx.textAlign = 'center';
      ctx.font = '11px Consolas,monospace';
      ctx.fillText(running ? 'идёт измерение…' : 'ожидание данных сессии…', padL + gw / 2, padT + gh / 2 - 14);
      return;
    }

    var tMax = Math.max(1000, samples[samples.length - 1].t);
    function px(t) { return padL + (t / tMax) * gw; }
    function py(v) { return padT + gh - (v / 100) * gh; }

    /* заливка под линией концентрации */
    var grad = ctx.createLinearGradient(0, padT, 0, padT + gh);
    grad.addColorStop(0, 'rgba(99,223,148,.16)');
    grad.addColorStop(1, 'rgba(91,255,157,0)');
    ctx.beginPath();
    ctx.moveTo(px(samples[0].t), py(0));
    samples.forEach(function (s) { ctx.lineTo(px(s.t), py(s.c)); });
    ctx.lineTo(px(samples[samples.length - 1].t), py(0));
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    /* линия концентрации */
    ctx.beginPath();
    samples.forEach(function (s, i) {
      var x = px(s.t), y = py(s.c);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = '#63df94';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = 'rgba(99,223,148,.35)';
    ctx.shadowBlur = 3;
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* линия читомеряка */
    ctx.beginPath();
    samples.forEach(function (s, i) {
      var x = px(s.t), y = py(s.x);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = '#f0616f';
    ctx.lineWidth = 1.4;
    ctx.shadowColor = 'rgba(240,97,111,.3)';
    ctx.shadowBlur = 3;
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* отметки: испытания (ok/fail) и нарушения (viol) */
    marks.forEach(function (m) {
      var x = px(m.t);
      var col = m.kind === 'ok' ? '#63df94' : (m.kind === 'fail' ? '#e8b45a' : '#f0616f');
      if (m.kind === 'viol') {
        ctx.strokeStyle = 'rgba(240,97,111,.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + gh); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x, padT + 4, 2.6, 0, 6.2832); ctx.fill();
      } else {
        ctx.fillStyle = col;
        ctx.globalAlpha = .85;
        ctx.beginPath();
        ctx.moveTo(x, padT + gh - 3);
        ctx.lineTo(x - 3, padT + gh + 3);
        ctx.lineTo(x + 3, padT + gh + 3);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });

    /* «живая точка» на конце линии концентрации: медленное мягкое свечение */
    var lastS = samples[samples.length - 1];
    var lx = px(lastS.t), ly = py(lastS.c);
    var breathe = 0.5 + 0.5 * Math.sin(Date.now() / 900);
    ctx.beginPath();
    ctx.arc(lx, ly, 3.2 + breathe * 1.6, 0, 6.2832);
    ctx.fillStyle = 'rgba(99,223,148,' + (0.10 + breathe * 0.12).toFixed(3) + ')';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, ly, 2.1, 0, 6.2832);
    ctx.fillStyle = '#63df94';
    ctx.fill();

    /* последние значения */
    ctx.font = '10px Consolas,monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#63df94';
    ctx.fillText(lastS.c + '%', w - padR + 38, py(lastS.c) - 6);
    ctx.fillStyle = '#f0616f';
    ctx.fillText(lastS.x + '%', w - padR + 38, py(lastS.x) + 8);

    /* ось времени */
    ctx.fillStyle = 'rgba(140,155,175,.7)';
    ctx.textAlign = 'left';
    ctx.fillText('0:00', padL, h - 7);
    ctx.textAlign = 'right';
    ctx.fillText(fmtT(tMax), w - padR + 38, h - 7);
  }

  /* ---------- публичный API ---------- */
  window.Live = {
    init: init,
    reset: reset,
    sample: sample,
    mark: mark,
    start: start,
    stop: stop,
    repair: repair,
    running: function () { return running; },
    lastSampleAt: function () { return samples.length ? samples[samples.length - 1].t : 0; },
    stats: function () {
      return {
        avg: stats.n ? Math.round(stats.sum / stats.n) : 0,
        max: stats.n ? stats.max : 0,
        min: stats.n ? stats.min : 0,
        peakCheat: stats.peakCheat,
        n: stats.n
      };
    },
    data: function () { return { samples: samples.slice(), marks: marks.slice() }; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
