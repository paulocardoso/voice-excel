import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAssessment, pronunciationHeader } from './assessment.mjs';

const azureResponse = {
  DisplayText: 'I have a clear update.',
  NBest: [{
    Display: 'I have a clear update.',
    PronunciationAssessment: { AccuracyScore: 81, FluencyScore: 74, ProsodyScore: 79, PronScore: 79 },
    Words: [
      {
        Word: 'clear',
        PronunciationAssessment: { AccuracyScore: 61, ErrorType: 'Mispronunciation' },
        Phonemes: [
          {
            Phoneme: 'ɛ',
            PronunciationAssessment: { AccuracyScore: 47, NBestPhonemes: [{ Phoneme: 'ə', Score: 100 }] },
          },
        ],
      },
      { Word: 'update', PronunciationAssessment: { AccuracyScore: 84, ErrorType: 'None' } },
    ],
  }],
};

test('normalizes Azure feedback and protects UK capability boundaries', () => {
  const us = normalizeAssessment(azureResponse, 'en-US');
  const uk = normalizeAssessment(azureResponse, 'en-GB');
  assert.equal(us.score.prosody, 79);
  assert.equal(uk.score.prosody, null);
  assert.equal(us.flaggedWords[0].word, 'clear');
  assert.deepEqual(us.flaggedWords[0].phonemes, [{ expected: 'ɛ', heard: 'ə', score: 47 }]);
  assert.equal(us.audioRetained, undefined);
});

test('includes reference text only for scripted assessment', () => {
  const decoded = JSON.parse(Buffer.from(pronunciationHeader({ referenceText: 'Hello team', targetVariety: 'en-US' }), 'base64').toString('utf8'));
  assert.equal(decoded.ReferenceText, 'Hello team');
  assert.equal(decoded.EnableProsodyAssessment, true);
  assert.equal(decoded.PhonemeAlphabet, 'IPA');
});

// Shape documented for the REST API for short audio: scores sit directly on
// NBest, words and phonemes, and prosody issues sit under Feedback.Prosody.
const restResponse = {
  RecognitionStatus: 'Success',
  DisplayText: 'Good morning team.',
  NBest: [{
    Display: 'Good morning team.',
    AccuracyScore: 88,
    FluencyScore: 72,
    ProsodyScore: 81.5,
    CompletenessScore: 100,
    PronScore: 83.2,
    Words: [
      { Word: 'good', AccuracyScore: 98, ErrorType: 'None' },
      {
        Word: 'morning',
        AccuracyScore: 92,
        ErrorType: 'None',
        Feedback: { Prosody: { Break: { ErrorTypes: ['UnexpectedBreak'] }, Intonation: { ErrorTypes: [] } } },
      },
      {
        Word: 'team',
        AccuracyScore: 58,
        ErrorType: 'Mispronunciation',
        Phonemes: [{ Phoneme: 'iː', AccuracyScore: 40, NBestPhonemes: [{ Phoneme: 'ɪ', Score: 90 }] }],
      },
    ],
  }],
};

test('reads flat REST scores, prosody feedback and phonemes', () => {
  const result = normalizeAssessment(restResponse, 'en-US');
  assert.deepEqual(result.score, { overall: 83.2, clarity: 88, fluency: 72, prosody: 81.5 });
  assert.equal(result.flaggedWords[0].word, 'team');
  assert.deepEqual(result.flaggedWords[0].phonemes, [{ expected: 'iː', heard: 'ɪ', score: 40 }]);
  const morning = result.flaggedWords.find((item) => item.word === 'morning');
  assert.equal(morning?.issue, 'pause');
});

test('requests comprehensive dimensions', () => {
  const decoded = JSON.parse(Buffer.from(pronunciationHeader({ targetVariety: 'en-GB' }), 'base64').toString('utf8'));
  assert.equal(decoded.Dimension, 'Comprehensive');
  assert.equal(decoded.ReferenceText, undefined);
});
