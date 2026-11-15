# Solvix voice-over generation

The site plays recorded narration from `assets/audio/`. The files are produced
here, once, with the Gemini TTS API; the website never talks to Gemini.

## Setup

```bash
# 1. put the key in the project .env (never in any public folder)
GEMINI_API_KEY=your-key

# 2. is the key good and the model reachable? (no audio, no cost)
node scripts/voiceover/generate.mjs --check

# 3. what is already done?
node scripts/voiceover/generate.mjs --status
```

## Generating

```bash
node scripts/voiceover/generate.mjs --sample          # one Arabic + one English clip
node scripts/voiceover/generate.mjs --dry-run         # what is still missing
node scripts/voiceover/generate.mjs                   # everything missing, both languages
node scripts/voiceover/generate.mjs --lang=ar         # one language only
node scripts/voiceover/generate.mjs --only=viking     # one machine
node scripts/voiceover/generate.mjs --force           # regenerate anyway
```

Progress is saved after every clip, so stopping the script (or a 429) never
loses finished work: run it again and it continues where it stopped.

## What it writes

```
assets/audio/manifest.json          the index the site reads
assets/audio/<machine>/01-en.mp3    one clip per story slide, per language
```

Each manifest entry holds the story id, language, source-text hash, model,
voice, file name, status and size. A clip is skipped when its hash still matches,
so editing one Arabic slide regenerates only that Arabic file.

`ffmpeg` is used for MP3 when it is installed; otherwise the WAV that Gemini
returns is kept (browsers play both). Adding ffmpeg later and re-running with
`--force` converts the library.

## Cost and limits

- `--max-requests` (default 120) and `--max-chars` (default 60 000) are hard
  stops for one run; both are also logged in `scripts/voiceover/.state/ledger.json`.
- `--min-interval` (default 4200 ms) keeps the run inside free-tier
  requests-per-minute limits.
- A `429` is retried with backoff; if a clip still fails it is marked `failed`
  and the next run picks it up.
- Nothing here enables billing or asks for a payment method.

## Adding stories

Add the slides to `solvix.html` as usual (a `<figure data-m="N">` with a
`<figcaption>`, plus its entry in the `AR` array). The extractor finds them
automatically, and `--dry-run` shows the new clips.

## Batched requests (free-tier saver)

The free tier counts **requests per day**, not minutes of audio, and one response
can carry about eleven minutes. `--batch=N` sends whole machines of one language
as a single request, separated by `<long pause>` tags, then cuts the audio back at
those pauses:

```
node scripts/voiceover/generate.mjs --batch=8 --lang=ar --max-requests=4
```

- Groups never mix languages and never split a machine unless the group is full.
- A split is rejected (and the group retried) when any segment is more than 30%
  off its expected share of the text, or when the pauses cannot be found.
- Requires ffmpeg (silence detection + cutting).
- `--max-requests` still caps the real API calls, including retries.

Batched clips keep half a pause at each end; `.work/trim-batched.mjs` trims that
and re-measures the durations, so the page's typing sync stays exact.
