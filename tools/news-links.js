/* ============================================================
   Связать новости с разделами сайта (v7.1)

   Каждая запись в разделе «Новости» получает метку раздела —
   ссылку на то место сайта, где это менялось:
     «защита»      → справка, карточка «Защита обзвона»
     «надзор»      → админка
     «интерфейс»   → сеанс
     «автоподдержка» → админка (состояние сборки)
     «обновление»  → сами новости

   Запуск:  node tools/news-links.js
   (безопасный: существующие метки не дублируются)
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index.html');

function newsArea(text) {
  const t = String(text || '').toLowerCase();
  if (/защит|безопас|взлом|шифр|код/.test(t)) return { label: 'защита', view: 'help', anchor: 'protect' };
  if (/надзор|админ|монитор|профил|тревог|статист/.test(t)) return { label: 'надзор', view: 'health', anchor: '' };
  if (/интерфейс|кноп|меню|тему|шрифт|экран|цвет/.test(t)) return { label: 'интерфейс', view: 'seance', anchor: '' };
  if (/автоподдерж|ci|github|обновлен|релиз|верси|автомат/.test(t)) return { label: 'автоподдержка', view: 'health', anchor: '' };
  return { label: 'обновление', view: 'news', anchor: '' };
}

let html = fs.readFileSync(FILE, 'utf8');
const before = html;

/* каждая статья новостей: заголовок <h3>…</h3> и тело */
const re = /(<article class="news-item[^"]*">[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<\/div>)(\s*<\/article>)/g;
let added = 0;

html = html.replace(re, (whole, body, title, tail) => {
  if (body.indexOf('news-area') >= 0) return whole;      /* метка уже есть */
  const area = newsArea(title.replace(/<[^>]+>/g, ''));
  const chip =
    '                    <a class="news-area" data-view="' + area.view + '"' +
    (area.anchor ? ' data-anchor="' + area.anchor + '"' : '') +
    '>' + area.label + '</a>\n';
  added++;
  return body.replace(/(\s*<\/div>)\s*$/, '\n' + chip + '$1') + tail;
});

fs.writeFileSync(FILE, html, 'utf8');
console.log('меток разделов добавлено: ' + added + (before === html ? ' (изменений не было)' : ''));
