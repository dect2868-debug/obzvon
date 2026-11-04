/* ============================================================
   ОБЗВОН v6.2 · HEALTH — самодиагностика и самопочинка
   Страница «Самообслуживание»: система сама проверяет свои
   подсистемы (модули, DOM, canvas, хранилище, сеть, сессия,
   график, монитор), ведёт журнал ошибок и умеет чинить то,
   что чинится без вмешательства человека.
   ============================================================ */
(function () {
  'use strict';

  var MAX_ERR = 80;
  var errors = [];
  var lastResult = null;
  var repairsDone = 0;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function nowTs() { return Date.now(); }

  /* ---------- журнал ошибок ---------- */

  function log(level, msg, detail) {
    try {
      errors.push({ t: nowTs(), level: level || 'error', msg: String(msg), detail: detail ? String(detail) : null });
      while (errors.length > MAX_ERR) errors.shift();
      renderLog();
    } catch (e) {}
  }

  function renderLog() {
    var ul = el('healthLog');
    if (!ul) return;
    if (!errors.length) {
      ul.innerHTML = '<li class="health-empty">ошибок не зафиксировано — система работает штатно</li>';
      return;
    }
    ul.innerHTML = errors.slice().reverse().map(function (e) {
      var d = new Date(e.t);
      function p(n) { return ('0' + n).slice(-2); }
      return '<li class="hl-' + esc(e.level) + '">' +
        '<time>' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '</time>' +
        '<span>' + esc(e.msg) + (e.detail ? ' <i>' + esc(e.detail) + '</i>' : '') + '</span></li>';
    }).join('');
  }

  /* ---------- отдельные проверки ---------- */

  var CHECKS = [
    {
      id: 'modules', name: 'Модули системы',
      run: function () {
        var need = ['Monitor', 'Live', 'Archive', 'FX'];
        var missing = need.filter(function (m) { return !window[m]; });
        if (missing.length) {
          return { ok: false, detail: 'не загружены: ' + missing.join(', '), fix: 'reload' };
        }
        return { ok: true, detail: 'на месте: ' + need.join(', ') };
      }
    },
    {
      id: 'dom', name: 'Структура страницы',
      run: function () {
        var need = ['playfield', 'chTask', 'metrics', 'concValue', 'cheatValue',
                    'sideNav', 'signalList', 'liveChart', 'updBanner'];
        var missing = need.filter(function (id) { return !document.getElementById(id); });
        if (missing.length) {
          return { ok: false, detail: 'нет блоков: ' + missing.join(', '), fix: 'reload' };
        }
        var views = document.querySelectorAll('.view').length;
        var links = document.querySelectorAll('.side-nav .nav-link').length;
        if (!views || views !== links) {
          return { ok: false, detail: 'страниц ' + views + ', пунктов меню ' + links, fix: 'reload' };
        }
        return { ok: true, detail: views + ' страниц, все блоки на месте' };
      }
    },
    {
      id: 'canvas', name: 'График (canvas)',
      run: function () {
        var cv = el('liveChart');
        if (!cv) return { ok: false, detail: 'нет элемента графика', fix: 'live' };
        var ctx = null;
        try { ctx = cv.getContext('2d'); } catch (e) {}
        if (!ctx) return { ok: false, detail: 'контекст 2D недоступен', fix: 'live' };
        if (!cv.width || !cv.height) {
          return { ok: false, detail: 'график не инициализирован', fix: 'live' };
        }
        return {
          ok: true,
          detail: cv.width + '×' + cv.height + ' px' + (cv.clientWidth ? '' : ' · панель свёрнута')
        };
      }
    },
    {
      id: 'storage', name: 'Хранилище браузера',
      run: function () {
        try {
          var k = '__obz_health';
          localStorage.setItem(k, '1');
          var v = localStorage.getItem(k);
          localStorage.removeItem(k);
          if (v !== '1') return { ok: false, detail: 'данные не читаются', fix: 'memory' };
          var n = localStorage.length;
          var bytes = 0;
          for (var i = 0; i < n; i++) {
            var key = localStorage.key(i);
            bytes += (key ? key.length : 0) + (localStorage.getItem(key) || '').length;
          }
          return { ok: true, detail: 'записей: ' + n + ' · объём: ' + Math.round(bytes / 1024) + ' КБ' };
        } catch (e) {
          return { ok: false, detail: 'localStorage недоступен: ' + (e && e.message), fix: 'memory' };
        }
      }
    },
    {
      id: 'memory', name: 'Память страницы',
      run: function () {
        var pm = window.performance && window.performance.memory;
        if (!pm) return { ok: true, detail: 'браузер не отдаёт JS-heap — это нормально' };
        return {
          ok: true,
          detail: 'heap: ' + (pm.usedJSHeapSize / 1048576).toFixed(1) + ' МБ из ' +
                  (pm.jsHeapSizeLimit / 1048576).toFixed(0) + ' МБ'
        };
      }
    },
    {
      id: 'session', name: 'Состояние сессии',
      run: function () {
        var obz = window.OBZ;
        if (!obz || !obz.state) return { ok: false, detail: 'нет состояния приложения', fix: 'reload' };
        var st = obz.state();
        var dom = document.getElementById('gate');
        var inDom = dom && !dom.hidden;
        if (st.state === 'running' && inDom) {
          return { ok: false, detail: 'интерфейс не соответствует состоянию сессии', fix: 'ui' };
        }
        return { ok: true, detail: 'состояние: ' + st.state + ' · нарушений: ' + st.violations };
      }
    },
    {
      id: 'monitor', name: 'Монитор нарушений',
      run: function () {
        if (!window.Monitor) return { ok: false, detail: 'монитор не загружен', fix: 'reload' };
        var last = Monitor.lastTickAt ? Monitor.lastTickAt() : 0;
        if (!last) return { ok: false, detail: 'монитор ни разу не сработал', fix: 'monitor' };
        var age = Date.now() - last;
        if (age > 6000) return { ok: false, detail: 'монитор молчит ' + Math.round(age / 1000) + ' с', fix: 'monitor' };
        return { ok: true, detail: 'последний отклик ' + Math.round(age / 1000) + ' с назад' };
      }
    },
    {
      id: 'live', name: 'Живая динамика',
      run: function () {
        if (!window.Live) return { ok: false, detail: 'модуль графика не загружен', fix: 'reload' };
        var st = Live.stats();
        if (Live.running() && st.n === 0) {
          return { ok: false, detail: 'график запущен, но замеров нет', fix: 'live' };
        }
        return { ok: true, detail: 'замеров: ' + st.n + ' · средняя ' + st.avg + '%' };
      }
    },
    {
      id: 'integrity', name: 'Целостность кода',
      run: function () {
        if (!window.OBZ || !OBZ.integrity) return { ok: true, detail: 'проверка недоступна' };
        var problem = OBZ.integrity();
        if (problem) return { ok: false, detail: problem, fix: 'reload' };
        return { ok: true, detail: 'структура страницы не изменялась' };
      }
    }
  ];

  /* ---------- полная проверка ---------- */

  function check() {
    var out = [];
    var ok = 0;
    CHECKS.forEach(function (c) {
      var r;
      try { r = c.run(); } catch (e) { r = { ok: false, detail: 'ошибка проверки: ' + (e && e.message), fix: 'reload' }; }
      out.push({ id: c.id, name: c.name, ok: !!r.ok, detail: r.detail || '', fix: r.fix || '' });
      if (r.ok) ok++;
    });
    var res = {
      at: nowTs(),
      ok: ok,
      total: out.length,
      score: Math.round((ok / out.length) * 100),
      checks: out
    };
    lastResult = res;
    renderChecks(res);
    return res;
  }

  /* ---------- починка ---------- */

  function repair() {
    var actions = [];
    var failed = [];
    var res = check();

    res.checks.forEach(function (c) {
      if (c.ok) return;
      var act = null;
      try {
        switch (c.fix) {
          case 'live':
            if (window.Live && Live.repair && Live.repair()) act = 'график пересоздан';
            break;
          case 'monitor':
            if (window.Monitor && Monitor.restart && Monitor.restart()) act = 'монитор перезапущен';
            break;
          case 'ui':
            if (window.OBZ && OBZ.selfRepair) act = OBZ.selfRepair('ui') || 'интерфейс синхронизирован';
            break;
          case 'memory':
            if (window.OBZ && OBZ.selfRepair) act = OBZ.selfRepair('memory') || 'переключено на память без localStorage';
            break;
          case 'reload':
            act = 'требуется перезагрузка страницы';
            break;
          default:
            act = null;
        }
      } catch (e) {
        act = 'ошибка починки: ' + (e && e.message);
      }
      if (act) { actions.push(c.name + ' — ' + act); log('warn', 'Починка: ' + c.name + ' — ' + act); }
      else failed.push(c.name + ' — ' + c.detail);
    });

    repairsDone++;
    var out = check();
    renderRepairs(actions, failed);
    return { actions: actions, failed: failed, result: out };
  }

  /* ---------- отрисовка страницы ---------- */

  function renderChecks(res) {
    var grid = el('healthGrid');
    if (!grid) return;
    grid.innerHTML = res.checks.map(function (c) {
      return '<div class="hcard ' + (c.ok ? 'ok' : 'bad') + '">' +
        '<span class="hcard-icon">' + (c.ok ? '✓' : '!') + '</span>' +
        '<div class="hcard-body"><b>' + esc(c.name) + '</b>' +
        '<span>' + esc(c.detail) + '</span></div></div>';
    }).join('');
    var score = el('healthScore');
    if (score) {
      score.textContent = res.score + '% · ' + res.ok + ' из ' + res.total + ' проверок пройдено';
      score.className = 'panel-hint ' + (res.score === 100 ? 'good' : (res.score >= 60 ? 'warn' : 'bad'));
    }
  }

  function renderRepairs(actions, failed) {
    var box = el('healthRepair');
    if (!box) return;
    if (!actions.length && !failed.length) {
      box.innerHTML = '<div class="health-ok">Всё исправно — починка не потребовалась</div>';
      return;
    }
    var html = '';
    if (actions.length) {
      html += '<div class="health-fixed"><b>Исправлено:</b><ul>' +
        actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>';
    }
    if (failed.length) {
      html += '<div class="health-failed"><b>Требует внимания:</b><ul>' +
        failed.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>';
    }
    box.innerHTML = html;
  }

  /* ---------- отчёт ---------- */

  function report() {
    var res = check();
    var out = {
      app: 'obzvon-health',
      v: (window.OBZ && OBZ.v) || null,
      generatedAt: new Date().toISOString(),
      score: res.score,
      checks: res.checks,
      errors: errors.slice(),
      repairs: repairsDone,
      state: (window.OBZ && OBZ.state) ? OBZ.state() : null,
      live: (window.Live && Live.stats) ? Live.stats() : null,
      history: (window.Archive && Archive.list) ? Archive.list().length : null,
      userAgent: navigator.userAgent,
      screen: (window.screen ? screen.width + '×' + screen.height : null),
      memory: (window.performance && window.performance.memory) ? {
        usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(2),
        limitMB: +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0)
      } : null
    };
    return out;
  }

  function downloadReport() {
    var data = report();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'obzvon-health-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
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

  function bind() {
    var btnCheck = el('btnHealthCheck');
    if (btnCheck) on(btnCheck, 'click', function () {
      var res = check();
      log('info', 'Ручная проверка: ' + res.score + '% — ' + res.ok + ' из ' + res.total);
    });
    var btnRepair = el('btnHealthRepair');
    if (btnRepair) on(btnRepair, 'click', function () {
      var r = repair();
      log(r.failed.length ? 'warn' : 'info',
        r.failed.length
          ? ('Починка выполнена частично: ' + r.actions.length + ' исправлено, ' + r.failed.length + ' не удалось')
          : ('Починка выполнена: исправлено ' + r.actions.length + ' подсистем'));
    });
    var btnReport = el('btnHealthReport');
    if (btnReport) on(btnReport, 'click', downloadReport);
    var btnRestart = el('btnHealthRestart');
    if (btnRestart) on(btnRestart, 'click', function () {
      log('info', 'Запрошен перезапуск системы');
      if (window.OBZ && OBZ.restart) OBZ.restart();
    });
    var btnClear = el('btnHealthClear');
    if (btnClear) on(btnClear, 'click', function () {
      errors = [];
      renderLog();
      log('info', 'Журнал ошибок очищен');
    });
    renderLog();
  }

  var autoTimer = null;

  function init() {
    bind();
    check();
    /* автопроверка каждые 30 с — страница сама следит за собой */
    autoTimer = setInterval(function () {
      var res = check();
      if (res.score < 100) {
        var broken = res.checks.filter(function (c) { return !c.ok; });
        log('warn', 'Автопроверка: ' + broken.length + ' подсистем требуют внимания');
        /* мягкая починка того, что чинится само */
        broken.forEach(function (c) {
          if (c.fix === 'live' && window.Live) { try { Live.repair(); } catch (e) {} }
          else if (c.fix === 'monitor' && window.Monitor) { try { Monitor.restart(); } catch (e2) {} }
        });
      }
    }, 30000);
  }

  function stop() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    for (var i = 0; i < LISTENERS.length; i++) {
      try { LISTENERS[i][0].removeEventListener(LISTENERS[i][1], LISTENERS[i][2]); } catch (e) {}
    }
    LISTENERS = [];
    return true;
  }

  window.Health = {
    init: init, check: check, repair: repair, log: log, report: report, stop: stop,
    errors: function () { return errors.slice(); },
    last: function () { return lastResult; },
    downloadReport: downloadReport
  };

  /* глобальный сбор ошибок — в журнал самопочинки */
  window.addEventListener('error', function (e) {
    log('error', e.message || 'неизвестная ошибка скрипта', e.filename ? (e.filename + ':' + e.lineno) : null);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    log('error', 'Необработанный отказ: ' + (r && r.message ? r.message : String(r)));
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
