/* ============================================================
   ОБЗВОН v9.3 · FX — спокойный космический фон.
   По умолчанию только редкие мерцающие звёзды с лёгким
   параллаксом. Дождь глифов, падающие звёзды, искры при клике,
   след за курсором и импульсные волны отключены: они
   перекрывали интерфейс и выглядели как сломанная графика.
   Уважает prefers-reduced-motion. Работает и на file://
   ============================================================ */
(function () {
  'use strict';
  var cv = document.getElementById('fxCanvas');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  if (!ctx) return;

  var W = 0, H = 0;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var stars = [], shots = [], glyphs = [], sparks = [], trail = [], rings = [];
  var SPARK_COLORS = ['#34e7ff', '#ff4dd8', '#9dff5b', '#c084fc'];
  var TRAIL_COLORS = ['rgba(52,231,255,', 'rgba(255,77,216,', 'rgba(157,255,91,'];
  var t = 0, raf = 0;
  var mx = 0, my = 0, px = 0, py = 0;          /* параллакс от курсора */
  var cxp = -1, cyp = -1;                       /* позиция курсора в px */
  var flashColor = null, flashLife = 0;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  /* v4.6: спокойный режим — только звёзды. Лишние эффекты выключены:
     дождь глифов, падающие звёзды, искры и след курсора убраны —
     они перекрывали интерфейс и выглядели как «сломанная» графика. */
  var CALM = true;
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
    var n = CALM
      ? Math.round(Math.min(90, Math.max(34, (W * H) / 26000)))
      : Math.round(Math.min(170, Math.max(70, (W * H) / 13000)));
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
    /* колонны падающих глифов — только в обычном режиме (v4.6: спокойно) */
    glyphs = [];
    if (CALM) return;
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
    if (!CALM) {
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

    } /* конец блока глифов (v4.6) */

    /* падающие звёзды */
    if (!CALM && shots.length < 3 && Math.random() < 0.0045) {
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

    /* ---------- искры при клике ---------- */
    if (CALM) { sparks.length = 0; }
    for (var p = sparks.length - 1; p >= 0; p--) {
      var sk = sparks[p];
      sk.x += sk.vx; sk.y += sk.vy;
      sk.vx *= 0.97; sk.vy = sk.vy * 0.97 + 0.13;   /* лёгкая гравитация */
      sk.life -= 0.022;
      if (sk.life <= 0) { sparks.splice(p, 1); continue; }
      ctx.globalAlpha = Math.max(0, sk.life);
      ctx.fillStyle = sk.c;
      ctx.beginPath();
      ctx.arc(sk.x, sk.y, sk.r * sk.life + 0.3, 0, 6.2832);
      ctx.fill();
      /* короткий светящийся след */
      ctx.globalAlpha = Math.max(0, sk.life) * 0.5;
      ctx.fillRect(sk.x - sk.vx * 2.4, sk.y - sk.vy * 2.4 - 0.4, sk.vx * 4.8, 0.8);
    }
    ctx.globalAlpha = 1;

    /* ---------- неоновый след за курсором (v4.0, отключён в v4.6) ---------- */
    if (!CALM && trail.length > 1) {
      ctx.lineCap = 'round';
      for (var tr = 1; tr < trail.length; tr++) {
        var a = trail[tr - 1], b = trail[tr];
        var fade = tr / trail.length;
        ctx.strokeStyle = TRAIL_COLORS[tr % TRAIL_COLORS.length] + (fade * 0.5).toFixed(3) + ')';
        ctx.lineWidth = 1 + fade * 5;
        ctx.shadowColor = TRAIL_COLORS[tr % TRAIL_COLORS.length] + '0.55)';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    /* ---------- импульсные волны (v4.0) ---------- */
    if (CALM) { rings.length = 0; }
    for (var ri = rings.length - 1; ri >= 0; ri--) {
      var rg = rings[ri];
      rg.r += rg.vr;
      rg.life -= 0.022;
      if (rg.life <= 0) { rings.splice(ri, 1); continue; }
      ctx.globalAlpha = Math.max(0, rg.life) * 0.85;
      ctx.strokeStyle = rg.c;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = rg.c;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r, 0, 6.2832);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    /* ---------- полноэкранная вспышка (v4.0) ---------- */
    if (flashLife > 0) {
      flashLife -= 0.05;
      var fa = Math.max(0, flashLife) * 0.16;
      ctx.globalAlpha = fa;
      ctx.fillStyle = flashColor || '#ff4d6d';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    raf = window.requestAnimationFrame(frame);
  }

  /* вспышка искр в точке клика */
  function sparkBurst(x, y) {
    if (sparks.length > 140) return;
    var n = 10 + Math.floor(Math.random() * 7);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 1.6 + Math.random() * 4.4;
      sparks.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.4,
        r: Math.random() * 1.7 + 0.7,
        c: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
        life: 0.75 + Math.random() * 0.3
      });
    }
  }

  /* ---------- публичный API эффектов (v4.0) ---------- */
  function pulse(x, y, color) {
    if (reduce || CALM) return;
    if (rings.length > 24) return;
    rings.push({ x: x, y: y, r: 6, vr: 3.4, life: 1, c: color || '#ff4d6d' });
  }

  function flash(color) {
    if (reduce || CALM) return;
    flashColor = color || '#ff4d6d';
    flashLife = 1;
  }

  window.FX = { pulse: pulse, flash: flash, stop: stop, start: start };

  function start() {
    if (reduce) { drawStatic(); return; }
    if (!raf) raf = window.requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    /* снимаем слушатели, чтобы после перезапуска их не было дважды (v4.2) */
    try {
      window.removeEventListener('resize', resize);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('visibilitychange', onVisibility);
    } catch (e) {}
  }

  /* слушатели снимаются при остановке — для чистого перезапуска (v4.2) */
  function onPointerDown(e) {
    if (reduce || document.hidden || CALM) return;
    sparkBurst(e.clientX, e.clientY);
  }
  function onMouseMove(e) {
    mx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    my = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    if (reduce || document.hidden || CALM) return;
    /* след: пишем точку, если курсор сместился заметно */
    if (cxp < 0 || Math.abs(e.clientX - cxp) + Math.abs(e.clientY - cyp) > 3) {
      cxp = e.clientX; cyp = e.clientY;
      trail.push({ x: cxp, y: cyp });
      if (trail.length > 26) trail.shift();
    }
  }
  function onVisibility() {
    if (document.hidden) stop(); else start();
  }
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

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
