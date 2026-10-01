# AGENTS.md — WorkVoice

Working notes for anyone (human or coding agent) picking up this project. Keep this file current when you change architecture, configuration, or project status. Never put keys, tokens, passwords, or personal data in it.

_Last updated: 2026-10-01_

## What this is

WorkVoice is a workplace-English speaking coach. Learners read scripted phrases or answer role-play prompts, get pronunciation, fluency, and (US only) rhythm/intonation feedback, and compare their recording with a model voice.

| Part | Location | Stack |
|---|---|---|
| Mobile app | repo root (`App.tsx`, `src/`) | Expo SDK 57, React Native 0.86, React 19, TypeScript |
| Speech gateway | `services/speech-gateway/` | Node 22, Express 5, multer, ffmpeg, Azure Speech REST API, optional ElevenLabs TTS |
| Database and auth | `supabase/migrations/` | Supabase Postgres with row-level security, Supabase Auth |

### App layout

- `App.tsx`: all screens (sign-in, onboarding, home, practice catalog, session, result, progress, profile, paywall) and the tab bar.
- `src/components/ui.tsx`: design tokens (`colors`, `iconSize`), shared primitives (`AppScreen`, `Card`, `PrimaryButton`, `SecondaryButton`, `TextLink`, `Pill`, `Icon`), and the `useLiquidGlass()` hook.
- `src/components/`: `RecordingPanel`, `ScoreDisplay`, `PronunciationComparison`.
- `src/services/`: `auth` (Supabase), `speechAssessment` (gateway upload plus demo mode), `modelVoice` (TTS download and cache), `entitlements`, `billing` (RevenueCat), `profileSync`, `account`.
- `src/lib/useModelVoice.ts`: plays model pronunciations, using the gateway voice when allowed and the device voice (`expo-speech`) otherwise.
- `src/data/curriculum.ts`: 30 exercises per variety (`en-US`, `en-GB`), with ids like `en-US-2-2`.

### Gateway endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /healthz` | none | Liveness |
| `POST /v1/assessments` | Supabase bearer token | Multipart `audio` plus `targetVariety`, `mode`, `exerciseId`, `referenceText`. Converts audio to 16 kHz WAV with ffmpeg, calls Azure, saves derived results only. |
| `GET /v1/speech?text&variety&pace` | Supabase bearer token | ElevenLabs MP3 for model pronunciation. Returns 503 when not configured. Uses an in-memory LRU cache. |
| `DELETE /v1/account` | Supabase bearer token | Deletes the auth user; cascades delete profile and results. |
| `POST /v1/billing/webhook` | `Authorization: Bearer <REVENUECAT_WEBHOOK_AUTHORIZATION>` | RevenueCat is the only thing allowed to set `plan`. |

## Commands

```sh
# App
npm run typecheck
npm test -- --runInBand
EXPO_NO_TELEMETRY=1 CI=1 npx expo export --platform ios   # bundle check (also: android)
npx expo start -c                                          # -c is needed after .env changes

# Gateway (run from services/speech-gateway)
npm test            # node --test assessment.test.mjs voice.test.mjs
npm run dev         # local run, loads .env (needs ffmpeg installed locally)
npm start           # production entry; the host provides environment variables

# Deploy the gateway (from services/speech-gateway): rebuilds from the Dockerfile and keeps settings and secrets
az containerapp up -n workvoice-gateway -g workvoice -l westeurope --source . --ingress external --target-port 8787
az containerapp logs show -n workvoice-gateway -g workvoice --follow
```

Before handing work back, run the typecheck, both test suites, and an iOS export bundle.

## Configuration

Settings are read from `.env` files, which are git- and docker-ignored. `.env.example` files document every variable.

**App (`/.env`)**: `EXPO_PUBLIC_ASSESSMENT_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_REVENUECAT_*`, `EXPO_PUBLIC_ANALYTICS_API_URL`, `EXPO_PUBLIC_DEV_AUTH_BYPASS`. Only `EXPO_PUBLIC_*` values are bundled into the app, so never put server secrets here. `/.env.backup` holds the earlier placeholder file.

