/* ============================================================
   Общий раннер тестов ОБЗВОНА: smoke + e2e + security + load
   Запуск: npm test
   ============================================================ */
'use strict';

const suites = [
  require('./smoke'),
  require('./e2e'),
  require('./security'),
  require('./roles'),
  require('./v6'),
  require('./stats'),
  require('./v7'),
  require('./v71'),
  require('./v72'),
  require('./v75'),
  require('./v77'),
  require('./v79'),
  require('./v711'),
  require('./v713'),
  require('./v80'),
  require('./v90'),
  require('./audit'),
  require('./load'),
  require('./build')
];

(async () => {
  let pass = 0, fail = 0;
  const failed = [];
  const t0 = Date.now();
  for (const s of suites) {
    const r = await s.run();
    pass += r.pass; fail += r.fail;
    r.failures.forEach((f) => failed.push({ suite: s.name, ...f }));
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n================================================');
  console.log('ИТОГО: ' + pass + ' PASS, ' + fail + ' FAIL  (' + sec + ' с)');
  if (fail) {
    console.log('\nПровалены проверки:');
    failed.forEach((f) => console.log('  • [' + f.suite + '] ' + f.title + ' — ' + (f.error && f.error.message)));
  }
  console.log('================================================');
  process.exit(fail ? 1 : 0);
})();
