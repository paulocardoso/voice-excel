export type EnglishVariety = 'en-US' | 'en-GB';
export type LearningGoal = 'meetings' | 'interviews';
export type ExerciseMode = 'scripted' | 'roleplay';
export type Plan = 'free' | 'pro';

export interface Exercise {
  id: string;
  targetVariety: EnglishVariety;
  scenario: string;
  category: 'meetings' | 'interviews';
  title: string;
  description: string;
  mode: ExerciseMode;
  prompt: string;
  referenceText?: string;
  coachTip: string;
  estimatedMinutes: number;
  order: number;
}

export interface ScoreBreakdown {
  overall: number;
  clarity: number;
  fluency: number;
  prosody: number | null;
}

export interface WordFeedback {
  word: string;
  score: number;
  issue: 'pronunciation' | 'pace' | 'stress' | 'pause';
  hint: string;
  phonemes?: PhonemeFeedback[];
}

export interface PhonemeFeedback {
  /** The target IPA sound in the selected pronunciation variety. */
  expected: string;
  /** The most likely sound detected, when the assessment provider supports it. */
  heard?: string;
  score: number;
}

export interface SpeechAssessment {
  id: string;
  createdAt: string;
  transcript: string;
  score: ScoreBreakdown;
  flaggedWords: WordFeedback[];
  coachingTip: string;
  nextDrill: string;
  isDemo: boolean;
  audioRetained: false;
}

export interface PracticeResult {
  exerciseId: string;
  completedAt: string;
  assessment: SpeechAssessment;
}

export interface UserProfile {
  displayName: string;
  targetVariety: EnglishVariety;
  goals: LearningGoal[];
  baseline?: SpeechAssessment;
  completedOnboarding: boolean;
  practiceResults: PracticeResult[];
  plan: Plan;
  freePracticeDate?: string;
  freePracticesToday: number;
  hasSeenPrivacyNotice: boolean;
}

export interface AppState {
  version: 1;
  profile?: UserProfile;
}

export interface AssessmentRequest {
  audioUri?: string;
  targetVariety: EnglishVariety;
  exercise: Pick<Exercise, 'id' | 'mode' | 'referenceText' | 'prompt' | 'title'>;
}

export const varietyMeta: Record<EnglishVariety, { label: string; locale: string; shortLabel: string }> = {
  'en-US': { label: 'American English', locale: 'en-US', shortLabel: 'US' },
  'en-GB': { label: 'British English', locale: 'en-GB', shortLabel: 'UK' },
};
