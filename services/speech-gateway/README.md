# WorkVoice speech gateway

This is the production boundary for raw audio. It authenticates the Supabase access token, keeps an incoming recording in RAM only, converts it to Azure’s supported 16 kHz mono PCM WAV input, requests pronunciation assessment, saves only derived feedback to Supabase, and clears both buffers before the request ends.

## Run

```sh
cp .env.example .env
npm install
npm start
```

Use a TLS-terminating deployment target for production. Set `ALLOWED_ORIGINS` for web clients; native app requests have no browser origin. The mobile app sends only recordings under 30 seconds, matching Azure’s pronunciation-assessment limit.

## Required Azure behavior

`AZURE_SPEECH_RESOURCE_NAME` is the resource name used in Azure’s REST hostname. The gateway performs an in-memory `ffmpeg` conversion because Expo native recordings are M4A while Azure’s short-audio pronunciation REST endpoint accepts PCM WAV or OGG/Opus. No raw audio is sent to Supabase Storage or inserted into Postgres.

The gateway also enforces one derived practice result per UTC day for free accounts. RevenueCat’s signed/secret-authenticated webhook is the only route that can change a server-side subscription plan; point it at `POST /v1/billing/webhook` and configure the same authorization secret in the RevenueCat dashboard.
