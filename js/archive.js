/* ============================================================
   ОБЗВОН v4.8 · ARCHIVE — история обзвонов и сравнение
   Каждый завершённый обзвон сохраняется локально: вердикт,
   концентрация, читомеряк, реакция, число испытаний.
   Есть разбор по сессиям, сравнение с предыдущей и экспорт CSV.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'obzvon_v2_history';
  var MAX = 100;

  var items = [];
  var sortState = { key: 'startedAt', dir: -1 };
  var selectedId = null;

  function el(id) { return document.getElementById(id); }

  /* ---------- хранение ---------- */

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : [];
      items = Array.isArray(d) ? d.filter(function (r) { return r && typeof r === 'object'; }) : [];
    } catch (e) { items = []; }
    return items;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX))); } catch (e) {}
  }

  function verdictClass(v) {
    return v === 'ЗАЧЁТ' ? 'v-ok' : (v === 'СОМНИТЕЛЬНО' ? 'v-mid' : 'v-bad');
  }

  /* ---------- публичное API ---------- */

  function add(rec) {
    if (!rec) return null;
    var row = {
      id: rec.id || ('S' + Date.now().toString(36).toUpperCase()),
      startedAt: rec.startedAt || Date.now(),
      endedAt: rec.endedAt || Date.now(),
      duration: rec.duration || 0,
      conc: Math.round(rec.conc || 0),
      cheat: Math.round(rec.cheat || 0),
      focus: Math.round(rec.focus || 0),
      reaction: (rec.reaction === null || rec.reaction === undefined) ? null : rec.reaction,
      verdict: rec.verdict || '—',
      challenges: rec.challenges || 0,
      ok: rec.ok || 0,
      viol: rec.viol || 0,
      chips: rec.chips || [],
      device: rec.device || ''
    };
    items.unshift(row);
    if (items.length > MAX) items.length = MAX;
    save();
    render();
    return row;
  }

  function list() { return items.slice(); }

  function clear() {
    items = [];
    selectedId = null;
    save();
    render();
  }

  function remove(id) {
    items = items.filter(function (r) { return r.id !== id; });
    if (selectedId === id) selectedId = null;
    save();
    render();
  }

  /* ---------- сортировка ---------- */

  var COLS = [
    { key: 'n',           label: '№',        numeric: true },
    { key: 'startedAt',   label: 'ДАТА',     numeric: true },
    { key: 'duration',    label: 'ДЛИТ.',    numeric: true },
    { key: 'conc',        label: 'КОНЦ.',    numeric: true },
    { key: 'cheat',       label: 'ЧИТОМ.',   numeric: true },
    { key: 'focus',       label: 'ФОКУС',    numeric: true },
    { key: 'reaction',    label: 'РЕАКЦИЯ',  numeric: true },
    { key: 'challenges',  label: 'ИСПЫТ.',   numeric: true },
    { key: 'viol',        label: 'НАРУШ.',   numeric: true },
    { key: 'verdict',     label: 'ВЕРДИКТ',  numeric: false }
  ];

  function sorted() {
    var k = sortState.key, dir = sortState.dir;
    var col = COLS.filter(function (c) { return c.key === k; })[0];
    var rows = items.slice();
    rows.forEach(function (r, i) { r._i = i; });
    rows.sort(function (a, b) {
      var va, vb;
      if (k === 'n') { va = a._i; vb = b._i; }
      else if (k === 'verdict') { va = a.verdict; vb = b.verdict; return dir * String(va).localeCompare(String(vb), 'ru'); }
      else { va = a[k]; vb = b[k]; }
      if (va === null || va === undefined) va = -1;
      if (vb === null || vb === undefined) vb = -1;
      return dir * (va - vb);
    });
    return rows;
  }

  function fmtDur(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return m > 0 ? m + ' мин ' + (s % 60) + ' с' : s + ' с';
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    function p(n) { return ('0' + n).slice(-2); }
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- отрисовка ---------- */

  function renderCards() {
    var box = el('archCards');
    if (!box) return;
    if (!items.length) {
      box.innerHTML = '<div class="arch-empty">обзвонов ещё не было — история появится после первого завершённого обзвона</div>';
      return;
    }
    var concs = items.map(function (r) { return r.conc; });
    var avg = Math.round(concs.reduce(function (a, b) { return a + b; }, 0) / concs.length);
    var best = Math.max.apply(null, concs);
    var worst = Math.min.apply(null, concs);
    var react = items.filter(function (r) { return r.reaction !== null; });
    var avgR = react.length
      ? Math.round(react.reduce(function (a, r) { return a + r.reaction; }, 0) / react.length) : null;
    var okS = items.filter(function (r) { return r.verdict === 'ЗАЧЁТ'; }).length;
    var cards = [
      ['ОБЗВОНОВ', items.length + ''],
      ['СРЕДНЯЯ КОНЦ.', avg + '%'],
      ['ЛУЧШИЙ', best + '%'],
      ['ХУДШИЙ', worst + '%'],
      ['ЗАЧЁТОВ', okS + ' / ' + items.length],
      ['СР. РЕАКЦИЯ', avgR === null ? '—' : avgR + ' мс']
    ];
    box.innerHTML = cards.map(function (c) {
      return '<div class="arch-card"><span>' + c[0] + '</span><b>' + c[1] + '</b></div>';
    }).join('');
  }

  /* плавный рост столбцов (v4.8): короткая ease-out анимация, без прыжков */
  var chartProgress = 1;
  function animateChart() {
    var t0 = Date.now();
    function step() {
      var e = Math.min(1, (Date.now() - t0) / 420);
      chartProgress = 1 - Math.pow(1 - e, 3);
      renderChart();
      if (e < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  function renderChart() {
    var cv = el('archChart');
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(240, cv.clientWidth || 640);
    var h = 120;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!items.length) return;
    var rows = items.slice(0, 30).reverse();   /* от старых к новым */
    var padL = 30, padR = 8, padT = 10, padB = 16;
    var gw = Math.max(10, w - padL - padR);
    var gh = Math.max(10, h - padT - padB);
    var avg = Math.round(rows.reduce(function (a, r) { return a + r.conc; }, 0) / rows.length);

    [0, 50, 100].forEach(function (v) {
      var y = padT + gh - (v / 100) * gh;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke();
      ctx.fillStyle = 'rgba(125,140,163,.75)';
      ctx.font = '9px Consolas,monospace';
      ctx.textAlign = 'right';
      ctx.fillText(v + '', padL - 5, y);
    });

    /* средняя */
    var yAvg = padT + gh - (avg / 100) * gh;
    ctx.strokeStyle = 'rgba(52,231,255,.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(padL, yAvg); ctx.lineTo(padL + gw, yAvg); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(52,231,255,.8)';
    ctx.textAlign = 'left';
    ctx.fillText('ср. ' + avg + '%', padL + 3, yAvg - 5);

    var step = (gw - 6) / Math.max(1, rows.length);
    var bw = Math.max(3, Math.min(28, step - 6));
    rows.forEach(function (r, i) {
      var x = padL + 3 + i * step + (step - bw) / 2;
      var bh = (r.conc / 100) * gh * chartProgress;
      var col = r.verdict === 'ЗАЧЁТ' ? '#5bff9d' : (r.verdict === 'СОМНИТЕЛЬНО' ? '#ffb84d' : '#ff4d6d');
      var g = ctx.createLinearGradient(0, padT + gh - bh, 0, padT + gh);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(255,255,255,.06)');
      ctx.fillStyle = g;
      ctx.globalAlpha = .85;
      ctx.fillRect(x, padT + gh - bh, bw, bh);
      ctx.globalAlpha = 1;
      /* читомеряк — тонкая полоска снизу */
      if (r.cheat > 0) {
        var ch = (r.cheat / 100) * gh * chartProgress;
        ctx.fillStyle = 'rgba(255,77,109,.55)';
        ctx.fillRect(x, padT + gh - ch, bw, Math.min(2.5, ch));
      }
    });
  }

  function renderTable() {
    var t = el('archTable');
    if (!t) return;
    var cnt = el('archCount');
    if (cnt) cnt.textContent = items.length ? items.length + ' обзвон(ов)' : '0';

    if (!items.length) {
      t.innerHTML = '<tbody><tr><td class="arch-empty">истории пока нет</td></tr></tbody>';
      renderCompare();
      return;
    }
    var rows = sorted();
    var head = '<thead><tr>' + COLS.map(function (c) {
      var cls = sortState.key === c.key ? ' class="sorted ' + (sortState.dir > 0 ? 'asc' : 'desc') + '"' : '';
      return '<th data-sort="' + c.key + '"' + cls + '>' + c.label + '</th>';
    }).join('') + '<th></th></tr></thead>';

    var body = '<tbody>' + rows.map(function (r) {
      var sel = (r.id === selectedId) ? ' class="sel"' : '';
      return '<tr' + sel + ' data-id="' + r.id + '">' +
        '<td class="num">' + (items.indexOf(r) + 1) + '</td>' +
        '<td>' + fmtDate(r.startedAt) + '</td>' +
        '<td class="num">' + fmtDur(r.duration) + '</td>' +
        '<td class="num ' + verdictClass(r.verdict) + '">' + r.conc + '%</td>' +
        '<td class="num">' + r.cheat + '%</td>' +
        '<td class="num">' + r.focus + '%</td>' +
        '<td class="num">' + (r.reaction === null ? '—' : r.reaction + ' мс') + '</td>' +
        '<td class="num">' + r.challenges + '</td>' +
        '<td class="num">' + r.viol + '</td>' +
        '<td class="' + verdictClass(r.verdict) + '">' + r.verdict + '</td>' +
        '<td><button type="button" class="arch-del" data-del="' + r.id + '" title="Удалить запись">✕</button></td>' +
        '</tr>';
    }).join('') + '</tbody>';
    t.innerHTML = head + body;
  }

  function renderCompare() {
    var box = el('archCompare');
    if (!box) return;
    if (!items.length) { box.innerHTML = ''; return; }
    var cur = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === selectedId) cur = items[i];
    if (!cur) cur = items[0];
    /* предыдущий = самый поздний обзвон, который начался раньше выбранного */
    var prev = null;
    for (var j = 0; j < items.length; j++) {
      var o = items[j];
      if (o.id === cur.id) continue;
      if (o.startedAt >= cur.startedAt) continue;
      if (!prev || o.startedAt > prev.startedAt) prev = o;
    }

    var rows = [
      ['Концентрация', cur.conc + '%', prev ? prev.conc + '%' : '—'],
      ['Читомеряк', cur.cheat + '%', prev ? prev.cheat + '%' : '—'],
      ['В фокусе', cur.focus + '%', prev ? prev.focus + '%' : '—'],
      ['Реакция', cur.reaction === null ? '—' : cur.reaction + ' мс', prev ? (prev.reaction === null ? '—' : prev.reaction + ' мс') : '—'],
      ['Испытаний', cur.challenges + ' (верно ' + cur.ok + ')', prev ? prev.challenges + ' (верно ' + prev.ok + ')' : '—'],
      ['Нарушений', cur.viol + '', prev ? prev.viol + '' : '—'],
      ['Длительность', fmtDur(cur.duration), prev ? fmtDur(prev.duration) : '—']
    ];

    var out = '<div class="arch-cmp-head">' +
      '<span class="arch-cmp-title">СРАВНЕНИЕ</span>' +
      '<span class="arch-cmp-cur">' + fmtDate(cur.startedAt) + ' · ' + cur.verdict + '</span>' +
      (prev ? '<span class="arch-cmp-prev">с предыдущим: ' + fmtDate(prev.startedAt) + '</span>'
            : '<span class="arch-cmp-prev">предыдущих обзвонов не было</span>') +
      '</div><table class="stat-table"><thead><tr><th>ПОКАЗАТЕЛЬ</th><th>ВЫБРАННЫЙ</th><th>ПРЕДЫДУЩИЙ</th><th>Δ</th></tr></thead><tbody>';

    rows.forEach(function (r) {
      var delta = '';
      var curN = numOf(cur, r[0]);
      var prevN = prev ? numOf(prev, r[0]) : null;
      if (prevN !== null && curN !== null) {
        var d = curN - prevN;
        var good = (r[0] === 'Читомеряк' || r[0] === 'Нарушений') ? (d < 0) : (d > 0);
        var sign = d > 0 ? '+' : (d < 0 ? '−' : '');
        delta = '<span class="delta ' + (d === 0 ? 'flat' : (good ? 'up' : 'down')) + '">' +
          sign + Math.abs(d) + '</span>';
      } else {
        delta = '<span class="delta flat">—</span>';
      }
      out += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + delta + '</td></tr>';
    });
    out += '</tbody></table>';
    box.innerHTML = out;
  }

  function numOf(r, label) {
    switch (label) {
      case 'Концентрация': return r.conc;
      case 'Читомеряк': return r.cheat;
      case 'В фокусе': return r.focus;
      case 'Реакция': return r.reaction;
      case 'Испытаний': return r.challenges;
      case 'Нарушений': return r.viol;
      case 'Длительность': return Math.round(r.duration / 1000);
      default: return null;
    }
  }

  function render() {
    renderCards();
    renderChart();
    renderTable();
    renderCompare();
    animateChart();
  }

  /* ---------- экспорт CSV ---------- */

  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (/[",;\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCSV() {
    var head = ['№', 'Дата', 'Длительность, с', 'Концентрация, %', 'Читомеряк, %', 'Фокус, %',
                'Реакция, мс', 'Испытаний', 'Верно', 'Нарушений', 'Вердикт', 'ID', 'Фишки'];
    var lines = [head.map(csvCell).join(';')];
    items.slice().reverse().forEach(function (r, i) {
      lines.push([
        i + 1,
        fmtDate(r.startedAt),
        Math.round(r.duration / 1000),
        r.conc, r.cheat, r.focus,
        r.reaction === null ? '' : r.reaction,
        r.challenges, r.ok, r.viol,
        r.verdict,
        r.id,
        (r.chips || []).join(' / ')
      ].map(csvCell).join(';'));
    });
    return '﻿' + lines.join('\r\n');
  }

  function exportCSV() {
    var blob = new Blob([buildCSV()], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'obzvon-history-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- события страницы ---------- */

  /* реестр слушателей: нужен для чистого перезапуска системы (v4.2) */
  var LISTENERS = [];
  function on(target, type, fn) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn);
    LISTENERS.push([target, type, fn]);
  }
  function stop() {
    for (var i = 0; i < LISTENERS.length; i++) {
      try { LISTENERS[i][0].removeEventListener(LISTENERS[i][1], LISTENERS[i][2]); } catch (e) {}
    }
    LISTENERS = [];
    return true;
  }

  function bind() {
    var t = el('archTable');
    if (t) {
      on(t, 'click', function (e) {
        var del = e.target.closest ? e.target.closest('[data-del]') : null;
        if (del) {
          e.stopPropagation();
          remove(del.getAttribute('data-del'));
          return;
        }
        var th = e.target.closest ? e.target.closest('th[data-sort]') : null;
        if (th) {
          var key = th.getAttribute('data-sort');
          if (sortState.key === key) sortState.dir = -sortState.dir;
          else { sortState.key = key; sortState.dir = 1; }
          renderTable();
          return;
        }
        var tr = e.target.closest ? e.target.closest('tr[data-id]') : null;
        if (tr) {
          selectedId = tr.getAttribute('data-id');
          renderTable();
          renderCompare();
        }
      });
    }
    var btnCsv = el('btnArchCsv');
    if (btnCsv) on(btnCsv, 'click', exportCSV);
    var btnClear = el('btnArchClear');
    if (btnClear) on(btnClear, 'click', function () {
      if (!items.length) return;
      if (typeof window.confirm === 'function' && !/jsdom/i.test(navigator.userAgent || '')) {
        try { if (window.confirm('Удалить всю историю обзвонов? Действие необратимо.') === false) return; } catch (e) {}
      }
      clear();
    });
    window.addEventListener('resize', renderChart, { passive: true });
  }

  function init() {
    load();
    bind();
    render();
  }

  window.Archive = {
    init: init, add: add, list: list, clear: clear, remove: remove, stop: stop,
    render: render, exportCSV: exportCSV, csv: buildCSV, select: function (id) {
      selectedId = id; renderTable(); renderCompare();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
