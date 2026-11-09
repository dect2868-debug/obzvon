/* ============================================================
   ОБЗВОН v8.0 · MODER — модерация обзвонов

   Что делает:
     • смотрит на результаты испытаний и ищет «слишком ровное»
       поведение — типичные признаки автоматической игры;
     • считает риск сессии (0–100 %) и уровень подозрительности;
     • кладёт подозрительные сессии в очередь на модерацию;
     • модератор принимает решение: зачёт / повтор / запрет —
       решение попадает в журнал действий и в выгрузку Excel.

   Модуль ничего не решает сам: финальное слово за модератором.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'obzvon_v8_moder';
  var MAX_QUEUE = 60;

  /* правила модерации: вес — вклад в общий риск */
  var RULES = [
    { id: 'superfast', name: 'Сверхскорость', weight: 35,
      note: 'средняя реакция быстрее 220 мс — похоже на автоматическую игру' },
    { id: 'perfect', name: 'Идеальная серия', weight: 30,
      note: '6+ верных испытаний подряд с почти одинаковой реакцией' },
    { id: 'fastfail', name: 'Мгновенные провалы', weight: 25,
      note: 'провалы быстрее 300 мс после показа — отвечает не глядя' },
    { id: 'tooclean', name: 'Слишком ровно', weight: 20,
      note: 'концентрация 100% и ни одного нарушения на длинной сессии' },
    { id: 'failstorm', name: 'Шквал провалов', weight: 10,
      note: '5+ провалов подряд подряд — сдался или не участвует' }
  ];

  var session = { results: [], viol: 0, conc: 100 };
  var queue = [];

  /* ---------- хранилище ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(queue.slice(0, MAX_QUEUE))); } catch (e) {}
  }
  function now() { return Date.now(); }

  /* ---------- текущая сессия ---------- */
  function reset() {
    session = { results: [], viol: 0, conc: 100 };
  }

  /* результат одного испытания: верно/неверно и время реакции (мс) */
  function push(ok, ms, kind) {
    session.results.push({
      ok: !!ok,
      ms: (typeof ms === 'number' && isFinite(ms) && ms > 0) ? Math.round(ms) : null,
      kind: kind || '',
      at: now()
    });
    if (session.results.length > 500) session.results.shift();
  }

  function noteViolation() { session.viol++; }
  function setConc(c) { session.conc = (typeof c === 'number' && isFinite(c)) ? c : session.conc; }

  /* ---------- правила ---------- */
  function flag(id, note) {
    var r = RULES.filter(function (x) { return x.id === id; })[0];
    if (!r) return null;
    return { id: r.id, name: r.name, note: note || r.note, weight: r.weight };
  }

  function avg(a) {
    if (!a.length) return null;
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  function spread(a) {
    if (a.length < 2) return 0;
    var m = avg(a);
    var s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / a.length);
  }

  /* самая длинная серия верных ответов подряд */
  function bestStreak(results) {
    var best = 0, cur = 0, bestMs = [], curMs = [];
    for (var i = 0; i < results.length; i++) {
      if (results[i].ok) {
        cur++;
        if (results[i].ms) curMs.push(results[i].ms);
      } else {
        if (cur > best) { best = cur; bestMs = curMs.slice(); }
        cur = 0; curMs = [];
      }
    }
    if (cur > best) { best = cur; bestMs = curMs.slice(); }
    return { len: best, ms: bestMs };
  }

  /* самая длинная серия провалов подряд */
  function worstFailStreak(results) {
    var best = 0, cur = 0;
    for (var i = 0; i < results.length; i++) {
      if (!results[i].ok) { cur++; if (cur > best) best = cur; }
      else cur = 0;
    }
    return best;
  }

  /* проверка сессии: возвращает {risk, level, flags, total, ok} */
  function check(data) {
    var d = data || session;
    var results = d.results || [];
    var flags = [];

    var oks = [], fails = [], fastFails = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].ok) { if (results[i].ms) oks.push(results[i].ms); }
      else {
        if (results[i].ms && results[i].ms < 300) fastFails++;
        if (results[i].ms) fails.push(results[i].ms);
      }
    }

    /* 1) сверхскорость */
    if (oks.length >= 3) {
      var a = avg(oks);
      if (a !== null && a < 220) {
        flags.push(flag('superfast', 'средняя реакция ' + Math.round(a) + ' мс при ' + oks.length + ' верных ответах'));
      }
    }

    /* 2) идеальная серия: 6+ верных подряд и разброс меньше 60 мс */
    var st = bestStreak(results);
    if (st.len >= 6 && st.ms.length >= 4) {
      var sp = spread(st.ms);
      if (sp < 60) {
        flags.push(flag('perfect', st.len + ' верных подряд, разброс реакции ' + Math.round(sp) + ' мс'));
      }
    }

    /* 3) мгновенные провалы */
    if (fastFails >= 3) {
      flags.push(flag('fastfail', fastFails + ' провалов быстрее 300 мс после показа'));
    }

    /* 4) слишком ровно: идеальная концентрация без единого нарушения */
    if (results.length >= 10 && !d.viol && (d.conc === undefined || d.conc >= 99)) {
      flags.push(flag('tooclean', 'концентрация ' + (d.conc === undefined ? 100 : d.conc) +
        '% при ' + results.length + ' испытаниях и ни одного нарушения'));
    }

    /* 5) шквал провалов */
    var fs = worstFailStreak(results);
    if (fs >= 5) flags.push(flag('failstorm', fs + ' провалов подряд'));

    var risk = 0;
    for (var f = 0; f < flags.length; f++) risk += flags[f].weight;
    risk = Math.max(0, Math.min(100, risk));

    return {
      risk: risk,
      level: risk >= 60 ? 'высокий' : (risk >= 25 ? 'средний' : 'низкий'),
      flags: flags,
      total: results.length,
      ok: oks.length
    };
  }

  /* ---------- очередь модерации ---------- */
  function submit(info) {
    var chk = check((info && info.results) ? info : null);
    var item = {
      id: 'M' + now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100),
      at: now(),
      sessionId: (info && info.sessionId) || '',
      risk: chk.risk,
      level: chk.level,
      flags: chk.flags.map(function (f) { return f.name + ' — ' + f.note; }),
      total: chk.total,
      ok: chk.ok,
      decision: '',
      decidedAt: 0
    };
    queue.unshift(item);
    if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
    save();
    return item;
  }

  function decide(id, decision) {
    var item = null;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) { item = queue[i]; break; }
    }
    if (!item) return null;
    item.decision = decision || '';
    item.decidedAt = now();
    save();
    return item;
  }

  function remove(id) {
    var before = queue.length;
    queue = queue.filter(function (q) { return q.id !== id; });
    save();
    return queue.length !== before;
  }

  function clearAll() { queue = []; save(); }

  function stats() {
    var pending = 0, high = 0, decided = 0;
    queue.forEach(function (q) {
      if (!q.decision) { pending++; if (q.risk >= 60) high++; }
      else decided++;
    });
    return { total: queue.length, pending: pending, high: high, decided: decided };
  }

  window.Moder = {
    RULES: RULES,
    reset: reset,
    push: push,
    noteViolation: noteViolation,
    setConc: setConc,
    check: check,
    submit: submit,
    decide: decide,
    remove: remove,
    clearAll: clearAll,
    queue: function () { return queue.slice(); },
    stats: stats,
    level: function (risk) {
      return risk >= 60 ? 'высокий' : (risk >= 25 ? 'средний' : 'низкий');
    }
  };

  queue = load();
})();
