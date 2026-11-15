#!/usr/bin/env node
/**
 * Generates the Solvix voice-over files with Gemini TTS.
 *
 *   node scripts/voiceover/generate.mjs --check      verify the key and the model
 *   node scripts/voiceover/generate.mjs --dry-run    list what would be generated
 *   node scripts/voiceover/generate.mjs --sample     one Arabic + one English clip
 *   node scripts/voiceover/generate.mjs              everything still missing
 *   node scripts/voiceover/generate.mjs --status     what the manifest holds
 *
 * Nothing is ever regenerated while its text, voice, style and model are the
 * same as the manifest's. Generation happens here only: the website just plays
 * the finished files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, readStories, hashOf } from './extract.mjs';
import { MODEL, API, LANGS, LIMITS, DIRS } from './config.mjs';

/* ------------------------------- arguments ------------------------------- */
const argv = process.argv.slice(2);
const flag = name => argv.includes('--' + name);
const value = (name, fallback) => {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const opts = {
  check: flag('check'),
  dry: flag('dry-run'),
  sample: flag('sample'),
  status: flag('status'),
  force: flag('force'),
  only: value('only', ''),
  lang: value('lang', ''),
  voice: value('voice', ''),
  model: value('model', MODEL),
  batch: +value('batch', 0),
  maxRequests: +value('max-requests', LIMITS.maxRequests),
  maxChars: +value('max-chars', LIMITS.maxChars),
  minInterval: +value('min-interval', LIMITS.minInterval)
};

/* --------------------------------- helpers -------------------------------- */
const abs = rel => path.join(ROOT, rel);

function loadEnv() {
  // A project-local .env is enough: the key never lands in any public file.
  const file = abs('.env');
  if (!fs.existsSync(file) || process.env.GEMINI_API_KEY) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const val = m[2].replace(/^['"]|['"]$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

const key = () => (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

const manifestFile = abs(DIRS.manifest);
const ledgerFile = abs(DIRS.state);
const manifest = readJson(manifestFile, { version: 1, model: MODEL, clips: {} });
manifest.clips = manifest.clips || {};
const ledger = readJson(ledgerFile, { runs: [], totals: { requests: 0, chars: 0 } });

const voiceFor = lang => opts.voice || LANGS[lang].voice;
const hashFor = (lang, text) => hashOf([opts.model, voiceFor(lang), LANGS[lang].style, lang, text]);
const keyOf = (story, lang) => story.id + '-' + lang;
const fileOf = (story, lang) => story.machine + '/' + story.id.split('/')[1] + '-' + lang;

/** ffmpeg from PATH, FFMPEG_PATH, or a portable copy under tools/. */
let ffmpegBin = null;
function findFfmpeg() {
  if (ffmpegBin !== null) return ffmpegBin;
  const candidates = [process.env.FFMPEG_PATH, 'ffmpeg', path.join(ROOT, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe'), path.join(ROOT, 'tools', 'ffmpeg', 'ffmpeg.exe')];
  for (const bin of candidates) {
    if (!bin) continue;
    const probe = spawnSync(bin, ['-version'], { stdio: 'ignore' });
    if (probe.status === 0) { ffmpegBin = bin; return bin; }
  }
  ffmpegBin = '';
  return '';
}
const hasFfmpeg = () => !!findFfmpeg();

/** Length in seconds, so the page can pace its typing to the recording. */
function probeDuration(file) {
  const bin = findFfmpeg();
  if (!bin) return 0;
  const probe = bin.replace(/ffmpeg([^\\/]*)$/, 'ffprobe$1');
  const out = spawnSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  const value = parseFloat((out.stdout || '').trim());
  return Number.isFinite(value) ? +value.toFixed(2) : 0;
}

function toMp3(wavFile, mp3File) {
  const run = spawnSync(findFfmpeg(), [
    '-y', '-loglevel', 'error', '-i', wavFile,
    '-codec:a', 'libmp3lame', '-b:a', '96k', '-ar', '24000', '-ac', '1', mp3File
  ], { stdio: 'inherit' });
  if (run.status !== 0 || !fs.existsSync(mp3File)) return false;
  fs.unlinkSync(wavFile);
  return true;
}

/* --------------------------------- the API -------------------------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callTts(text, lang) {
  const url = API + '/models/' + encodeURIComponent(opts.model) + ':generateContent';
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text, speech_metadata: { style: LANGS[lang].style } }]
    }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { voice: voiceFor(lang) } }
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) {
    let message = raw.slice(0, 400);
    try {
      const j = JSON.parse(raw);
      message = (j.error && j.error.message) || message;
    } catch { /* keep the raw text */ }
    const err = new Error('HTTP ' + res.status + ': ' + message);
    err.status = res.status;
    throw err;
  }
  const json = JSON.parse(raw);
  const part = json.candidates && json.candidates[0] && json.candidates[0].content
    && json.candidates[0].content.parts && json.candidates[0].content.parts.find(p => p.inlineData);
  if (!part || !part.inlineData || !part.inlineData.data) {
    throw new Error('no audio in the response (finishReason=' +
      ((json.candidates && json.candidates[0] && json.candidates[0].finishReason) || 'unknown') + ')');
  }
  // Unary TTS returns a complete WAV file; write it as it arrives.
  return Buffer.from(part.inlineData.data, 'base64');
}

async function checkAccess() {
  if (!key()) {
    console.log('No API key found.');
    console.log('Set GEMINI_API_KEY (environment) or put GEMINI_API_KEY=... in the project .env file.');
    return false;
  }
  const res = await fetch(API + '/models/' + encodeURIComponent(opts.model), {
    headers: { 'x-goog-api-key': key() }
  });
  const raw = await res.text();
  if (!res.ok) {
    console.log('Model check failed: HTTP ' + res.status);
    console.log(raw.slice(0, 500));
    return false;
  }
  const info = JSON.parse(raw);
  console.log('Model reachable: ' + (info.name || opts.model));
  console.log('Input: ' + (info.inputTokenLimit || '?') + ' tokens, output: ' + (info.outputTokenLimit || '?') + ' tokens');
  console.log('Voices configured: en=' + voiceFor('en') + ', ar=' + voiceFor('ar'));
  console.log('ffmpeg available: ' + (hasFfmpeg() ? 'yes (MP3)' : 'no (WAV files will be kept)'));
  console.log('Free-tier note: this endpoint check makes no audio, so it costs nothing.');
  return true;
}

/* --------------------------------- planning ------------------------------- */
function plan() {
  const stories = readStories().filter(s => !opts.only || s.id.split('/')[0] === opts.only);
  const langs = opts.lang ? [opts.lang] : ['en', 'ar'];
  const todo = [], skip = [];
  for (const story of stories) {
    for (const lang of langs) {
      if (!LANGS[lang]) throw new Error('unknown language ' + lang);
      const text = story.texts[lang];
      if (!text) continue;
      const k = keyOf(story, lang);
      const hash = hashFor(lang, text);
      const clip = manifest.clips[k];
      const rel = clip && clip.file ? path.join(DIRS.audio, clip.file) : '';
      const present = rel && fs.existsSync(abs(rel));
      if (!opts.force && clip && clip.status === 'ok' && clip.hash === hash && present) {
        skip.push({ story, lang, clip });
      } else {
        todo.push({ story, lang, text, hash, key: k });
      }
    }
  }
  return { stories, todo, skip };
}

/* -------------------------------- generation ------------------------------ */
function backfillDurations() {
  let filled = 0;
  for (const clip of Object.values(manifest.clips)) {
    if (clip.status !== 'ok' || clip.duration || !clip.file) continue;
    const file = abs(path.join(DIRS.audio, clip.file));
    if (!fs.existsSync(file)) continue;
    const d = probeDuration(file);
    if (!d) continue;
    clip.duration = d;
    filled += 1;
  }
  if (filled) { writeJson(manifestFile, manifest); console.log('durations measured for ' + filled + ' existing clip(s)'); }
}

async function generate() {
  const { stories, todo, skip } = plan();
  const list = opts.sample ? todo.slice(0, 1).concat(todo.filter(t => t.lang === 'ar').slice(0, 1)) : todo;

  console.log('stories found: ' + stories.length + ' | to generate: ' + list.length + ' | skipped (already done): ' + skip.length);
  if (opts.dry) {
    list.forEach(t => console.log('  would generate ' + t.key + ' (' + t.text.length + ' chars) -> ' + fileOf(t.story, t.lang)));
    console.log('dry run: no API calls made.');
    return;
  }
  if (!list.length) { console.log('nothing to do.'); return; }
  if (!key()) {
    console.error('No API key. Set GEMINI_API_KEY or add it to .env — nothing was generated.');
    process.exitCode = 2;
    return;
  }

  const mp3 = hasFfmpeg();
  let requests = 0, chars = 0, made = 0;
  const failed = [];

  for (const item of list) {
    if (requests >= opts.maxRequests) { console.log('stopped: request budget of ' + opts.maxRequests + ' reached.'); break; }
    if (chars + item.text.length > opts.maxChars) { console.log('stopped: character budget of ' + opts.maxChars + ' reached.'); break; }

    const dir = abs(path.join(DIRS.audio, item.story.machine));
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, item.story.id.split('/')[1] + '-' + item.lang);
    const wavFile = base + '.wav';
    const mp3File = base + '.mp3';

    let ok = false, lastError = '', quotaOut = false;
    for (let attempt = 1; attempt <= LIMITS.attempts && !ok; attempt += 1) {
      if (requests) await sleep(opts.minInterval);
      try {
        requests += 1;
        chars += item.text.length;
        ledger.totals.requests += 1;
        ledger.totals.chars += item.text.length;
        const audio = await callTts(item.text, item.lang);
        fs.writeFileSync(wavFile, audio);
        const finalName = mp3 ? (toMp3(wavFile, mp3File) ? item.story.machine + '/' + path.basename(mp3File) : item.story.machine + '/' + path.basename(wavFile))
          : item.story.machine + '/' + path.basename(wavFile);
        if (!mp3 && fs.existsSync(mp3File)) fs.unlinkSync(mp3File);
        manifest.clips[item.key] = {
          id: item.key,
          machine: item.story.machine,
          machineName: item.story.machineName,
          world: item.story.world,
          slide: item.story.slide,
          lang: item.lang,
          model: opts.model,
          voice: voiceFor(item.lang),
          hash: item.hash,
          chars: item.text.length,
          file: finalName,
          status: 'ok',
          bytes: fs.statSync(abs(path.join(DIRS.audio, finalName))).size,
          duration: probeDuration(abs(path.join(DIRS.audio, finalName))),
          generatedAt: new Date().toISOString()
        };
        writeJson(manifestFile, manifest);
        writeJson(ledgerFile, ledger);
        made += 1;
        ok = true;
        console.log('ok   ' + item.key + ' -> ' + finalName);
      } catch (err) {
        lastError = err.message;
        console.log('fail ' + item.key + ' (attempt ' + attempt + '): ' + lastError);
        if (err.status === 429 || /quota|rate/i.test(lastError)) {
          // Free tier: back off quietly and let the next loop continue; a hard
          // stop happens when every attempt of a clip lands on a limit.
          if (attempt === LIMITS.attempts) quotaOut = true;
          await sleep(Math.min(90000, 15000 * attempt));
        }
      }
    }
    if (!ok) {
      failed.push({ key: item.key, error: lastError });
      manifest.clips[item.key] = Object.assign({}, manifest.clips[item.key], {
        id: item.key, machine: item.story.machine, lang: item.lang,
        hash: item.hash, status: 'failed', error: lastError, updatedAt: new Date().toISOString()
      });
      writeJson(manifestFile, manifest);
    }
    if (quotaOut) {
      console.log('stopped: the daily request quota is used up — resume in the next quota window.');
      break;
    }
  }

  manifest.model = opts.model;
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestFile, manifest);
  writeJson(ledgerFile, ledger);

  const done = Object.values(manifest.clips).filter(c => c.status === 'ok');
  console.log('');
  console.log('this run: ' + made + ' generated, ' + failed.length + ' failed, ' + skip.length + ' already done');
  console.log('requests this run: ' + requests + ' | characters: ' + chars);
  console.log('manifest now holds ' + done.length + ' clips (' +
    done.filter(c => c.lang === 'ar').length + ' ar, ' + done.filter(c => c.lang === 'en').length + ' en)');
  if (failed.length) {
    console.log('failed:');
    failed.forEach(f => console.log('  ' + f.key + ' — ' + f.error));
    process.exitCode = 1;
  }
}

/* ------------------------------ batched mode ------------------------------
   The free tier counts requests, not minutes of audio, and one response can
   carry ~11 minutes. So a whole group of slides goes out as one request, with
   explicit long pauses between them, and comes back cut at those pauses.
   A wrong-looking split is rejected instead of published. */
const BATCH = { pause: ' <long pause> <long pause> ', noise: '-38dB', minSilence: 0.45, tolerance: 0.3 };

function detectSilences(file) {
  const out = spawnSync(findFfmpeg(), ['-v', 'info', '-i', file,
    '-af', 'silencedetect=noise=' + BATCH.noise + ':d=' + BATCH.minSilence, '-f', 'null', '-'], { encoding: 'utf8' });
  const log = (out.stderr || '') + (out.stdout || '');
  const found = [];
  let start = null;
  for (const line of log.split('\n')) {
    const a = line.match(/silence_start: (-?[\d.]+)/);
    const b = line.match(/silence_end: ([\d.]+)/);
    if (a) start = Math.max(0, parseFloat(a[1]));
    if (b && start !== null && start !== undefined) { found.push({ start, end: parseFloat(b[1]) }); start = null; }
  }
  return found;
}

/** One pause per cut, in order, each as close as possible to where it should be. */
function pickCuts(silences, expected) {
  const need = expected.length;
  const cands = silences.map(x => ({ start: x.start, end: x.end, mid: (x.start + x.end) / 2 }))
    .sort((a, b) => a.mid - b.mid);
  if (cands.length < need) return null;
  const chosen = [];
  let cursor = 0;
  for (let i = 0; i < need; i += 1) {
    const remaining = need - i - 1;
    let best = -1;
    let bestCost = Infinity;
    for (let j = cursor; j < cands.length - remaining; j += 1) {
      const cost = Math.abs(cands[j].mid - expected[i]);
      if (cost < bestCost) { bestCost = cost; best = j; }
    }
    if (best < 0) return null;
    chosen.push(cands[best]);
    cursor = best + 1;
  }
  return chosen;
}

function splitAt(wavFile, cuts, total, tmpDir) {
  const bin = findFfmpeg();
  const bounds = [0, ...cuts.map(c => c.mid), total];
  const segments = [];
  for (let i = 0; i < cuts.length + 1; i += 1) {
    const file = path.join(tmpDir, 'seg-' + (i + 1) + '.mp3');
    const run = spawnSync(bin, ['-y', '-loglevel', 'error', '-ss', bounds[i].toFixed(3), '-to', bounds[i + 1].toFixed(3),
      '-i', wavFile, '-codec:a', 'libmp3lame', '-b:a', '96k', '-ar', '24000', '-ac', '1', file], { stdio: 'inherit' });
    if (run.status !== 0) return null;
    segments.push({ file, duration: probeDuration(file) });
  }
  return segments;
}

/** Whole machines of one language per request, up to opts.batch slides. */
function batchGroups(todo) {
  const byLang = {};
  for (const item of todo) (byLang[item.lang] = byLang[item.lang] || []).push(item);
  const groups = [];
  for (const lang of Object.keys(byLang)) {
    const order = [];
    const byMachine = new Map();
    for (const item of byLang[lang]) {
      const name = item.story.machine;
      if (!byMachine.has(name)) { byMachine.set(name, []); order.push(name); }
      byMachine.get(name).push(item);
    }
    let current = [];
    for (const machine of order) {
      const block = byMachine.get(machine);
      if (current.length && current.length + block.length > opts.batch) { groups.push({ lang, items: current }); current = []; }
      current = current.concat(block);
    }
    if (current.length) groups.push({ lang, items: current });
  }
  return groups;
}

async function generateBatched() {
  const { todo, skip } = plan();
  if (!todo.length) { console.log('nothing to do.'); return; }
  if (!key()) {
    console.error('No API key. Set GEMINI_API_KEY or add it to .env — nothing was generated.');
    process.exitCode = 2;
    return;
  }
  if (!hasFfmpeg()) { console.error('ffmpeg is required to split a batched request.'); process.exitCode = 2; return; }

  const groups = batchGroups(todo);
  console.log('batched mode: ' + todo.length + ' slides in ' + groups.length + ' request(s), up to ' + opts.batch + ' slides each');
  if (opts.dry) {
    groups.forEach(g => console.log('  ' + g.lang + ' ' + g.items.length + ' slides -> ' + g.items.map(i => i.key).join(', ')));
    console.log('dry run: no API calls made.');
    return;
  }

  const tmpDir = abs(path.join('.work', 'batch-tmp'));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  let requests = 0;
  let made = 0;
  const failed = [];

  for (const group of groups) {
    if (requests >= opts.maxRequests) { console.log('stopped: request budget of ' + opts.maxRequests + ' reached.'); break; }
    if (requests) await sleep(opts.minInterval);

    const text = group.items.map(i => i.text).join(BATCH.pause);
    const charTotal = group.items.reduce((sum, i) => sum + i.text.length, 0);
    console.log('group ' + (requests + 1) + ': ' + group.lang + ', ' + group.items.length + ' slides, ' + text.length + ' chars');

    let ok = false;
    let lastError = '';
    for (let attempt = 1; attempt <= LIMITS.attempts && !ok; attempt += 1) {
      try {
        requests += 1;
        ledger.totals.requests += 1;
        ledger.totals.chars += text.length;
        const audio = await callTts(text, group.lang);
        const wavFile = path.join(tmpDir, 'group.wav');
        fs.writeFileSync(wavFile, audio);
        const total = probeDuration(wavFile);
        if (!total) throw new Error('could not read the length of the returned audio');

        let acc = 0;
        const expected = group.items.slice(0, -1).map(i => { acc += i.text.length; return total * acc / charTotal; });
        const cuts = pickCuts(detectSilences(wavFile), expected);
        if (!cuts) throw new Error('no pauses to split on');
        const segments = splitAt(wavFile, cuts, total, tmpDir);
        if (!segments) throw new Error('ffmpeg could not cut the audio');

        // Reject a split that does not look like the text it came from.
        const off = [];
        segments.forEach((seg, k) => {
          const want = total * group.items[k].text.length / charTotal;
          if (!seg.duration || Math.abs(seg.duration - want) / want > BATCH.tolerance) off.push(k + 1);
        });
        if (off.length) throw new Error('split looks wrong for segment(s) ' + off.join(', '));

        group.items.forEach((item, k) => {
          const dir = abs(path.join(DIRS.audio, item.story.machine));
          fs.mkdirSync(dir, { recursive: true });
          const name = item.story.id.split('/')[1] + '-' + item.lang + '.mp3';
          const target = path.join(dir, name);
          fs.renameSync(segments[k].file, target);
          const rel = item.story.machine + '/' + name;
          manifest.clips[item.key] = {
            id: item.key,
            machine: item.story.machine,
            machineName: item.story.machineName,
            world: item.story.world,
            slide: item.story.slide,
            lang: item.lang,
            model: opts.model,
            voice: voiceFor(item.lang),
            hash: item.hash,
            chars: item.text.length,
            file: rel,
            status: 'ok',
            bytes: fs.statSync(target).size,
            duration: segments[k].duration,
            batched: group.items.length,
            generatedAt: new Date().toISOString()
          };
        });
        writeJson(manifestFile, manifest);
        writeJson(ledgerFile, ledger);
        made += group.items.length;
        ok = true;
        console.log('ok   ' + group.items.length + ' clips from ' + total.toFixed(1) + 's of audio: ' + group.items.map(i => i.key).join(', '));
      } catch (err) {
        lastError = err.message;
        console.log('fail group (attempt ' + attempt + '): ' + lastError);
        if (err.status === 429 || /quota|rate/i.test(lastError)) await sleep(Math.min(90000, 15000 * attempt));
      }
    }
    if (!ok) failed.push({ keys: group.items.map(i => i.key), error: lastError });
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  manifest.model = opts.model;
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestFile, manifest);
  writeJson(ledgerFile, ledger);

  const done = Object.values(manifest.clips).filter(c => c.status === 'ok');
  console.log('');
  console.log('this run: ' + made + ' clips from ' + requests + ' request(s), ' + failed.length + ' group(s) failed');
  console.log('manifest now holds ' + done.length + ' clips (' +
    done.filter(c => c.lang === 'ar').length + ' ar, ' + done.filter(c => c.lang === 'en').length + ' en)');
  if (failed.length) {
    console.log('failed groups:');
    failed.forEach(f => console.log('  ' + f.keys.join(', ') + ' — ' + f.error));
    process.exitCode = 1;
  }
}

function status() {
  const stories = readStories();
  const clips = Object.values(manifest.clips || {});
  const ok = clips.filter(c => c.status === 'ok');
  const per = lang => ok.filter(c => c.lang === lang).length;
  const missing = [];
  for (const s of stories) for (const lang of ['en', 'ar']) {
    const c = manifest.clips[s.id + '-' + lang];
    if (!c || c.status !== 'ok') missing.push(s.id + '-' + lang);
  }
  console.log('model: ' + (manifest.model || MODEL));
  console.log('stories: ' + stories.length + ' (needs ' + stories.length * 2 + ' clips)');
  console.log('generated: ' + ok.length + ' (' + per('en') + ' en, ' + per('ar') + ' ar)');
  console.log('missing: ' + missing.length + (missing.length ? '\n  ' + missing.slice(0, 12).join('\n  ') : ''));
  console.log('api requests so far: ' + ledger.totals.requests + ' (' + ledger.totals.chars + ' characters)');
}

/* ----------------------------------- main --------------------------------- */
loadEnv();
backfillDurations();
if (opts.check) {
  checkAccess().then(ok => { if (!ok) process.exitCode = 1; });
} else if (opts.status) {
  status();
} else if (opts.batch) {
  generateBatched().catch(err => { console.error(err.message); process.exitCode = 1; });
} else {
  generate().catch(err => { console.error(err.message); process.exitCode = 1; });
}
