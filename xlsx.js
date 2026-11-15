// Minimal zip + xlsx reader (no dependencies): unzip(buffer) → {name: Buffer}; sheets(file) → {sheetName: [[cell, ...], ...]}. Used by state-demo.js and cps.js.
const fs = require('fs'), zlib = require('zlib');
function unzip(buf) { // every entry, via the central directory
  const out = {}; let p = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6])); const n = buf.readUInt16LE(p + 10); p = buf.readUInt32LE(p + 16);
  for (let i = 0; i < n; i++) { const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nl);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.subarray(start, start + size);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data; p += 46 + nl + el + cl; }
  return out;
}
const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function sheets(file) { // {sheetName: [[cell, ...], ...]}
  const z = unzip(fs.readFileSync(file)), wb = z['xl/workbook.xml'].toString(), rels = z['xl/_rels/workbook.xml.rels'].toString();
  const shared = z['xl/sharedStrings.xml'] ? [...z['xl/sharedStrings.xml'].toString().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join(''))) : [];
  const out = {};
  for (const [, name, rid] of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
    const xml = z['xl/' + target.replace(/^\/?xl\//, '')].toString(), rows = [];
    for (const [, r] of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) { const row = [];
      for (const [, attrs, body] of r.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) { const col = attrs.match(/r="([A-Z]+)\d+"/)[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, t = attrs.match(/t="(\w+)"/)?.[1];
        const v = body?.match(/<v>([^<]*)<\/v>/)?.[1], is = body?.match(/<is>([\s\S]*?)<\/is>/)?.[1];
        row[col] = t === 'inlineStr' ? xmlText([...(is ?? '').matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]).join('')) : t === 's' ? shared[+v] : t === 'str' ? xmlText(v ?? '') : v == null ? null : +v; }
      rows.push(row); }
    out[name] = rows; }
  return out;
}
module.exports = { unzip, sheets };
