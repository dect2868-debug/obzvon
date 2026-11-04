/* ============================================================
   ОБЗВОН v5.2 · NAV — страницы-разделы и боковая панель
   ============================================================ */
(function () {
  'use strict';

  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('sideScrim');
  var btnNav = document.getElementById('btnNav');
  var links = [].slice.call(document.querySelectorAll('.side-nav .nav-link'));
  var views = [].slice.call(document.querySelectorAll('.page .view'));

  /* ---------- мобильная шторка ---------- */
  function setDrawer(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (scrim) scrim.hidden = !open;
    if (btnNav) btnNav.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (btnNav) btnNav.addEventListener('click', function () {
    setDrawer(!(sidebar && sidebar.classList.contains('open')));
  });
  if (scrim) scrim.addEventListener('click', function () { setDrawer(false); });

  /* ---------- переключение страниц ---------- */
  var current = 'seance';
  function showView(name) {
    var found = false;
    views.forEach(function (v) {
      var on = (v.id === 'view-' + name);
      v.hidden = !on;
      if (on) found = true;
    });
    if (!found) return;
    var changed = (current !== name);
    current = name;
    links.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-view') === name);
    });
    if (changed && window.scrollTo) window.scrollTo(0, 0);
  }

  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      setDrawer(false);
      showView(a.getAttribute('data-view'));
    });
  });

  /* ---------- при активном испытании — страница «Сеанс» ---------- */
  function toSeance() {
    var pf = document.getElementById('playfield');
    var wasOn = (current === 'seance');
    showView('seance');
    if (pf && !pf.hidden && pf.scrollIntoView) {
      /* если арена не влезает в экран — подскроллить к ней */
      try {
        var r = pf.getBoundingClientRect();
        if (!wasOn || r.top < 4 || r.bottom > (window.innerHeight || 9999)) {
          pf.scrollIntoView({ block: 'center' });
        }
      } catch (e) { try { pf.scrollIntoView({ block: 'center' }); } catch (e2) {} }
    }
  }
  var playfield = document.getElementById('playfield');
  if (playfield && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (!playfield.hidden) toSeance();
    }).observe(playfield, { attributes: true, attributeFilter: ['hidden'] });
  }

  /* ---------- гейт калибровки тоже живёт на странице «Сеанс» ---------- */
  var gate = document.getElementById('gate');
  if (gate && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (!gate.hidden) toSeance();
    }).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  }

  /* ---------- новое испытание: вернуть на «Сеанс», где бы ни были ---------- */
  var chTask = document.getElementById('chTask');
  if (chTask && playfield && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (!playfield.hidden) toSeance();
    }).observe(chTask, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- итог сессии — страница «Результаты» ---------- */
  var sum = document.getElementById('sumOverlay');
  if (sum && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (!sum.hidden) showView('results');
    }).observe(sum, { attributes: true, attributeFilter: ['hidden'] });
  }
})();
