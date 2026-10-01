type EventName =
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'practice_started'
  | 'practice_analyzed'
  | 'practice_completed'
  | 'paywall_viewed'
  | 'privacy_viewed';

const analyticsEndpoint = process.env.EXPO_PUBLIC_ANALYTICS_API_URL?.replace(/\/$/, '');

export function track(event: EventName, properties: Record<string, string | number | boolean> = {}): void {
  // Events contain product interactions only—never transcripts, recordings,
  // email addresses, or speech scores.
  if (__DEV__) console.info(`[analytics] ${event}`, properties);
  if (!analyticsEndpoint) return;
  void fetch(analyticsEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, properties, occurredAt: new Date().toISOString() }),
  }).catch(() => undefined);
}
