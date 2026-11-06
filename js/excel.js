/* ============================================================
   ОБЗВОН v7.2 :: EXCEL — выгрузка таблиц в настоящий .xlsx

   Файл формата Excel (Office Open XML) собирается прямо здесь,
   без библиотек и без интернета: xlsx — это ZIP-архив с XML.
   Внутри — только свои данные, ничего наружу не уходит.

   Использование:
     Excel.build([{ name: 'Лист1', rows: [[колонка1, колонка2], ...] }], 'имя.xlsx')
     Excel.download(sheets, 'файл.xlsx')   — в браузере: сразу скачивает

   Первая строка каждой таблицы — заголовок (выделяется жирным).
   ============================================================ */
(function () {
  'use strict';

  /* ---------- UTF-8 (свой: jsdom может не дать TextEncoder) ---------- */
  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  /* ---------- CRC32 для ZIP ---------- */
  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    CRC_TABLE = t;
    return t;
  }
  function crc32(bytes) {
    var t = crcTable();
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ t[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- ZIP (без сжатия — это валидный ZIP) ---------- */
  var DOS_TIME = ((12 << 11) | (0 << 5) | 0);              /* 12:00 */
  var DOS_DATE = (((2026 - 1980) << 9) | (11 << 5) | 6);   /* 06.11.2026 */

  function zip(entries) {
    var parts = [];
    var central = [];
    var offset = 0;

    entries.forEach(function (e) {
      var name = utf8(e.name);
      var data = e.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + name.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   /* локальная запись */
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);       /* имена файлов — UTF-8 */
      lv.setUint16(8, 0, true);            /* метод: хранение */
      lv.setUint16(10, DOS_TIME, true);
      lv.setUint16(12, DOS_DATE, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);

      var cen = new Uint8Array(46 + name.length);
      var cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);   /* центральная запись */
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, DOS_TIME, true);
      cv.setUint16(14, DOS_DATE, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);           /* extra */
      cv.setUint16(32, 0, true);           /* comment */
      cv.setUint16(34, 0, true);           /* disk */
      cv.setUint16(36, 0, true);           /* internal attrs */
      cv.setUint32(38, 0, true);           /* external attrs */
      cv.setUint32(42, offset, true);
      cen.set(name, 46);

      parts.push(local, data);
      central.push(cen);
      offset += local.length + data.length;
    });

    var centralSize = 0;
    central.forEach(function (c) { centralSize += c.length; });

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    var all = parts.concat(central);
    all.push(eocd);

    var total = 0;
    all.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ---------- XML ---------- */
  function xesc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      /* управляющие символы ломают XML — выкидываем */
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function colName(n) {           /* 0 → A, 25 → Z, 26 → AA */
    var s = '';
    n = Math.max(0, n | 0);
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  }

  function safeSheetName(name, used) {
    var s = String(name || 'Лист').replace(/[\\\/\*\?:\[\]]/g, '-').slice(0, 31) || 'Лист';
    var base = s, i = 2;
    while (used[s]) s = (base.slice(0, 28) + '-' + i++);
    used[s] = true;
    return s;
  }

  function cellXml(ref, v, header) {
    var style = header ? ' s="1"' : '';
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) {
      return '<c r="' + ref + '"' + style + '><v>' + v + '</v></c>';
    }
    if (typeof v === 'boolean') v = v ? 'да' : 'нет';
    return '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' +
      xesc(String(v)) + '</t></is></c>';
  }

  function sheetXml(rows) {
    var body = [];
    rows.forEach(function (row, r) {
      if (!Array.isArray(row)) return;
      var cells = [];
      row.forEach(function (v, c) {
        var x = cellXml(colName(c) + (r + 1), v, r === 0);
        if (x) cells.push(x);
      });
      if (cells.length) body.push('<row r="' + (r + 1) + '">' + cells.join('') + '</row>');
    });

    /* ширины колонок — по самой длинной ячейке (округлённо) */
    var widths = [];
    rows.forEach(function (row) {
      if (!Array.isArray(row)) return;
      row.forEach(function (v, c) {
        if (v === null || v === undefined) return;
        var len = String(typeof v === 'number' ? Math.round(v) : v).length + 2;
        widths[c] = Math.min(60, Math.max(widths[c] || 8, len));
      });
    });
    var cols = '';
    if (widths.length) {
      cols = '<cols>' + widths.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      cols + '<sheetData>' + body.join('') + '</sheetData></worksheet>';
  }

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ---------- сборка книги ---------- */
  function build(sheets) {
    if (!Array.isArray(sheets) || !sheets.length) sheets = [{ name: 'Лист1', rows: [[]] }];
    var used = {};
    var names = sheets.map(function (s) { return safeSheetName(s.name, used); });

    var files = [];

    files.push({ name: '[Content_Types].xml', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      names.map(function (_, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ' +
          'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>') });

    files.push({ name: '_rels/.rels', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>') });

    files.push({ name: 'xl/workbook.xml', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map(function (n, i) {
        return '<sheet name="' + xesc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>') });

    files.push({ name: 'xl/_rels/workbook.xml.rels', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names.map(function (_, i) {
        return '<Relationship Id="rId' + (i + 1) + '" ' +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
          'Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>') });

    files.push({ name: 'xl/styles.xml', data: utf8(STYLES_XML) });

    sheets.forEach(function (s, i) {
      files.push({
        name: 'xl/worksheets/sheet' + (i + 1) + '.xml',
        data: utf8(sheetXml(Array.isArray(s.rows) ? s.rows : []))
      });
    });

    return zip(files);
  }

  /* ---------- скачивание в браузере ---------- */
  function download(sheets, filename) {
    var bytes = build(sheets);
    var name = String(filename || 'obzvon.xlsx').replace(/[\\\/:*?"<>|]/g, '-');
    try {
      var blob = new Blob([bytes],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return true;
    } catch (e) { return false; }
  }

  var api = { build: build, download: download, zip: zip, crc32: crc32, utf8: utf8 };

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Excel = api;
})();