**Gateway (`services/speech-gateway/.env` locally; Azure Container Apps settings in production)**:
- Required: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_RESOURCE_NAME`.
- `AZURE_SPEECH_REGION`: required for our resource, because it has no custom domain, so the gateway must use `https://<region>.stt.speech.microsoft.com`.
- Optional: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_US`, `ELEVENLABS_VOICE_ID_GB`, `ELEVENLABS_MODEL_ID` (default `eleven_multilingual_v2`), `REVENUECAT_WEBHOOK_AUTHORIZATION`, `REVENUECAT_PRO_ENTITLEMENT_ID`, `ALLOWED_ORIGINS` (web only).
- In Azure, keys are stored as Container App secrets and referenced with `secretref:`. Never print secret values in logs, terminals, or chat. Validate keys by HTTP status only.

**Development sign-in bypass**: `EXPO_PUBLIC_DEV_AUTH_BYPASS=anonymous` makes development builds sign in with a Supabase anonymous account instead of an email link. It is ignored when `__DEV__` is false. It requires Supabase → Authentication → Sign In / Providers → "Allow anonymous sign-ins". Sign out is hidden for anonymous users.

## Product and design rules (don't regress these)

- **Privacy**:
  - Raw audio is never persisted. The app keeps the recording in cache only while the result screen is open. The gateway holds it in RAM and zero-fills its buffers.
  - Supabase stores derived results only.
  - Only scripted exercise text and single words go to ElevenLabs; role-play uses the device voice, because its model text is the learner's own transcript. Gate remote voice on `exercise.mode === 'scripted'`.
- **Free plan**: one scored practice per UTC day, enforced by the gateway (HTTP 402). The baseline doesn't count. `plan` can only change through the RevenueCat webhook or the service role; a database trigger blocks the `authenticated` role.
- **UI**:
  - Use `colors` tokens. The text-on-tint colors (`tealText`, `amberText`, `roseText`) were chosen to meet 4.5:1 contrast. Body text is 13–16px, never below 12px.
  - Touch targets are at least 44pt (use `TextLink` for inline actions).
  - Use Ionicons through `Icon`, never emoji or text glyphs as icons.
  - Use `AppScreen` with `edges` for safe areas; full-screen flows use `FULL_SCREEN_EDGES`.
  - Liquid Glass (tab bar and paywall) is used only on iOS 26 with the API available and Reduce Transparency off. Everything else falls back to solid surfaces.
- **Android back**: handled with `BackHandler` in `WorkVoiceApp` and `Onboarding`. Leaving the result screen asks whether to save or discard.

## Gotchas we already hit

- **Expo `fetch` and `FormData`**: React Native's `{ uri, name, type }` file parts throw "Unsupported FormDataPart implementation". Append `new File(uri)` from `expo-file-system` instead.
- **Azure REST short-audio response is flat**: scores sit directly on `NBest[0]`, `Words[]` and `Phonemes[]`. The Speech SDK nests them under `PronunciationAssessment`; `scoresOf()` accepts both. Send `Dimension: 'Comprehensive'`, or there's no fluency score and no error types. Prosody issues arrive under `Words[].Feedback.Prosody`.
- **Azure `InitialSilenceTimeout`** on very short takes (about 0.15 s of decoded audio). Ask testers for 3–5 seconds of speech.
- **`expo-audio` `useAudioPlayer`** releases the native player on unmount. Never call `pause()`, `play()` or `replace()` in cleanups or after an await without a mounted check.
- **Supabase auth**:
  - supabase-js defaults to the implicit flow; we set `flowType: 'pkce'`, so links return `?code=`.
  - Handle `Linking.getInitialURL()` as well as `url` events.
  - The redirect comes from `expo-linking` `createURL('auth/callback')`: `exp://<lan-ip>:8081/--/auth/callback` in Expo Go, `workvoice://auth/callback` in builds. Both must be in Supabase **Redirect URLs**; Site URL is only the fallback.
  - Supabase's built-in email service is heavily rate-limited (HTTP 429 `over_email_send_rate_limit`). Use custom SMTP for real testing.
- **ElevenLabs**: the free plan can't use Voice Library voices through the API (HTTP 402). Use default voices or a paid plan. The current key can't list voices (`voices_read` missing), which the gateway doesn't need.
- **Azure subscription**: `Microsoft.ContainerRegistry` had to be registered before `az containerapp up` could build.

## Current status

### Done
- Full UI/UX pass: accessibility, contrast, touch targets, safe areas (`react-native-safe-area-context`), Ionicons, Android back, plain-language copy, upgrade paths, sign out, destructive-action separation, tablet max width.
- iOS 26 Liquid Glass tab bar and paywall (`expo-glass-effect`), with fallbacks.
- ElevenLabs model voice: gateway `/v1/speech`, app download cache, device-voice fallback, privacy disclosure in Profile.
- Gateway deployed to Azure Container Apps (resource group `workvoice`, West Europe, app `workvoice-gateway`). All required settings are applied as secrets. `/healthz` is OK, unauthenticated requests get 401, HTTP redirects to HTTPS.
- Supabase: migrations applied (`profiles`, `assessment_results`, plan-protection trigger), redirect URLs configured.
- Sign-in fixes (PKCE, Expo Go redirect, cold-start links, specific error messages); development anonymous sign-in bypass.
- Gateway hardening: `.dockerignore` (keeps `.env` out of the image), request logging (method, path, status, timing only), 4xx/5xx reasons logged for operators.
- Fixed: recording upload format, Azure score parsing (scores were all 0), audio player crash on unmount.

### Pending verification
- A real recording after the scoring fix (gateway revision 6), to confirm non-zero scores in `assessment_results`. The test profile needs `plan = 'pro'` in Supabase, plus **Preview Pro access** in the app, to get past today's free limit.
- The test account's earlier baseline and first practice were saved before the scoring fix and have 0 scores. Delete or redo them.
- Liquid Glass and safe areas on a real iOS 26 device; Android back behavior; whether `expo-glass-effect` works in Expo Go.

### Not set up yet
- ElevenLabs voice IDs (blocked on the free plan; device voice in use).
- Custom SMTP for Supabase email.
- RevenueCat keys, entitlement, offering, webhook, and a development build. Payments are in preview mode.

### Before launch
- Turn off Supabase anonymous sign-ins and clear `EXPO_PUBLIC_DEV_AUTH_BYPASS`.
- Remove any `exp://**` redirect wildcard.
- Remove or gate the gateway's short-conversion diagnostics (`logShortConversion` writes a RAM-only temp file in `/dev/shm`).
- Add screen-level tests. Current tests cover only curriculum, entitlements, and gateway normalization, validation, and cache.
- Known gaps: every profile is saved with the name "You"; no dark mode; "Save & continue" sits at the bottom of a long results screen; no LLM coaching yet. Claude-based options (personalized tips, role-play content feedback) were proposed but not built.
