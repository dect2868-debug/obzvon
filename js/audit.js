/* ============================================================
   ОБЗВОН v8.0 :: AUDIT  (журнал действий и надзора)
   Кто (роль) что сделал и когда: входы по кодам, запуск и
   завершение обзвона, вмешательства тех. администратора,
   применение обновлений. Хранится локально, видна в админке
   и попадает в сводный отчёт.
   ============================================================ */
window.Audit = (function () {
  'use strict';

  var KEY = 'obzvon_v2_audit';
  var MAX = 200;
  var items = [];
  var loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      var raw = localStorage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : null;
      if (Array.isArray(d)) {
        items = d.filter(function (x) { return x && typeof x === 'object'; }).slice(-MAX);
      }
    } catch (e) { items = []; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX))); } catch (e) {}
  }

  /* текущая роль: роль, под которой открыт пульт (куратор/админ),
     иначе — гость (участник) */
  function currentRole() {
    try {
      if (window.OBZ && typeof OBZ.role === 'function') return OBZ.role() || 'guest';
    } catch (e) {}
    return 'guest';
  }

  function log(action, detail, role) {
    load();
    var it = {
      t: Date.now(),
      role: String(role || currentRole()),
      action: String(action || '').slice(0, 120),
      detail: String(detail === undefined || detail === null ? '' : detail).slice(0, 400)
    };
    items.push(it);
    while (items.length > MAX) items.shift();
    save();
    return it;
  }

  function list() { load(); return items.slice(); }

  function clear() { load(); items = []; save(); }

  function report() {
    load();
    return {
      app: 'obzvon-audit',
      generatedAt: new Date().toISOString(),
      count: items.length,
      items: items.slice()
    };
  }

  return { init: load, log: log, list: list, clear: clear, report: report };
})();
