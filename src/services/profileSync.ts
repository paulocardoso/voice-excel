import { UserProfile } from '../types';
import { supabase } from './auth';

/**
 * Keeps non-audio learning preferences available across devices. Assessment
 * results themselves are written by the authenticated speech gateway, so the
 * client never needs service-role credentials.
 */
export async function syncProfile(profile: UserProfile): Promise<void> {
  if (!supabase) return;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;

  const { error } = await supabase.from('profiles').upsert(
    {
      id: userData.user.id,
      target_variety: profile.targetVariety,
      goals: profile.goals,
      baseline: profile.baseline ?? null,
      privacy_notice_seen_at: profile.hasSeenPrivacyNotice ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error && __DEV__) console.warn('[profile-sync]', error.message);
}
