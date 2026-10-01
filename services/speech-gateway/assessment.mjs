/**
 * Provider-neutral normalization for Azure Pronunciation Assessment responses.
 * No audio is persisted or returned from this module.
 */
export function pronunciationHeader({ referenceText, targetVariety }) {
  const config = {
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    // Without Comprehensive, Azure returns accuracy only: no fluency score and
    // no per-word error types.
    Dimension: 'Comprehensive',
    EnableMiscue: true,
  };
  if (referenceText) config.ReferenceText = referenceText;
  // Azure currently exposes prosody scores and phoneme names / substitutions
  // for the en-US target. IPA makes the result useful to the learner rather
  // than returning an opaque provider-specific sound label.
  if (targetVariety === 'en-US') {
    config.EnableProsodyAssessment = true;
    config.PhonemeAlphabet = 'IPA';
  }
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
}

export function normalizeAssessment(response, targetVariety) {
  const best = response?.NBest?.[0];
  if (!best) throw new Error('Azure did not return a recognized speech result.');
  const aggregate = scoresOf(best);
  const clarity = score(aggregate.AccuracyScore);
  const fluency = score(aggregate.FluencyScore);
  const prosody = targetVariety === 'en-US' && Number.isFinite(aggregate.ProsodyScore) ? score(aggregate.ProsodyScore) : null;
  const overall = Number.isFinite(aggregate.PronScore)
    ? score(aggregate.PronScore)
    : Math.round((clarity * 0.6 + fluency * 0.4) * 10) / 10;
  const flaggedWords = (best.Words ?? [])
    .map((item) => toWordFeedback(item))
    .filter((item) => item.score < 78 || item.issue !== 'pronunciation')
    .sort((left, right) => left.score - right.score)
    .slice(0, 3);
  const focus = flaggedWords[0];

  return {
    transcript: best.Display ?? response.DisplayText ?? '',
    score: { overall, clarity, fluency, prosody },
    flaggedWords,
    coachingTip: coachingTip(focus, targetVariety),
    nextDrill: nextDrill(focus),
  };
}

/**
 * The REST API for short audio puts scores directly on each result, word and
 * phoneme; the Speech SDK nests them under `PronunciationAssessment`. Accept both.
 */
function scoresOf(node) {
  return node?.PronunciationAssessment ?? node ?? {};
}

function score(value) {
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 10) / 10));
}

function toWordFeedback(word) {
  const assessment = scoresOf(word);
  const issue = issueFor(errorTypeOf(word, assessment));
  const phonemes = phonemeFeedbackFor(word);
  return {
    word: word.Word ?? '',
    score: score(assessment.AccuracyScore),
    issue,
    hint: hintFor(word.Word ?? 'this word', issue),
    ...(phonemes.length ? { phonemes } : {}),
  };
}

function phonemeFeedbackFor(word) {
  return (word.Phonemes ?? [])
    .map((phoneme) => {
      const expected = phoneme.Phoneme;
      const details = scoresOf(phoneme);
      const mostLikely = details.NBestPhonemes?.[0]?.Phoneme;
      const heard = typeof mostLikely === 'string' && mostLikely !== expected ? mostLikely : undefined;
      return {
        expected,
        ...(heard ? { heard } : {}),
        score: score(details.AccuracyScore),
      };
    })
    .filter((phoneme) => typeof phoneme.expected === 'string' && (phoneme.score < 78 || phoneme.heard))
    .sort((left, right) => left.score - right.score)
    .slice(0, 2);
}

/** Prosody problems arrive under Feedback.Prosody rather than ErrorType. */
function errorTypeOf(word, assessment) {
  if (assessment.ErrorType && assessment.ErrorType !== 'None') return assessment.ErrorType;
  const prosody = (word.Feedback ?? assessment.Feedback)?.Prosody;
  const breakErrors = prosody?.Break?.ErrorTypes ?? [];
  const intonationErrors = prosody?.Intonation?.ErrorTypes ?? [];
  return [...breakErrors, ...intonationErrors].find((type) => type && type !== 'None') ?? assessment.ErrorType;
}

function issueFor(errorType) {
  if (errorType === 'UnexpectedBreak' || errorType === 'MissingBreak') return 'pause';
  if (errorType === 'Monotone') return 'stress';
  if (errorType === 'Insertion' || errorType === 'Omission') return 'pace';
  return 'pronunciation';
}

function hintFor(word, issue) {
  if (issue === 'pause') return `Give “${word}” a little more space so the phrase is easier to follow.`;
  if (issue === 'stress') return `Add more contrast to the stressed syllable in “${word}”.`;
  if (issue === 'pace') return `Say “${word}” once more slowly, then reconnect it to the sentence.`;
  return `Slow down on “${word}” and complete the final sound before moving on.`;
}

function coachingTip(focus, targetVariety) {
  if (!focus?.word) return 'Your response was clear. Keep a steady pace and pause briefly between your main ideas.';
  if (focus.issue === 'pause') return `Your message is clear. On the retry, add one small pause around “${focus.word}”.`;
  if (focus.issue === 'stress') return targetVariety === 'en-US'
    ? `Keep your message steady, then make the stressed syllable in “${focus.word}” more noticeable.`
    : `Keep your message steady, then make the key syllable in “${focus.word}” more noticeable.`;
  return `Focus on “${focus.word}” once, then repeat the full phrase at a slightly slower pace.`;
}

function nextDrill(focus) {
  return focus?.word
    ? `Repeat “${focus.word}” three times, then say the full sentence once with a calm pause.`
    : 'Repeat your strongest sentence once more, adding a short pause before the final idea.';
}
