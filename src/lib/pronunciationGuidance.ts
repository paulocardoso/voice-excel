/**
 * Small, provider-neutral coaching cues for IPA sounds returned by a live
 * pronunciation assessment. These are deliberately short: the learner should
 * be able to listen, make one physical adjustment, and try the word again.
 */
const placementTips: Record<string, string> = {
  'θ': 'Rest the tongue tip lightly between your teeth and let air flow out.',
  'ð': 'Rest the tongue tip lightly between your teeth, then add a gentle voice.',
  'ɹ': 'Keep your tongue off the roof of your mouth and draw it slightly back.',
  r: 'Keep your tongue off the roof of your mouth and draw it slightly back.',
  l: 'Touch the tongue tip just behind your upper front teeth, then release.',
  v: 'Touch your top teeth to your lower lip and keep your voice on.',
  w: 'Round your lips first, then glide quickly into the next vowel.',
  f: 'Touch your top teeth to your lower lip and let air pass without voice.',
  'ʃ': 'Round your lips a little and send a steady stream of air over the tongue.',
  'ʒ': 'Use the same shape as “sh”, but add a gentle voice.',
  'tʃ': 'Start with a short “t”, then release into “sh”.',
  'dʒ': 'Start with a short “d”, then release into the sound in “job”.',
  'ŋ': 'Keep the back of your tongue up and finish through your nose, not with a hard “g”.',
  'ɪ': 'Keep the vowel short and relaxed, with your jaw only slightly open.',
  i: 'Lift your tongue high and forward, then hold the vowel a little longer.',
  'iː': 'Lift your tongue high and forward, then hold the vowel a little longer.',
  'ɛ': 'Open your jaw a little and keep the tongue toward the front of your mouth.',
  'æ': 'Open your jaw wider and keep the tongue toward the front of your mouth.',
  'ʌ': 'Keep your jaw and tongue relaxed; make this vowel short.',
  'ə': 'Use a very short, relaxed vowel instead of a full stressed vowel.',
  'ɑ': 'Open your jaw and keep the tongue low and back.',
  'ɔ': 'Round your lips slightly and keep the tongue farther back.',
  'ʊ': 'Round your lips a little, but keep the vowel short.',
  u: 'Round your lips and lift the back of your tongue; hold the vowel slightly longer.',
  'uː': 'Round your lips and lift the back of your tongue; hold the vowel slightly longer.',
};

export function formatIpaSound(phoneme: string): string {
  return `/${phoneme}/`;
}

export function soundPlacementTip(phoneme: string): string {
  const normalized = phoneme.replace(/[ˈˌ.]/g, '');
  return placementTips[normalized] ?? 'Listen once, make the sound slowly on its own, then reconnect it to the word.';
}
