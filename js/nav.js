/* ============================================================
   ОБЗВОН v3.2 · NAV — боковая панель и подсветка разделов
   ============================================================ */
(function () {
  'use strict';

  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('sideScrim');
  var btnNav = document.getElementById('btnNav');
  var links = [].slice.call(document.querySelectorAll('.side-nav .nav-link'));

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

  /* ---------- плавный переход к разделу ---------- */
  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = (a.getAttribute('href') || '').replace('#', '');
      var target = id && document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      setDrawer(false);
      target.scrollIntoView({ block: 'start' });
      setActive(id);
    });
  });

  function setActive(id) {
    links.forEach(function (a) {
      a.classList.toggle('active', (a.getAttribute('href') || '') === '#' + id);
    });
  }

  /* ---------- подсветка текущего раздела при скролле ---------- */
  var ids = links.map(function (a) { return (a.getAttribute('href') || '').replace('#', ''); })
                 .filter(Boolean);
  var targets = ids.map(function (id) { return document.getElementById(id); })
                   .filter(Boolean);

  if ('IntersectionObserver' in window && targets.length) {
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting ? en.intersectionRatio : 0; });
      var best = null, bestR = 0;
      ids.forEach(function (id) {
        var r = visible[id] || 0;
        if (r > bestR) { bestR = r; best = id; }
      });
      if (best) setActive(best);
    }, { threshold: [0, 0.15, 0.4, 0.75], rootMargin: '-70px 0px -45% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ---------- при активном испытании подсветка «Испытания» ---------- */
  var playfield = document.getElementById('playfield');
  if (playfield && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (!playfield.hidden) setActive('gate');
    }).observe(playfield, { attributes: true, attributeFilter: ['hidden'] });
  }
})();
