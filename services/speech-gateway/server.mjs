import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { normalizeAssessment, pronunciationHeader } from './assessment.mjs';
import { AudioCache, PACE_SPEED, parseSpeechRequest, speechCacheKey } from './voice.mjs';

const config = requiredConfig([
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_RESOURCE_NAME',
]);
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean));
const revenueCatWebhookAuthorization = process.env.REVENUECAT_WEBHOOK_AUTHORIZATION;
const proEntitlementId = process.env.REVENUECAT_PRO_ENTITLEMENT_ID ?? 'pro';
const speechRegion = process.env.AZURE_SPEECH_REGION?.trim().toLowerCase();
if (speechRegion && !/^[a-z0-9]+$/.test(speechRegion)) throw new Error('AZURE_SPEECH_REGION must be an Azure region name such as westeurope.');
// Optional: without these, /v1/speech answers 503 and the app uses device voices.
const elevenLabs = {
  apiKey: process.env.ELEVENLABS_API_KEY,
  modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
  voices: { 'en-US': process.env.ELEVENLABS_VOICE_ID_US, 'en-GB': process.env.ELEVENLABS_VOICE_ID_GB },
};
const speechCache = new AudioCache();
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
});

app.disable('x-powered-by');
// One line per request for operators: no tokens, user IDs, text, or audio.
app.use((request, response, next) => {
  if (request.path === '/healthz') return next();
  const started = Date.now();
  response.on('finish', () => {
    console.log(`${request.method} ${request.path} ${response.statusCode} ${Date.now() - started}ms bytes=${request.header('content-length') ?? '-'} origin=${request.header('origin') ? 'browser' : 'none'}`);
  });
  return next();
});
app.use(express.json({ limit: '256kb' }));
app.use(cors({
  origin(origin, callback) {
    // Native clients have no browser Origin header. Web origins must be explicitly allowed.
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by this speech gateway.'));
  },
}));

app.get('/healthz', (_request, response) => response.status(200).json({ status: 'ok' }));

app.post('/v1/assessments', requireUser, upload.single('audio'), async (request, response, next) => {
  let normalizedAudio;
  try {
    const audio = request.file;
    const targetVariety = request.body.targetVariety;
    const mode = request.body.mode;
    const exerciseId = String(request.body.exerciseId ?? '').trim();
    const referenceText = String(request.body.referenceText ?? '').trim();

    if (!audio) return response.status(400).json({ error: 'A speaking recording is required.' });
    if (!['en-US', 'en-GB'].includes(targetVariety)) return response.status(400).json({ error: 'Unsupported English target.' });
    if (!['scripted', 'roleplay'].includes(mode)) return response.status(400).json({ error: 'Unsupported exercise mode.' });
    if (!exerciseId || exerciseId.length > 120) return response.status(400).json({ error: 'Invalid exercise ID.' });
    if (mode === 'scripted' && !referenceText) return response.status(400).json({ error: 'Scripted practice requires reference text.' });
    if (referenceText.length > 800) return response.status(400).json({ error: 'Reference text is too long.' });

    if (exerciseId !== 'baseline-assessment') await assertPracticeEntitlement(request.user.id);

    // Expo produces m4a on native devices. Convert it in memory to the Azure
    // REST API's required 16 kHz mono PCM WAV format; no temporary file or
    // object storage is created.
    normalizedAudio = await transcodeToAzureWav(audio.buffer);
    // 16 kHz mono 16-bit PCM is 32,000 bytes per second plus a 44-byte header.
    if (normalizedAudio.length < 16_000) await logShortConversion(audio.buffer, normalizedAudio.length);
    const azure = await assessWithAzure({ normalizedAudio, referenceText, targetVariety });
    const assessment = normalizeAssessment(azure, targetVariety);
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    if (exerciseId === 'baseline-assessment') {
      await storeBaseline({ userId: request.user.id, assessment, createdAt });
    } else {
      await storeDerivedResult({
        id,
        userId: request.user.id,
        exerciseId,
        targetVariety,
        assessment,
        createdAt,
      });
    }

    return response.status(201).json({
      id,
      createdAt,
      ...assessment,
      isDemo: false,
      audioRetained: false,
    });
  } catch (error) {
    return next(error);
  } finally {
    // Ensure buffers do not outlive a request longer than necessary.
    if (request.file?.buffer) request.file.buffer.fill(0);
    if (normalizedAudio) normalizedAudio.fill(0);
  }
});

// Model pronunciation audio. The app downloads the clip with its access token
// and plays it from the device cache.
app.get('/v1/speech', requireUser, async (request, response, next) => {
  try {
    const parsed = parseSpeechRequest(request.query);
    if (parsed.error) return response.status(400).json({ error: parsed.error });
    const voiceId = elevenLabs.voices[parsed.variety];
    if (!elevenLabs.apiKey || !voiceId) throw new GatewayError(503, 'Model voice is not configured.');

    const key = speechCacheKey(parsed, voiceId, elevenLabs.modelId);
    let audio = speechCache.get(key);
    if (!audio) {
      audio = await synthesizeWithElevenLabs({ ...parsed, voiceId });
      speechCache.set(key, audio);
    }
    response.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'private, max-age=86400' });
    return response.status(200).end(audio);
  } catch (error) {
    return next(error);
  }
});

