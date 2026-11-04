/* ============================================================
   Статус автоподдержки ОБЗВОН (v5.0)

   Этот файл пишет CI на GitHub, а сайт показывает его тех.
   администратору: сразу видно, что автоподдержка жива, какая
   версия собрана и когда был последний прогон.

     node tools/status.js ok "всё в порядке"
     node tools/status.js failed "тесты не прошли"
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const result = (argv[0] === 'failed' || argv[0] === 'error') ? 'failed' : 'ok';
const notes = argv.slice(1).join(' ');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) { return ''; }
}

let v = '';
try { v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).v; } catch (e) {}

const data = {
  app: 'obzvon-status',
  v: v,
  at: new Date().toISOString(),
  result: result,
  commit: git(['rev-parse', 'HEAD']),
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  notes: notes || (result === 'ok' ? 'проверки пройдены, версия собрана' : 'проверки не пройдены'),
  run: process.env.GITHUB_RUN_ID || '',
  url: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
    ? process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + (process.env.GITHUB_RUN_ID || '')
    : ''
};

fs.writeFileSync(path.join(ROOT, 'status.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('status.json записан: ' + result + ' · версия ' + v);
