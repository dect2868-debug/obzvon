/* ============================================================
   ОБЗВОН v3.1 · EPIC FX — космический фон + неоновые глифы:
   живые мерцающие звёзды с параллаксом, редкие падающие
   звёзды, колонны падающих цифровых глифов, 3D-наклон
   карточек по курсору. Уважает prefers-reduced-motion.
   Работает и на file://
   ============================================================ */
(function () {
  'use strict';
  var cv = document.getElementById('fxCanvas');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  if (!ctx) return;

  var W = 0, H = 0;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var stars = [], shots = [], glyphs = [];
  var t = 0, raf = 0;
  var mx = 0, my = 0, px = 0, py = 0;          /* параллакс от курсора */
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var GLYPH_CHARS = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/\\|+=';
  var GLYPH_COLORS = ['rgba(255,77,216,', 'rgba(52,231,255,', 'rgba(139,92,246,'];

  function resize() {
    W = cv.clientWidth || window.innerWidth;
    H = cv.clientHeight || window.innerHeight;
    cv.width = Math.max(1, Math.round(W * DPR));
    cv.height = Math.max(1, Math.round(H * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  function build() {
    var n = Math.round(Math.min(170, Math.max(70, (W * H) / 13000)));
    stars = [];
    for (var i = 0; i < n; i++) {
      var r = Math.random();
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: Math.random() * 0.8 + 0.2,               /* глубина */
        r: Math.random() * 1.3 + 0.3,
        tw: Math.random() * Math.PI * 2,
        ts: Math.random() * 0.02 + 0.006,           /* скорость мерцания */
        hue: r < 0.10 ? (r < 0.05 ? '#9dff5b' : '#c084fc') : '#cfe9ff'
      });
    }
    /* колонны падающих глифов — редкие, слабые, только для декора */
    glyphs = [];
    var cols = Math.round(Math.min(14, Math.max(4, W / 130)));
    for (var g = 0; g < cols; g++) {
      glyphs.push({
        x: Math.random() * W,
        y: Math.random() * H,
        sp: Math.random() * 0.7 + 0.25,
        len: Math.round(Math.random() * 8 + 4),
        a: Math.random() * Math.PI * 2
      });
    }
  }

  function glyphChar() {
    return GLYPH_CHARS.charAt(Math.floor(Math.random() * GLYPH_CHARS.length));
  }

  function drawStatic() {
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = 0.35 + s.z * 0.5;
      ctx.fillStyle = s.hue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * s.z + 0.2, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function frame() {
    t++;
    /* мягкий след параллакса */
    px += (mx - px) * 0.04;
    py += (my - py) * 0.04;

    ctx.clearRect(0, 0, W, H);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.tw += s.ts;
      var a = (0.30 + Math.abs(Math.sin(s.tw)) * 0.55) * (0.4 + s.z * 0.6);
      var sx = s.x + px * 26 * s.z;
      var sy = (s.y + t * 0.016 * s.z + py * 18 * s.z);
      sy = ((sy % H) + H) % H;

      ctx.globalAlpha = Math.min(1, a);
      ctx.fillStyle = s.hue;
      ctx.beginPath();
      ctx.arc(sx, sy, s.r * s.z + 0.2, 0, 6.2832);
      ctx.fill();

      /* у крупных — мягкий крест блика */
      if (s.r > 1.15) {
        ctx.globalAlpha = a * 0.45;
        ctx.fillRect(sx - 3.4 * s.z, sy - 0.35, 6.8 * s.z, 0.7);
        ctx.fillRect(sx - 0.35, sy - 3.4 * s.z, 0.7, 6.8 * s.z);
      }
    }

    /* падающие глифы (киберпанк-дождь, слабый) */
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'center';
    for (var k = 0; k < glyphs.length; k++) {
      var gl = glyphs[k];
      gl.y += gl.sp;
      if (gl.y - gl.len * 14 > H) { gl.y = -Math.random() * 120; gl.x = Math.random() * W; }
      var base = GLYPH_COLORS[k % GLYPH_COLORS.length];
      for (var c = 0; c < gl.len; c++) {
        var cy = gl.y - c * 14;
        if (cy < -16 || cy > H + 16) continue;
        var fade = (1 - c / gl.len) * 0.20;
        if (Math.random() < 0.02) continue;             /* редкая «мигает» */
        ctx.fillStyle = base + fade.toFixed(3) + ')';
        ctx.fillText(glyphChar(), gl.x + px * 14, cy + py * 8);
      }
      /* яркая «голова» */
      ctx.fillStyle = base + '0.42)';
      ctx.fillText(glyphChar(), gl.x + px * 14, gl.y + py * 8);
    }

    /* падающие звёзды */
    if (shots.length < 3 && Math.random() < 0.0045) {
      shots.push({
        x: Math.random() * W * 0.75 + W * 0.2,
        y: Math.random() * H * 0.45,
        vx: 3.2 + Math.random() * 3.2,
        vy: 1.5 + Math.random() * 1.3,
        life: 1
      });
    }
    for (var j = shots.length - 1; j >= 0; j--) {
      var sh = shots[j];
      sh.x += sh.vx; sh.y += sh.vy; sh.life -= 0.011;
      var L = 11;
      var g = ctx.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * L, sh.y - sh.vy * L);
      g.addColorStop(0, 'rgba(255,255,255,' + Math.max(0, sh.life).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(120,220,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.7;
      ctx.globalAlpha = Math.max(0, sh.life);
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * L, sh.y - sh.vy * L);
      ctx.stroke();
      if (sh.life <= 0 || sh.x > W + 100 || sh.y > H + 100) shots.splice(j, 1);
    }

    ctx.globalAlpha = 1;
    raf = window.requestAnimationFrame(frame);
  }

  function start() {
    if (reduce) { drawStatic(); return; }
    if (!raf) raf = window.requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('mousemove', function (e) {
    mx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    my = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
  }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  /* ---------- 3D-наклон карточек по курсору ---------- */
  function initTilt() {
    if (reduce) return;
    if (!window.matchMedia || !window.matchMedia('(pointer:fine)').matches) return;
    var cards = document.querySelectorAll('.metric, .gate-card');
    for (var i = 0; i < cards.length; i++) {
      (function (el) {
        var raf2 = 0;
        el.addEventListener('mousemove', function (e) {
          if (raf2) return;
          raf2 = window.requestAnimationFrame(function () {
            raf2 = 0;
            var r = el.getBoundingClientRect();
            var dx = (e.clientX - r.left) / Math.max(1, r.width) - 0.5;
            var dy = (e.clientY - r.top) / Math.max(1, r.height) - 0.5;
            el.style.transform = 'perspective(700px) rotateX(' + (-dy * 7).toFixed(2) +
              'deg) rotateY(' + (dx * 9).toFixed(2) + 'deg) translateY(-3px)';
          });
        });
        el.addEventListener('mouseleave', function () { el.style.transform = ''; });
      })(cards[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTilt);
  else initTilt();

  resize();
  start();
})();
