/* ============================================================
   ОБЗВОН v6.1 :: STATS — счётчики посещений и обзвонов

   Считает в цифрах:
     • сколько раз сайт открыли;
     • сколько калибровок начали и прошли;
     • сколько обзвонов начали и закончили;
     • сколько разных участников было (по анонимному id устройства).

   Локальные счётчики живут в браузере. Чтобы узнать, сколько людей
   заходило на сайт ВООБЩЕ (с разных устройств), нужен сборщик:
   tools/collect.php (или tools/collector.js) — кладётся рядом с сайтом,
   а в config.json пишется его адрес. Никаких личных данных не передаётся:
   только случайный id, тип события и время.
   ============================================================ */
window.Stats = (function () {
  'use strict';

  var KEY = 'obzvon_v2_stats';
  var PID_KEY = 'obzvon_v2_pid';
  var MAX_PEOPLE = 500;

  var counters = {
    visits: 0,          /* открытий страницы */
    calibrations: 0,    /* начатых калибровок */
    calibPassed: 0,     /* пройденных калибровок */
    sessions: 0,        /* начатых обзвонов */
    finished: 0,        /* завершённых обзвонов */
    firstVisit: 0,      /* когда зашли впервые (в этом браузере) */
    lastVisit: 0        /* когда зашли в последний раз */
  };
  var people = {};      /* id участника → число его посещений */
  var pid = '';         /* анонимный id устройства */
  var collector = '';   /* адрес сборщика (из config.json) */
  var loaded = false;

  function randId() {
    var s = '';
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var buf = new Uint8Array(16);
        window.crypto.getRandomValues(buf);
        for (var i = 0; i < buf.length; i++) s += ('0' + buf[i].toString(16)).slice(-2);
      } else {
        for (var j = 0; j < 16; j++) s += Math.floor(Math.random() * 256).toString(16);
      }
    } catch (e) { s = String(Date.now()) + Math.random().toString(16).slice(2); }
    return s;
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (d && typeof d === 'object') {
        Object.keys(counters).forEach(function (k) {
          if (typeof d[k] === 'number') counters[k] = d[k];
        });
        if (d.people && typeof d.people === 'object') people = d.people;
      }
    } catch (e) { /* повреждённое хранилище — начинаем с нуля */ }
    pid = '';
    try { pid = localStorage.getItem(PID_KEY) || ''; } catch (e) {}
    if (!pid) {
      pid = randId();
      try { localStorage.setItem(PID_KEY, pid); } catch (e) {}
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        visits: counters.visits, calibrations: counters.calibrations,
        calibPassed: counters.calibPassed, sessions: counters.sessions,
        finished: counters.finished, firstVisit: counters.firstVisit,
        lastVisit: counters.lastVisit, people: people
      }));
    } catch (e) {}
  }

  /* отправка события сборщику (если он настроен) */
  function send(ev, detail) {
    if (!collector) return;
    try {
      var body = { id: pid, ev: ev, ts: Date.now() };
      if (detail) body.d = String(detail).slice(0, 300);
      fetch(collector, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(function () {});
    } catch (e) {}
  }

  function count(ev, detail) {
    load();
    var now = Date.now();
    switch (ev) {
      case 'visit':
        counters.visits++;
        counters.lastVisit = now;
        if (!counters.firstVisit) counters.firstVisit = now;
        people[pid] = (people[pid] || 0) + 1;
        break;
      case 'calib.start': counters.calibrations++; break;
      case 'calib.pass': counters.calibPassed++; break;
      case 'session.start': counters.sessions++; break;
      case 'session.end': counters.finished++; break;
      default: break;
    }
    /* список участников не должен расти бесконечно */
    var keys = Object.keys(people);
    if (keys.length > MAX_PEOPLE) {
      keys.sort(function (a, b) { return (people[a] || 0) - (people[b] || 0); });
      for (var i = 0; i < keys.length - MAX_PEOPLE; i++) delete people[keys[i]];
    }
    save();
    send(ev, detail);
    return counters;
  }

  /* локальные числа (этот браузер) */
  function snapshot() {
    load();
    return {
      pid: pid,
      counters: {
        visits: counters.visits,
        calibrations: counters.calibrations,
        calibPassed: counters.calibPassed,
        sessions: counters.sessions,
        finished: counters.finished,
        firstVisit: counters.firstVisit,
        lastVisit: counters.lastVisit
      },
      people: Object.keys(people).length,
      collector: collector
    };
  }

  /* общие числа с сервера-сборщика (если он настроен и доступен) */
  function globalStats() {
    if (!collector) return Promise.resolve(null);
    try {
      return fetch(collector + '?stats=1&ts=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function setCollector(url) {
    collector = url || '';
    if (collector && collector.charAt(0) === '/') collector = collector; /* относительный — ок */
  }

  function init() {
    load();
    count('visit');
  }

  return {
    init: init, count: count, snapshot: snapshot,
    globalStats: globalStats, setCollector: setCollector,
    id: function () { load(); return pid; }
  };
})();
