import { Plan, UserProfile } from '../types';

export const FREE_DAILY_PRACTICE_LIMIT = 1;

export function dateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function normalizedFreeUsage(profile: UserProfile, today = dateKey()): number {
  return profile.freePracticeDate === today ? profile.freePracticesToday : 0;
}

export function canStartPractice(profile: UserProfile, today = dateKey()): boolean {
  return profile.plan === 'pro' || normalizedFreeUsage(profile, today) < FREE_DAILY_PRACTICE_LIMIT;
}

export function recordCompletedPractice(profile: UserProfile, today = dateKey()): UserProfile {
  if (profile.plan === 'pro') return profile;
  const current = normalizedFreeUsage(profile, today);
  return { ...profile, freePracticeDate: today, freePracticesToday: current + 1 };
}

export function applyPreviewPlan(profile: UserProfile, plan: Plan = 'pro'): UserProfile {
  return { ...profile, plan };
}
