/**
 * Reads every story out of solvix.html: the English narration is the text of
 * each mission <figcaption>, the Arabic narration is the AR array that the
 * spoken reader already uses. Nothing is rewritten here: this only extracts
 * the exact strings the site shows.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const HTML = path.join(ROOT, 'solvix.html');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu;

/** The same cleanup the page applies before speaking. */
export function clean(text) {
  return String(text || '')
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text of a tag soup fragment, entities decoded, whitespace collapsed. */
function textOf(html) {
  return clean(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  );
}

/** Every [start,end] of a bracketed literal, respecting quotes. */
function arrayLiteral(src, needle) {
  const start = src.indexOf(needle);
  if (start < 0) throw new Error('could not find ' + needle);
  const open = src.indexOf('[', start + needle.length);
  if (open < 0) throw new Error('could not find array for ' + needle);
  let depth = 0, quote = '';
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (!depth) return src.slice(open, i + 1);
    }
  }
  throw new Error('unterminated array for ' + needle);
}

function arabicTexts(src) {
  const literal = arrayLiteral(src, 'const AR =');
  const list = JSON.parse(literal.replace(/,\s*]$/, ']'));
  return list.map(clean);
}

function figures(src) {
  const out = [];
  const re = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1];
    const body = m[2];
    const mm = /data-m\s*=\s*"(\d+)"/.exec(attrs);
    if (!mm) continue;
    const cap = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/.exec(body);
    if (!cap) continue;
    out.push({ machine: +mm[1], text: textOf(cap[1]) });
  }
  return out;
}

function vehicles() {
  // The machine list is the one the site itself uses (js/explore.js), so ids in
  // the manifest and on the page can never drift apart.
  const file = path.join(ROOT, 'js', 'explore.js');
  const src = fs.readFileSync(file, 'utf8');
  const list = [];
  const re = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*world:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) list.push({ id: m[1], name: m[2], world: m[3] });
  if (!list.length) throw new Error('no machines found in js/explore.js');
  return list;
}

export function hashOf(parts) {
  return crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

/** Every story, in page order, with both language texts. */
export function readStories() {
  const src = fs.readFileSync(HTML, 'utf8');
  const ar = arabicTexts(src);
  const figs = figures(src);
  const cars = vehicles();
  if (ar.length !== figs.length) {
    throw new Error('Arabic array has ' + ar.length + ' entries but there are ' + figs.length + ' slides');
  }
  const seen = new Map();
  return figs.map((fig, i) => {
    const car = cars[fig.machine] || { id: 'machine-' + fig.machine, name: 'Machine ' + fig.machine, world: '' };
    const n = (seen.get(fig.machine) || 0) + 1;
    seen.set(fig.machine, n);
    const num = String(n).padStart(2, '0');
    return {
      id: car.id + '/' + num,
      machine: car.id,
      machineName: car.name,
      world: car.world,
      slide: n,
      order: i,
      texts: { en: clean(fig.text), ar: ar[i] }
    };
  });
}

if (process.argv[1] && process.argv[1].endsWith('extract.mjs')) {
  const stories = readStories();
  const byMachine = {};
  stories.forEach(s => { byMachine[s.machine] = (byMachine[s.machine] || 0) + 1; });
  console.log('stories: ' + stories.length);
  console.log('machines: ' + Object.keys(byMachine).length + ' -> ' + Object.entries(byMachine).map(([k, v]) => k + '(' + v + ')').join(', '));
  const bad = stories.filter(s => !s.texts.en || !s.texts.ar);
  console.log('missing text: ' + bad.length);
  stories.slice(0, 2).forEach(s => {
    console.log('  ' + s.id + ' en=' + s.texts.en.length + 'ch ar=' + s.texts.ar.length + 'ch');
  });
}
