// Model-voice (text-to-speech) helpers. Only scripted exercise text and single
// words reach this module; the mobile app keeps learner transcripts on the
// device voice.

export const MAX_SPEECH_TEXT_LENGTH = 400;

// ElevenLabs `voice_settings.speed`: 1.0 is normal, lower is slower. Learners
// imitate the model, so phrases are slightly slowed and single words more so.
export const PACE_SPEED = { phrase: 0.92, word: 0.85 };

export function parseSpeechRequest(query) {
  const text = String(query.text ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  const variety = query.variety;
  const pace = query.pace ?? 'phrase';
  if (!text) return { error: 'Text to speak is required.' };
  if (text.length > MAX_SPEECH_TEXT_LENGTH) return { error: 'Text to speak is too long.' };
  if (!['en-US', 'en-GB'].includes(variety)) return { error: 'Unsupported English target.' };
  if (!Object.hasOwn(PACE_SPEED, pace)) return { error: 'Unsupported pace.' };
  return { text, variety, pace };
}

export function speechCacheKey({ text, variety, pace }, voiceId, modelId) {
  return [modelId, voiceId, variety, pace, text].join('\u0001');
}

/** Small LRU bounded by entry count and total bytes; exercise scripts repeat across learners. */
export class AudioCache {
  constructor({ maxEntries = 300, maxBytes = 32 * 1024 * 1024 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.entries = new Map();
  }

  get(key) {
    const value = this.entries.get(key);
    if (!value) return undefined;
    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key, buffer) {
    if (buffer.length > this.maxBytes) return;
    const existing = this.entries.get(key);
    if (existing) {
      this.bytes -= existing.length;
      this.entries.delete(key);
    }
    this.entries.set(key, buffer);
    this.bytes += buffer.length;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const [oldestKey, oldest] = this.entries.entries().next().value;
      this.entries.delete(oldestKey);
      this.bytes -= oldest.length;
    }
  }
}
