import { Directory, File, Paths } from 'expo-file-system';
import { EnglishVariety } from '../types';
import { accessToken, isSupabaseConfigured } from './auth';

export type ModelVoicePace = 'phrase' | 'word';

const assessmentApiUrl = process.env.EXPO_PUBLIC_ASSESSMENT_API_URL?.replace(/\/$/, '');
// After a failure (gateway without a voice key, offline, provider outage), use
// device voices for a while instead of waiting on the network for every tap.
const FAILURE_BACKOFF_MS = 60_000;
let unavailableUntil = 0;

/** The gateway requires a signed-in user, so both services must be configured. */
export function isModelVoiceAvailable(): boolean {
  return Boolean(assessmentApiUrl && isSupabaseConfigured) && Date.now() >= unavailableUntil;
}

/**
 * Downloads (or reuses) a model pronunciation clip and returns its local URI.
 * Clips contain only exercise script text, never learner recordings, so they
 * live in the OS cache like any other downloaded media.
 */
export async function fetchModelVoice(text: string, variety: EnglishVariety, pace: ModelVoicePace): Promise<string> {
  if (!assessmentApiUrl) throw new Error('Model voice is not configured.');
  const token = await accessToken();
  if (!token) throw new Error('Sign in to use the model voice.');

  const directory = new Directory(Paths.cache, 'model-voice');
  if (!directory.exists) directory.create({ intermediates: true });
  const target = new File(directory, `${cacheName(`${variety}|${pace}|${text}`)}.mp3`);
  if (target.exists && target.size > 0) return target.uri;

  const url = `${assessmentApiUrl}/v1/speech?${new URLSearchParams({ text, variety, pace }).toString()}`;
  try {
    const file = await File.downloadFileAsync(url, target, { headers: { Authorization: `Bearer ${token}` }, idempotent: true });
    return file.uri;
  } catch (error) {
    unavailableUntil = Date.now() + FAILURE_BACKOFF_MS;
    // Android can leave a partial file behind when a download fails midway.
    try {
      if (target.exists) target.delete();
    } catch {
      // Nothing useful to do; the next attempt overwrites it.
    }
    throw error;
  }
}

/** Stable filename from two FNV-1a hashes; collisions are negligible for a few hundred phrases. */
function cacheName(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995) ^ (b >>> 15);
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}${value.length.toString(16)}`;
}
