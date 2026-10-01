import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthError, createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

/**
 * Development-only sign-in bypass. With EXPO_PUBLIC_DEV_AUTH_BYPASS=anonymous,
 * a development build signs in with a Supabase anonymous account instead of an
 * email link, so the gateway and database still receive a real user token.
 * Ignored in release builds (`__DEV__` is false there). Requires
 * Authentication → Sign In / Providers → "Allow anonymous sign-ins" in Supabase.
 */
export const devAuthBypassEnabled = isSupabaseConfigured && process.env.EXPO_PUBLIC_DEV_AUTH_BYPASS === 'anonymous';

export const supabase: SupabaseClient | undefined = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        // PKCE makes the email link return `?code=…`, which the app exchanges
        // for a session below. The default implicit flow returns tokens in the
        // URL fragment instead, which this app does not read.
        flowType: 'pkce',
      },
    })
  : undefined;

export async function restoreSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Where the email link returns to: `workvoice://auth/callback` in installed
 * builds, `exp://<dev-server>/--/auth/callback` in Expo Go. Every value used
 * must be listed under Supabase → Authentication → URL Configuration.
 */
export function authRedirectUrl(): string {
  return Linking.createURL('auth/callback');
}

export async function signInAnonymously(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}

export async function sendMagicLink(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase authentication is not configured.');
  const redirectTo = authRedirectUrl();
  if (__DEV__) console.log(`[auth] Sign-in links return to ${redirectTo}; allow it in Supabase URL Configuration.`);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

/** A learner-facing explanation for a failed sign-in link request. */
export function signInErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit' || error.status === 429) {
      return 'Too many sign-in emails were requested. Wait a minute, then try again.';
    }
    if (error.code === 'email_address_invalid') return 'That email address can’t receive sign-in links. Check it and try again.';
    if (error.code === 'email_address_not_authorized') return 'This email address isn’t allowed to sign in yet.';
    if (error.code === 'email_provider_disabled' || error.code === 'otp_disabled' || error.code === 'signup_disabled') {
      return 'Email sign-in is turned off for WorkVoice right now.';
    }
  }
  return 'We could not send your sign-in link. Check your connection and try again.';
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function accessToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

export function subscribeToMagicLinks(onSession: (session: Session) => void): () => void {
  const client = supabase;
  if (!client) return () => undefined;
  const handled = new Set<string>();
  const handleUrl = async (url: string | null) => {
    const match = url?.match(/[?&]code=([^&#]+)/);
    const code = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    // A code can only be exchanged once; the initial URL and the event can both deliver it.
    if (!code || handled.has(code)) return;
    handled.add(code);
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error && __DEV__) console.warn(`[auth] Could not complete sign-in: ${error.message}`);
    if (data.session) onSession(data.session);
  };
  // The link may have launched the app from closed, not just arrived while open.
  void Linking.getInitialURL().then(handleUrl);
  const subscription = Linking.addEventListener('url', ({ url }) => void handleUrl(url));
  return () => subscription.remove();
}
