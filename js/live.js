/* ============================================================
   ОБЗВОН v4.0 · LIVE — живой график сессии в реальном времени
   Концентрация и «читомеряк» в динамике, отметки испытаний
   и нарушений. Рисуется на canvas, работает и на file://.
   ============================================================ */
(function () {
  'use strict';

  var MAX_SAMPLES = 900;   /* замер раз в секунду ≈ 15 минут сессии */
  var MAX_MARKS = 400;
  var H = 150;             /* высота графика, px */

  var cv = null, ctx = null;
  var samples = [];        /* {t: мс от старта, c: концентрация, x: читомеряк} */
  var marks = [];          /* {t, kind: ok|fail|viol} */
  var t0 = 0;
  var timer = null;
  var running = false;
  var last = { c: 0, x: 0 };
  var stats = { max: 0, min: 100, sum: 0, n: 0, peakCheat: 0 };

  function el(id) { return document.getElementById(id); }

  function init() {
    cv = el('liveChart');
    if (!cv || !cv.getContext) return;
    ctx = cv.getContext('2d');
    window.addEventListener('resize', resize, { passive: true });
    resize();
    updateSummary();
  }

  function resize() {
    if (!cv || !ctx) return;
    var w = Math.max(200, cv.clientWidth || 640);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
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

  /* ---------- данные ---------- */

  function reset() {
    samples = [];
    marks = [];
    t0 = Date.now();
    last = { c: 0, x: 0 };
    stats = { max: 0, min: 100, sum: 0, n: 0, peakCheat: 0 };
    updateSummary();
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
    draw();
  }

  function mark(kind) {
    if (!samples.length) return;
    marks.push({ t: Date.now() - t0, kind: kind || 'viol' });
    if (marks.length > MAX_MARKS) marks.shift();
    draw();
  }

  function start() {
    if (running) return;
    running = true;
    clearInterval(timer);
    timer = setInterval(function () { sample(last.c, last.x); }, 1000);
  }

  function stop() {
    running = false;
    clearInterval(timer);
    timer = null;
    updateSummary();
    draw();
  }

  /* ---------- сводка под графиком ---------- */

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

  /* ---------- отрисовка ---------- */

  function draw() {
    if (!ctx) return;
    var w = cv.width / (Math.min(window.devicePixelRatio || 1, 2)) || cv.clientWidth || 640;
    var h = H;
    ctx.clearRect(0, 0, w, h);

    var padL = 30, padR = 10, padT = 12, padB = 20;
    var gw = Math.max(10, w - padL - padR);
    var gh = Math.max(10, h - padT - padB);

    /* сетка */
    ctx.font = '9px Consolas,monospace';
    ctx.textBaseline = 'middle';
    [0, 25, 50, 75, 100].forEach(function (v) {
      var y = padT + gh - (v / 100) * gh;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
      ctx.fillStyle = 'rgba(125,140,163,.75)';
      ctx.textAlign = 'right';
      ctx.fillText(v + '', padL - 5, y);
    });

    if (samples.length < 2) {
      ctx.fillStyle = 'rgba(125,140,163,.55)';
      ctx.textAlign = 'center';
      ctx.font = '11px Consolas,monospace';
      ctx.fillText('ожидание данных сессии…', padL + gw / 2, padT + gh / 2);
      return;
    }

    var tMax = Math.max(1000, samples[samples.length - 1].t);
    function px(t) { return padL + (t / tMax) * gw; }
    function py(v) { return padT + gh - (v / 100) * gh; }

    /* заливка под линией концентрации */
    var grad = ctx.createLinearGradient(0, padT, 0, padT + gh);
    grad.addColorStop(0, 'rgba(91,255,157,.28)');
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
    ctx.strokeStyle = '#5bff9d';
    ctx.lineWidth = 1.8;
    ctx.shadowColor = 'rgba(91,255,157,.8)';
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* линия читомеряка */
    ctx.beginPath();
    samples.forEach(function (s, i) {
      var x = px(s.t), y = py(s.x);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(255,77,109,.75)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* отметки: испытания (ok/fail) и нарушения (viol) */
    marks.forEach(function (m) {
      var x = px(m.t);
      var col = m.kind === 'ok' ? '#9dff5b' : (m.kind === 'fail' ? '#ffb84d' : '#ff4d6d');
      if (m.kind === 'viol') {
        ctx.strokeStyle = 'rgba(255,77,109,.55)';
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

    /* последние значения */
    var lastS = samples[samples.length - 1];
    ctx.font = '10px Consolas,monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5bff9d';
    ctx.fillText(lastS.c + '%', w - padR, py(lastS.c) - 6);
    ctx.fillStyle = '#ff4d6d';
    ctx.fillText(lastS.x + '%', w - padR, py(lastS.x) + 8);

    /* ось времени */
    ctx.fillStyle = 'rgba(125,140,163,.75)';
    ctx.textAlign = 'left';
    ctx.fillText('0:00', padL, h - 7);
    ctx.textAlign = 'right';
    ctx.fillText(fmtT(tMax), w - padR, h - 7);
  }

  /* ---------- публичный API ---------- */
  window.Live = {
    init: init,
    reset: reset,
    sample: sample,
    mark: mark,
    start: start,
    stop: stop,
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