app.delete('/v1/account', requireUser, async (request, response, next) => {
  try {
    const deletion = await fetch(`${config.SUPABASE_URL}/auth/v1/admin/users/${request.user.id}`, {
      method: 'DELETE',
      headers: {
        apikey: config.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!deletion.ok) throw new GatewayError(502, 'The account service could not complete deletion.');
    // Foreign-key cascade deletes profiles and all derived assessment results.
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.post('/v1/billing/webhook', async (request, response, next) => {
  try {
    if (!revenueCatWebhookAuthorization || request.header('authorization') !== `Bearer ${revenueCatWebhookAuthorization}`) {
      throw new GatewayError(401, 'Invalid billing webhook authorization.');
    }
    const event = request.body?.event ?? request.body;
    const userId = event?.app_user_id;
    if (!userId || typeof userId !== 'string') throw new GatewayError(400, 'Billing event does not contain an app user ID.');
    const type = String(event.type ?? '');
    const entitlementIds = Array.isArray(event.entitlement_ids) ? event.entitlement_ids : [];
    // Cancellation normally retains service through the paid period; only a
    // terminal event removes access.
    const terminal = ['EXPIRATION', 'REFUND', 'SUBSCRIPTION_PAUSED'].includes(type);
    const plan = entitlementIds.includes(proEntitlementId) && !terminal ? 'pro' : 'free';
    await setSubscriptionPlan(userId, plan);
    return response.status(200).json({ received: true });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) return response.status(413).json({ error: 'Recording is too large. Keep attempts under 30 seconds.' });
  const status = error instanceof GatewayError ? error.status : 500;
  if (status >= 500) console.error(error instanceof GatewayError && error.detail ? `${status} ${error.message} | ${error.detail}` : error);
  else if (error instanceof GatewayError && error.detail) console.warn(`${status} ${error.message} | ${error.detail}`);
  return response.status(status).json({ error: error instanceof GatewayError ? error.message : 'Speech analysis could not be completed.' });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`WorkVoice speech gateway listening on ${port}`));

async function requireUser(request, response, next) {
  try {
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new GatewayError(401, 'Sign in before requesting speech feedback.');
    const authResponse = await fetch(`${config.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: config.SUPABASE_PUBLISHABLE_KEY,
        Authorization: authorization,
      },
    });
    if (!authResponse.ok) throw new GatewayError(401, 'Your sign-in session has expired. Please sign in again.');
    request.user = await authResponse.json();
    return next();
  } catch (error) {
    return next(error);
  }
}

async function transcodeToAzureWav(input) {
  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    const errors = [];
    process.stdout.on('data', (chunk) => output.push(chunk));
    process.stderr.on('data', (chunk) => errors.push(chunk));
    process.on('error', () => reject(new GatewayError(500, 'Audio converter is unavailable.')));
    process.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errors).toString().replace(/\s+/g, ' ').trim();
        return reject(new GatewayError(422, 'We could not read that recording. Please record it again.', `ffmpeg exit ${code}: ${stderr.slice(0, 300)} (input ${input.length} bytes)`));
      }
      return resolve(Buffer.concat(output));
    });
    process.stdin.end(input);
  });
}

/**
 * Diagnostics for recordings that convert to under half a second. Logs format
 * metadata only (never audio or words). The file-based retry uses /dev/shm,
 * which is RAM-backed, and is deleted immediately.
 */
async function logShortConversion(input, wavBytes) {
  try {
    const probe = await runFfmpeg(['-hide_banner', '-i', 'pipe:0', '-f', 'null', '-'], input);
    const info = probe.stderr.replace(/\s+/g, ' ').match(/Input #0.*?(?=Output #0|$)/)?.[0]?.slice(0, 400) ?? probe.stderr.slice(0, 400);
    const path = `/dev/shm/workvoice-${randomUUID()}.m4a`;
    let fileWavBytes = 'n/a';
    try {
      await writeFile(path, input);
      const fromFile = await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1']);
      fileWavBytes = String(fromFile.stdout.length);
    } finally {
      await rm(path, { force: true });
    }
    console.warn(`short conversion: input ${input.length} bytes, head ${input.subarray(0, 12).toString('hex')}, pipe wav ${wavBytes} bytes, file wav ${fileWavBytes} bytes | ${info}`);
  } catch (error) {
    console.warn(`short conversion diagnostics failed: ${error.message}`);
  }
}

function runFfmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }));
    child.stdin.end(input);
  });
}

async function assessWithAzure({ normalizedAudio, referenceText, targetVariety }) {
  // Speech resources without a custom domain only have the regional endpoint,
  // so prefer it when AZURE_SPEECH_REGION is set.
  const endpoint = speechRegion
    ? new URL(`https://${speechRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`)
    : new URL(`https://${config.AZURE_SPEECH_RESOURCE_NAME}.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1`);
  endpoint.searchParams.set('language', targetVariety);
  endpoint.searchParams.set('format', 'detailed');
  const azureResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      'Ocp-Apim-Subscription-Key': config.AZURE_SPEECH_KEY,
      'Pronunciation-Assessment': pronunciationHeader({ referenceText: referenceText || undefined, targetVariety }),
    },
    body: normalizedAudio,
  });
  if (!azureResponse.ok) {
    const body = await azureResponse.text().catch(() => '');
    throw new GatewayError(502, 'Speech analysis is temporarily unavailable. Please try again.', `Azure HTTP ${azureResponse.status}: ${body.slice(0, 200)}`);
  }
  const payload = await azureResponse.json();
  if (payload.RecognitionStatus !== 'Success') {
    throw new GatewayError(422, 'We could not understand that recording. Try again in a quieter place.', `Azure RecognitionStatus=${payload.RecognitionStatus} (wav ${normalizedAudio.length} bytes)`);
  }
  return payload;
}

async function synthesizeWithElevenLabs({ text, pace, voiceId }) {
  const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  endpoint.searchParams.set('output_format', 'mp3_44100_128');
  const providerResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'xi-api-key': elevenLabs.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: elevenLabs.modelId,
      voice_settings: { speed: PACE_SPEED[pace] },
    }),
  });
  if (!providerResponse.ok) {
    // Log the provider status for operators; never echo provider details to the app.
    console.error(`ElevenLabs request failed with status ${providerResponse.status}`);
    throw new GatewayError(502, 'Model voice is temporarily unavailable.');
  }
  return Buffer.from(await providerResponse.arrayBuffer());
}

