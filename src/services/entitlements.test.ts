import { canStartPractice, FREE_DAILY_PRACTICE_LIMIT, normalizedFreeUsage, recordCompletedPractice } from './entitlements';
import { UserProfile } from '../types';

const profile: UserProfile = {
  displayName: 'Test',
  targetVariety: 'en-US',
  goals: ['meetings'],
  completedOnboarding: true,
  practiceResults: [],
  plan: 'free',
  freePracticesToday: 0,
  hasSeenPrivacyNotice: true,
};

describe('free practice entitlements', () => {
  it('allows one completed free practice each day', () => {
    const today = '2026-10-01';
    expect(canStartPractice(profile, today)).toBe(true);

    const used = recordCompletedPractice(profile, today);
    expect(used.freePracticesToday).toBe(FREE_DAILY_PRACTICE_LIMIT);
    expect(normalizedFreeUsage(used, today)).toBe(FREE_DAILY_PRACTICE_LIMIT);
    expect(canStartPractice(used, today)).toBe(false);
  });

  it('resets the daily count on a new day and never limits pro users', () => {
    const yesterdayUsed = { ...profile, freePracticeDate: '2026-09-30', freePracticesToday: 1 };
    expect(normalizedFreeUsage(yesterdayUsed, '2026-10-01')).toBe(0);
    expect(canStartPractice(yesterdayUsed, '2026-10-01')).toBe(true);
    expect(canStartPractice({ ...yesterdayUsed, plan: 'pro' }, '2026-09-30')).toBe(true);
  });
});
