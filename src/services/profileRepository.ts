import { PracticeResult, SpeechAssessment, UserProfile } from '../types';
import { supabase } from './auth';

type ProfileRow = {
  target_variety: UserProfile['targetVariety'];
  goals: UserProfile['goals'];
  plan: UserProfile['plan'];
  baseline: SpeechAssessment | null;
  privacy_notice_seen_at: string | null;
};

type ResultRow = {
  id: string;
  exercise_id: string;
  created_at: string;
  transcript: string;
  scores: SpeechAssessment['score'];
  flagged_words: SpeechAssessment['flaggedWords'];
  coaching_tip: string;
  next_drill: string;
};

/** Fetches the server-owned learning record for a newly installed device. */
export async function loadRemoteProfile(): Promise<UserProfile | undefined> {
  if (!supabase) return undefined;
  const { data: row, error } = await supabase.from('profiles').select('target_variety, goals, plan, baseline, privacy_notice_seen_at').maybeSingle<ProfileRow>();
  if (error || !row) return undefined;
  const { data: results, error: resultsError } = await supabase
    .from('assessment_results')
    .select('id, exercise_id, created_at, transcript, scores, flagged_words, coaching_tip, next_drill')
    .order('created_at', { ascending: true })
    .returns<ResultRow[]>();
  if (resultsError) return undefined;

  const practiceResults: PracticeResult[] = (results ?? []).map((result) => ({
    exerciseId: result.exercise_id,
    completedAt: result.created_at,
    assessment: {
      id: result.id,
      createdAt: result.created_at,
      transcript: result.transcript,
      score: result.scores,
      flaggedWords: result.flagged_words,
      coachingTip: result.coaching_tip,
      nextDrill: result.next_drill,
      isDemo: false,
      audioRetained: false,
    },
  }));
  const today = new Date().toISOString().slice(0, 10);
  const freePracticesToday = row.plan === 'free' ? practiceResults.filter((result) => result.completedAt.slice(0, 10) === today).length : 0;

  return {
    displayName: 'You',
    targetVariety: row.target_variety,
    goals: row.goals,
    plan: row.plan,
    baseline: row.baseline ?? undefined,
    completedOnboarding: true,
    practiceResults,
    freePracticeDate: freePracticesToday ? today : undefined,
    freePracticesToday,
    hasSeenPrivacyNotice: Boolean(row.privacy_notice_seen_at),
  };
}