async function assertPracticeEntitlement(userId) {
  const profileUrl = new URL(`${config.SUPABASE_URL}/rest/v1/profiles`);
  profileUrl.searchParams.set('select', 'plan');
  profileUrl.searchParams.set('id', `eq.${userId}`);
  profileUrl.searchParams.set('limit', '1');
  const profileResponse = await fetch(profileUrl, { headers: serviceHeaders() });
  if (!profileResponse.ok) throw new GatewayError(502, 'We could not check your practice plan.');
  const [profile] = await profileResponse.json();
  if (profile?.plan === 'pro') return;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const resultsUrl = new URL(`${config.SUPABASE_URL}/rest/v1/assessment_results`);
  resultsUrl.searchParams.set('select', 'id');
  resultsUrl.searchParams.set('user_id', `eq.${userId}`);
  resultsUrl.searchParams.set('created_at', `gte.${todayStart.toISOString()}`);
  const resultsResponse = await fetch(resultsUrl, {
    headers: { ...serviceHeaders(), Range: '0-0', Prefer: 'count=exact' },
  });
  if (!resultsResponse.ok) throw new GatewayError(502, 'We could not check your daily practice allowance.');
  const count = Number(resultsResponse.headers.get('content-range')?.split('/').at(-1) ?? 0);
  if (count >= 1) throw new GatewayError(402, 'Your free daily practice is complete. Upgrade to Pro for unlimited feedback.');
}

async function storeDerivedResult({ id, userId, exerciseId, targetVariety, assessment, createdAt }) {
  const response = await fetch(`${config.SUPABASE_URL}/rest/v1/assessment_results`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      id,
      user_id: userId,
      exercise_id: exerciseId,
      target_variety: targetVariety,
      transcript: assessment.transcript,
      scores: assessment.score,
      flagged_words: assessment.flaggedWords,
      coaching_tip: assessment.coachingTip,
      next_drill: assessment.nextDrill,
      created_at: createdAt,
    }),
  });
  if (!response.ok) throw new GatewayError(502, 'We could not save your derived feedback. No audio was retained.');
}

async function storeBaseline({ userId, assessment, createdAt }) {
  const response = await fetch(`${config.SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...serviceHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: userId,
      baseline: { id: `baseline-${createdAt}`, createdAt, ...assessment, isDemo: false, audioRetained: false },
    }),
  });
  if (!response.ok) throw new GatewayError(502, 'We could not save your baseline feedback. No audio was retained.');
}

async function setSubscriptionPlan(userId, plan) {
  const response = await fetch(`${config.SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...serviceHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: userId, plan }),
  });
  if (!response.ok) throw new GatewayError(502, 'We could not update subscription access.');
}

function serviceHeaders() {
  return {
    apikey: config.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

function requiredConfig(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

class GatewayError extends Error {
  /** `detail` is logged for operators only and never sent to the app. */
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
