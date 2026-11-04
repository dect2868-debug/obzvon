/* ============================================================
   ОБЗВОН v7.0 :: PROFILES — профили участников и оценка доверия

   Система запоминает анонимные профили устройств: сколько обзвонов
   было, средняя концентрация, типичная реакция. По этим данным
   считается оценка доверия (0–100) — тех. администратор видит, кто
   стабильно проходит проверки, а где стоит присмотреться.

   Профиль — это НЕ человек: это хеш отпечатка устройства. Никаких
   имён, документов и личных данных здесь нет.
   ============================================================ */
window.Profiles = (function () {
  'use strict';

  var KEY = 'obzvon_v2_profiles';
  var MAX = 200;

  var items = {};   /* id → профиль */
  var loaded = false;

  /* быстрый некриптографический хеш (нужен только идентификатор) */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /* отпечаток устройства → короткий анонимный ключ */
  function deviceKey() {
    var raw = [
      navigator.userAgent || '', navigator.hardwareConcurrency || 0,
      navigator.deviceMemory || 0, (navigator.languages || []).join(','),
      screen.width || 0, screen.height || 0, window.devicePixelRatio || 1
    ].join('|');
    return fnv1a(raw) + fnv1a(raw.split('').reverse().join(''));
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (d && typeof d === 'object') items = d;
    } catch (e) { items = {}; }
  }

  function save() {
    try {
      var keys = Object.keys(items);
      if (keys.length > MAX) {
        keys.sort(function (a, b) { return (items[a].lastAt || 0) - (items[b].lastAt || 0); });
        for (var i = 0; i < keys.length - MAX; i++) delete items[keys[i]];
      }
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) {}
  }

  function current() {
    load();
    var id = deviceKey();
    if (!items[id]) {
      items[id] = {
        id: id, firstAt: Date.now(), lastAt: Date.now(),
        calls: 0, concSum: 0, reactSum: 0, reactN: 0, violSum: 0, calibPass: 0
      };
      save();
    }
    return items[id];
  }

  /* обновление профиля после обзвона */
  function onSession(rec) {
    load();
    var p = current();
    var r = rec || {};
    p.calls++;
    p.lastAt = Date.now();
    p.concSum += Number(r.conc) || 0;
    if (r.reaction !== null && r.reaction !== undefined) { p.reactSum += Number(r.reaction) || 0; p.reactN++; }
    p.violSum += Number(r.viol) || 0;
    if (r.calibrated) p.calibPass++;
    save();
    return p;
  }

  /* оценка доверия: средняя концентрация минус штраф за нарушения */
  function trust(p) {
    if (!p || !p.calls) return 0;
    var avgConc = p.concSum / p.calls;
    var penalty = Math.min(25, (p.violSum / p.calls) * 4);
    var bonus = p.calls >= 3 ? 4 : 0;      /* постоянство — тоже плюс */
    return Math.max(0, Math.min(100, Math.round(avgConc - penalty + bonus)));
  }

  function trustLabel(v) {
    if (v >= 75) return 'высокое';
    if (v >= 45) return 'среднее';
    return 'подозрительно';
  }

  function list() {
    load();
    var out = [];
    Object.keys(items).forEach(function (k) {
      var p = items[k];
      var t = trust(p);
      out.push({
        id: p.id,
        firstAt: p.firstAt, lastAt: p.lastAt,
        calls: p.calls || 0,
        conc: p.calls ? Math.round(p.concSum / p.calls) : 0,
        reaction: p.reactN ? Math.round(p.reactSum / p.reactN) : null,
        viol: p.violSum || 0,
        trust: t,
        trustLabel: trustLabel(t)
      });
    });
    out.sort(function (a, b) { return (b.lastAt || 0) - (a.lastAt || 0); });
    return out;
  }

  function clear() { loaded = true; items = {}; save(); }

  return {
    deviceKey: deviceKey, current: current, onSession: onSession,
    list: list, trust: trust, trustLabel: trustLabel, clear: clear
  };
})();
