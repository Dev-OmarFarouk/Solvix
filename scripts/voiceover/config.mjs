/**
 * Voice-over settings. Everything the generator sends to Gemini lives here so a
 * changed voice or style also invalidates the cached audio (the hash includes
 * these values).
 */
export const MODEL = 'gemini-3.8-flash-tts';
export const API = 'https://generativelanguage.googleapis.com/v1beta';

/** One narrator identity per language, used for every story. */
export const LANGS = {
  en: {
    label: 'English',
    voice: 'Kore',
    style: 'warm, clear storyteller for an educational space museum; unhurried and confident, friendly and precise on names and dates'
  },
  ar: {
    label: 'Arabic',
    voice: 'Kore',
    style: 'Modern Standard Arabic narration for an educational space museum; warm, clear and unhurried, precise pronunciation of names and numbers'
  }
};

/** Free-tier safety rails. The generator refuses to cross these. */
export const LIMITS = {
  /** Requests allowed in one run unless --max-requests says otherwise. */
  maxRequests: 120,
  /** Characters of text allowed in one run. */
  maxChars: 60000,
  /** Minimum gap between calls, in ms (free tier is per-minute limited too). */
  minInterval: 4200,
  /** Attempts per clip before it is marked failed and left for the next run. */
  attempts: 3
};

export const DIRS = {
  audio: 'assets/audio',
  manifest: 'assets/audio/manifest.json',
  state: 'scripts/voiceover/.state/ledger.json'
};
