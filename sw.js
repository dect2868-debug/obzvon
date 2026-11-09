/* ============================================================
   ОБЗВОН v7.1 :: SERVICE WORKER — офлайн-режим и самообновление

   Что делает:
     • кладёт «оболочку» сайта в кэш браузера — страница открывается
       даже без сети (а обзвон продолжается: испытания, таймеры, журнал
       работают локально);
     • сам следит за version.json: появилась новая версия — перезабирает
       файлы в кэш и говорит открытым вкладкам «обновитесь»;
     • никогда не ходит на чужие домены и не отдаёт ничего извне своего
       origin — это проверено автотестом (tests/audit.js).

   Файл лежит в корне сайта (тот же домен) и обновляется сам: браузер
   перечитывает sw.js при каждом заходе и ставит новую версию, если файл
   изменился.
   ============================================================ */

var CACHE_NAME = 'obzvon-shell-v9.0';
var CACHE_PREFIX = 'obzvon-shell-';

/* файлы, которые нужны для работы без сети */
var SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './assets/logo.svg',
  './js/fx.js',
  './js/monitor.js',
  './js/nav.js',
  './js/live.js',
  './js/archive.js',
  './js/audit.js',
  './js/stats.js',
  './js/profiles.js',
  './js/health.js',
  './js/excel.js',
  './js/moder.js',
  './js/updater.js',
  './js/app.js',
  './js/auth.local.js',
  './version.json',
  './config.json',
  './status.json',
  './integrity.json'
];

/* то, что всегда должно идти из сети (свежесть важнее) */
function isFreshFirst(url) {
  return /\/version\.json$/.test(url.pathname) ||
         /\/config\.json$/.test(url.pathname) ||
         /\/status\.json$/.test(url.pathname) ||
         /\/integrity\.json$/.test(url.pathname);
}

function cacheVersion() {
  /* версия, которую сейчас держим в кэше */
  return caches.open(CACHE_NAME).then(function (c) {
    return c.match('./version.json').then(function (r) {
      if (!r) return null;
      return r.json().then(function (d) { return (d && d.v) || null; }).catch(function () { return null; });
    });
  });
}

function putInCache(url, response) {
  /* в кэш кладём только удачные ответы — ошибки сервера не затирают
     сохранённую копию */
  if (!response || !response.ok) return response;
  var copy = response.clone();
  caches.open(CACHE_NAME).then(function (c) {
    c.put(url, copy).catch(function () {});
  });
  return response;
}

function refreshShell() {
  /* перезабираем оболочку: новая версия попада��т в кэш */
  return caches.open(CACHE_NAME).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return fetch(u, { cache: 'no-store' }).then(function (r) {
        if (r && r.ok) return c.put(u, r);
        return null;
      }).catch(function () { return null; });
    }));
  });
}

function notifyClients(msg) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function (list) {
    list.forEach(function (cl) {
      try { cl.postMessage(msg); } catch (e) {}
    });
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        /* чистим всё, кроме текущего кэша (и его предыдущих версий) */
        if (k !== CACHE_NAME && k.indexOf(CACHE_PREFIX) === 0) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  /* только свой домен — наружу не ходим и чужое не отдаём */
  if (url.origin !== self.location.origin) return;

  /* навигация: сеть, а при отсутствии или ошибке сети — кэш */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        if (r && r.ok) return putInCache('./index.html', r);
        /* сервер ответил ошибкой (502 и т.п.) — отдаём сохранённую страницу */
        return caches.match('./index.html').then(function (cached) {
          return cached || r;
        });
      }).catch(function () {
        return caches.match('./index.html').then(function (cached) {
          return cached || new Response('Сайт недоступен офлайн и не был сохранён.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  /* свежие файлы: сеть, при ошибке — кэш */
  if (isFreshFirst(url)) {
    e.respondWith(
      fetch(req).then(function (r) {
        if (r && r.ok) {
          /* кладём под чистый путь (без ?ts=), чтобы читать потом стабильно */
          putInCache(url.pathname, r);
          return r;
        }
        /* сервер ответил ошибкой (502 и т.п.) — свежая копия из кэша
           (ignoreSearch: ?ts= каждый раз новый) */
        return caches.match(req, { ignoreSearch: true }).then(function (cached) {
          return cached || r;
        });
      }).catch(function () {
        return caches.match(req).then(function (r) {
          return r || caches.match(req, { ignoreSearch: true });
        });
      })
    );
    return;
  }

  /* остальное: сразу из кэша, обновление — фоном (только если файла
     в кэше нет — иначе офлайн ловит лишние сетевые ошибки).
     ignoreSearch: страница запрашивает файлы с ?v=7.0 (антикэш-метка),
     а в кэше они лежат без запроса. */
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || caches.match(req, { ignoreSearch: true });
    }).then(function (cached) {
      if (cached) {
        /* есть копия — отдаём её сразу, а фоном (только при сети)
           перепроверяем файл: свежесть важна, ожидание — нет */
        if (self.navigator && self.navigator.onLine) {
          fetch(req).then(function (r) {
            if (r && r.ok) putInCache(req, r);
          }).catch(function () {});
        }
        return cached;
      }
      return fetch(req).then(function (r) {
        if (r && r.ok) return putInCache(req, r);
        return r;
      }).catch(function () {
        return new Response('Файл недоступен офлайн.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});

/* страница просит: обновить офлайн-кэш */
self.addEventListener('message', function (e) {
  var data = e.data || {};
  if (data.type === 'refresh' || data.type === 'update') {
    e.waitUntil(
      refreshShell().then(function () {
        return notifyClients({ type: 'offline-updated', at: Date.now() });
      })
    );
    return;
  }
  if (data.type === 'check') {
    e.waitUntil(checkUpdate());
  }
});

/* самообновление: сверяем версию с сервером */
function checkUpdate() {
  return fetch('./version.json?ts=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.v) return false;
      return cacheVersion().then(function (cached) {
        if (!cached || cached === d.v) return false;
        return refreshShell().then(function () {
          return notifyClients({ type: 'version', v: d.v, prev: cached }).then(function () { return true; });
        });
      });
    })
    .catch(function () { return false; });
}

/* своя проверка обновлений (раз в 10 минут) */
setInterval(function () { checkUpdate(); }, 10 * 60 * 1000);
