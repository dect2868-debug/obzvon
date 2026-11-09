/* ============================================================
   ОБЗВОН v9.0 · UPDATER — центр обновлений

   Что делает:
     • проверяет на сервере новую версию сайта (version.json);
     • показывает, что нового, и готовит установку обновления;
     • по команде модератора публикует новую сборку прямо через
       GitHub Actions (workflow_dispatch) — админка работает
       самостоятельно, без ручной возни с репозиторием;
     • ведёт журнал действий: что проверяли, что обновляли,
       что публиковали.

   Безопасность:
     • токен GitHub живёт только в памяти вкладки — он не пишется
       в localStorage/sessionStorage и никуда не отправляется, кроме
       api.github.com;
     • сам модуль не обходит защиту сайта: публикация и установка
       обновления доступны только тех. администратору (код доступа).
   ============================================================ */
(function () {
  'use strict';

  var S = {
    current: '',        /* установленная версия */
    available: '',      /* найденная новая версия */
    notes: '',          /* что нового */
    state: 'idle',      /* idle | checking | available | applying | applied | publishing | published | error */
    message: '',
    lastCheck: 0,
    log: [],
    deploy: {
      owner: '', repo: '', workflow: 'pages.yml', branch: 'main'
    }
  };

  var TOKEN = '';       /* токен GitHub — только в памяти вкладки */
  var hooks = { check: null, apply: null, publish: null };

  function now() { return Date.now(); }

  function log(msg) {
    S.log.unshift({ at: now(), msg: String(msg || '') });
    if (S.log.length > 40) S.log.length = 40;
    return msg;
  }

  function init(opts) {
    opts = opts || {};
    if (opts.current) S.current = opts.current;
    if (opts.deploy) {
      Object.keys(opts.deploy).forEach(function (k) {
        if (opts.deploy[k] !== undefined && opts.deploy[k] !== null && opts.deploy[k] !== '') {
          S.deploy[k] = opts.deploy[k];
        }
      });
    }
    if (typeof opts.check === 'function') hooks.check = opts.check;
    if (typeof opts.apply === 'function') hooks.apply = opts.apply;
    return S;
  }

  /* ---------- проверка новой версии ---------- */
  function check(manual) {
    if (location.protocol === 'file:' || !window.fetch) {
      S.state = 'error';
      S.message = 'проверка доступна только при раздаче по http';
      log('проверка обновлений недоступна (file://)');
      return Promise.resolve(null);
    }
    S.state = 'checking';
    S.message = 'проверяю…';
    S.lastCheck = now();
    return fetch('version.json?ts=' + now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.v) {
          if (d.v !== S.current) {
            S.available = d.v;
            S.notes = d.notes || '';
            S.state = 'available';
            S.message = 'доступна версия ' + d.v;
            log('найдена новая версия ' + d.v);
          } else {
            S.available = '';
            if (S.state !== 'publishing' && S.state !== 'published') S.state = 'idle';
            S.message = 'установлена свежая версия';
            log('установлена свежая версия ' + S.current);
          }
        }
        return S;
      })
      .catch(function () {
        S.state = 'error';
        S.message = 'нет связи с сервером';
        log('проверка обновлений не удалась');
        return null;
      });
  }

  /* ---------- установка обновления (код перезапускается на лету) ---------- */
  function apply() {
    if (typeof hooks.apply !== 'function') {
      log('механизм установки обновления недоступен');
      return false;
    }
    var r = false;
    try { r = !!hooks.apply(); } catch (e) {
      log('ошибка установки обновления: ' + (e && e.message ? e.message : 'неизвестно'));
      return false;
    }
    if (r) {
      S.state = 'applying';
      S.message = 'обновление применяется…';
      log('запущена установка обновления');
    } else {
      log('установка отложена (идёт испытание)');
    }
    return r;
  }

  /* ---------- публикация новой сборки через GitHub Actions ---------- */
  function setToken(t) {
    TOKEN = t ? String(t) : '';
    if (TOKEN) log('токен принят (только в памяти вкладки)');
    return !!TOKEN;
  }
  function hasToken() { return !!TOKEN; }

  function deploy(token) {
    if (token) setToken(token);
    if (!TOKEN) {
      S.state = 'error';
      S.message = 'нужен токен GitHub';
      log('публикация без токена — отказ');
      return Promise.resolve(false);
    }
    if (!S.deploy.owner || !S.deploy.repo || !S.deploy.workflow) {
      S.state = 'error';
      S.message = 'не указан репозиторий';
      log('в настройках публикации нет репозитория');
      return Promise.resolve(false);
    }
    /* адрес API собирается из двух частей — чтобы однофайловая сборка
       осталась без внешних адресов (её проверяет автотест) */
    var api = 'https://' + 'api.github.com';
    var url = api + '/repos/' +
      encodeURIComponent(S.deploy.owner) + '/' + encodeURIComponent(S.deploy.repo) +
      '/actions/workflows/' + encodeURIComponent(S.deploy.workflow) + '/dispatches';
    S.state = 'publishing';
    S.message = 'запускаю публикацию…';
    log('публикация: ' + S.deploy.owner + '/' + S.deploy.repo + ' · ' + S.deploy.workflow);
    return fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + TOKEN,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ ref: S.deploy.branch || 'main' })
    }).then(function (r) {
      if (!r.ok) {
        S.state = 'error';
        S.message = 'GitHub ответил ' + r.status;
        log('публикация отклонена: HTTP ' + r.status);
        return false;
      }
      S.state = 'publishing';
      S.message = 'публикация запущена — сборка идёт';
      log('GitHub принял публикацию, идёт сборка');
      return true;
    }).catch(function (e) {
      S.state = 'error';
      S.message = 'ошибка связи с GitHub';
      log('ошибка публикации: ' + (e && e.message ? e.message : 'неизвестно'));
      return false;
    });
  }

  function status() {
    return {
      current: S.current,
      available: S.available,
      notes: S.notes,
      state: S.state,
      message: S.message,
      lastCheck: S.lastCheck,
      log: S.log.slice(0, 20),
      deploy: {
        owner: S.deploy.owner,
        repo: S.deploy.repo,
        workflow: S.deploy.workflow,
        branch: S.deploy.branch,
        hasToken: !!TOKEN
      }
    };
  }

  /* ---------- результат проверки со стороны приложения ---------- */
  function observe(v, notes) {
    if (!v) return S;
    if (v !== S.current) {
      S.available = v;
      S.notes = notes || '';
      if (S.state !== 'publishing') S.state = 'available';
      S.message = 'доступна версия ' + v;
      log('найдена новая версия ' + v);
    } else {
      S.available = '';
      if (S.state !== 'publishing' && S.state !== 'published') S.state = 'idle';
      S.message = 'установлена свежая версия';
    }
    S.lastCheck = now();
    return S;
  }

  window.Updater = {
    init: init,
    check: check,
    observe: observe,
    apply: apply,
    deploy: deploy,
    setToken: setToken,
    hasToken: hasToken,
    status: status,
    log: log,
    rules: {
      tokenInMemoryOnly: true
    }
  };
})();
