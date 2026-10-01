import { AssessmentRequest, SpeechAssessment, WordFeedback } from '../types';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { accessToken } from './auth';

const assessmentApiUrl = process.env.EXPO_PUBLIC_ASSESSMENT_API_URL?.replace(/\/$/, '');

export class AssessmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentError';
  }
}

export function isDemoAssessmentMode(): boolean {
  return !assessmentApiUrl;
}

export async function assessRecording(
  request: AssessmentRequest,
  options: { retainLocalRecording?: boolean } = {},
): Promise<SpeechAssessment> {
  let completed = false;
  try {
    if (!assessmentApiUrl) {
      const assessment = await createDemoAssessment(request);
      completed = true;
      return assessment;
    }
    if (!request.audioUri) throw new AssessmentError('No recording was available. Please record your answer again.');

    const formData = new FormData();
    formData.append('targetVariety', request.targetVariety);
    formData.append('exerciseId', request.exercise.id);
    formData.append('mode', request.exercise.mode);
    if (request.exercise.referenceText) formData.append('referenceText', request.exercise.referenceText);
    // Expo's fetch only accepts Blob-like parts; React Native's legacy
    // `{ uri, name, type }` objects throw "Unsupported FormDataPart implementation".
    formData.append('audio', new File(request.audioUri), 'attempt.m4a');

    let response: Response;
    try {
      const token = await accessToken();
      response = await fetch(`${assessmentApiUrl}/v1/assessments`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          // Contractually instructs the API to process audio transiently only.
          'X-WorkVoice-Audio-Retention': 'delete-after-analysis',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });
    } catch (issue) {
      if (__DEV__) console.warn(`[assessment] Request to ${assessmentApiUrl}/v1/assessments failed on ${Platform.OS}: ${issue instanceof Error ? issue.message : String(issue)} (recording ${request.audioUri})`);
      throw new AssessmentError('We could not reach speech analysis. Check your connection and try again.');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
      throw new AssessmentError(body?.error ?? 'Speech analysis was unavailable. Your recording was not saved. Please try again.');
    }

    const assessment = (await response.json()) as SpeechAssessment;
    if (!isValidAssessment(assessment)) {
      throw new AssessmentError('Speech analysis returned an invalid result. Please try again.');
    }
    completed = true;
    return { ...assessment, audioRetained: false, isDemo: false };
  } finally {
    // A completed practice attempt may remain in the app cache only while the
    // learner compares it with the model pronunciation. It is never persisted
    // into app state, Supabase, or object storage.
    if (!options.retainLocalRecording || !completed) discardLocalRecording(request.audioUri);
  }
}

export function discardLocalRecording(uri?: string): void {
  if (!uri?.startsWith('file:')) return;
  try {
    new File(uri).delete();
  } catch {
    // The OS cache may already have deleted the file; either outcome preserves
    // the no-recording-history guarantee.
  }
}

function isValidAssessment(value: SpeechAssessment): boolean {
  return Boolean(
    value &&
      typeof value.transcript === 'string' &&
      typeof value.score?.overall === 'number' &&
      typeof value.score?.clarity === 'number' &&
      typeof value.score?.fluency === 'number' &&
      Array.isArray(value.flaggedWords),
  );
}

async function createDemoAssessment(request: AssessmentRequest): Promise<SpeechAssessment> {
  await new Promise<void>((resolve) => setTimeout(resolve, 850));
  const seed = stableNumber(`${request.exercise.id}-${request.targetVariety}`);
  const clarity = 69 + (seed % 17);
  const fluency = 68 + ((seed * 7) % 18);
  const prosody = request.targetVariety === 'en-US' ? 66 + ((seed * 11) % 20) : null;
  const overall = Math.round((clarity * 0.55 + fluency * 0.3 + (prosody ?? fluency) * 0.15) * 10) / 10;
  const transcript =
    request.exercise.referenceText ??
    'I am ready to share a clear, confident update and agree the next steps with my team.';
  const candidates = transcript
    .replace(/[^a-zA-Z ]/g, '')
    .split(' ')
    .filter((word) => word.length > 4);
  const first = candidates[(seed + 1) % candidates.length] ?? 'clear';
  const second = candidates[(seed + 4) % candidates.length] ?? 'steps';
  const flaggedWords: WordFeedback[] = [
    {
      word: first,
      score: Math.max(54, clarity - 17),
      issue: 'pronunciation',
      hint: `Slow down slightly on “${first}” and finish the final consonant.` ,
    },
    {
      word: second,
      score: Math.max(58, fluency - 10),
      issue: request.targetVariety === 'en-US' ? 'stress' : 'pace',
      hint:
        request.targetVariety === 'en-US'
          ? `Give the stressed syllable in “${second}” a little more length.`
          : `Leave a small pause before “${second}” so the idea lands clearly.`,
    },
  ];

  return {
    id: `demo-${Date.now()}`,
    createdAt: new Date().toISOString(),
    transcript,
    score: { overall, clarity, fluency, prosody },
    flaggedWords,
    coachingTip:
      request.targetVariety === 'en-US'
        ? 'Your message is easy to follow. On the retry, slow the key words and let your pitch fall at the end of each statement.'
        : 'Your message is easy to follow. On the retry, keep a steady pace and leave a brief pause between your main ideas.',
    nextDrill: `Repeat “${first}” three times, then say the full sentence once at a slower pace.`,
    isDemo: true,
    audioRetained: false,
  };
}

function stableNumber(value: string): number {
  return [...value].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7);
}
