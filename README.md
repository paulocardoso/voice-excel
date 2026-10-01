# WorkVoice

A cross-platform workplace-English coaching MVP for professionals who want to be heard clearly in meetings and interviews.

## Run locally

```sh
npm install
npm run start
```

The app starts in **demo assessment mode** until `EXPO_PUBLIC_ASSESSMENT_API_URL` is configured. Demo mode deliberately labels its feedback and never uploads audio.

## Production services

The mobile app expects an authenticated endpoint at `POST /v1/assessments` that accepts multipart form data:

- `audio`: the temporary recording
- `referenceText`: optional, for scripted exercises
- `targetVariety`: `en-US` or `en-GB`
- `exerciseId`, `mode`

It must return the `SpeechAssessment` shape in `src/types.ts`, delete raw audio after processing, and retain only the derived assessment. The adapter is designed for Azure Speech Pronunciation Assessment, with server-side credentials only.

The included [speech gateway](services/speech-gateway/README.md) is that production boundary. Apply the SQL in `supabase/migrations/` before deploying it, configure Supabase magic-link redirect URLs for `workvoice://auth/callback`, then set the mobile `EXPO_PUBLIC_*` values from `.env.example`.

For subscriptions, set the platform-specific RevenueCat SDK keys, create a `pro` entitlement and a current offering in RevenueCat, then make an Expo development build. Without those keys the app explicitly uses preview access; it never presents that preview as a real purchase.

## Verification

```sh
npm run typecheck
npm test -- --runInBand
EXPO_NO_TELEMETRY=1 CI=1 npx expo export --platform ios
```

## Pronunciation comparison

After a completed practice, the result screen lets a learner replay their own attempt and play a model pronunciation of the target phrase. It also highlights focus words in the transcript, offers a model playback for each word, and shows concise articulation guidance. For live US assessments, the gateway requests IPA phoneme detail so feedback can show a target sound and the most likely sound heard when the provider supplies it.

## Product boundaries

- Raw recordings are never persisted in app state, learning history, or the backend. A completed practice recording is held in the device cache solely while its result screen is open for comparison, then deleted on retry, save, exit, or app close.
- US English offers advanced prosody guidance; UK English transparently offers core clarity and fluency guidance.
- The app is self-serve: it does not schedule or sell human coaching.
