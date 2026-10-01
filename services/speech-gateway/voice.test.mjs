import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioCache, MAX_SPEECH_TEXT_LENGTH, parseSpeechRequest, speechCacheKey } from './voice.mjs';

test('parseSpeechRequest normalizes text and defaults to phrase pace', () => {
  assert.deepEqual(
    parseSpeechRequest({ text: '  Hello\n\tteam  ', variety: 'en-GB' }),
    { text: 'Hello team', variety: 'en-GB', pace: 'phrase' },
  );
});

test('parseSpeechRequest rejects invalid input', () => {
  assert.ok(parseSpeechRequest({ text: '', variety: 'en-US' }).error);
  assert.ok(parseSpeechRequest({ text: 'a'.repeat(MAX_SPEECH_TEXT_LENGTH + 1), variety: 'en-US' }).error);
  assert.ok(parseSpeechRequest({ text: 'Hi', variety: 'fr-FR' }).error);
  assert.ok(parseSpeechRequest({ text: 'Hi', variety: 'en-US', pace: 'fast' }).error);
  assert.ok(parseSpeechRequest({ text: 'Hi', variety: 'en-US', pace: 'constructor' }).error);
});

test('speechCacheKey separates voices, paces and varieties', () => {
  const request = { text: 'Hi', variety: 'en-US', pace: 'word' };
  assert.notEqual(speechCacheKey(request, 'a', 'm'), speechCacheKey(request, 'b', 'm'));
  assert.notEqual(speechCacheKey(request, 'a', 'm'), speechCacheKey({ ...request, pace: 'phrase' }, 'a', 'm'));
});

test('AudioCache evicts least recently used entries by count and bytes', () => {
  const cache = new AudioCache({ maxEntries: 2, maxBytes: 10 });
  cache.set('a', Buffer.alloc(4));
  cache.set('b', Buffer.alloc(4));
  cache.get('a');
  cache.set('c', Buffer.alloc(4));
  assert.ok(cache.get('a'));
  assert.equal(cache.get('b'), undefined);

  cache.set('big', Buffer.alloc(9));
  assert.equal(cache.bytes <= 10, true);
  assert.ok(cache.get('big'));
});
