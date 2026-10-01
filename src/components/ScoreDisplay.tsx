import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScoreBreakdown, SpeechAssessment, WordFeedback } from '../types';
import { formatIpaSound, soundPlacementTip } from '../lib/pronunciationGuidance';
import { Body, Card, Divider, Icon, Pill, colors, iconSize } from './ui';

export function ScoreBadge({ score, label = 'Clarity score', compact = false }: { score: number; label?: string; compact?: boolean }) {
  const tone = score >= 80 ? 'strong' : score >= 65 ? 'growing' : 'starting';
  const rounded = Math.round(score);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${rounded} out of 100, ${toneLabel[tone]}`}
      style={[styles.scoreBadge, compact && styles.scoreBadgeCompact, tone === 'strong' ? styles.strong : tone === 'growing' ? styles.growing : styles.starting]}
    >
      <Text style={[styles.scoreNumber, compact && styles.scoreNumberCompact]}>{rounded}</Text>
      {compact ? null : <Text style={styles.scoreLabel}>{label}</Text>}
    </View>
  );
}

const toneLabel = { strong: 'strong', growing: 'growing', starting: 'getting started' } as const;

export function ScoreBreakdownView({ score }: { score: ScoreBreakdown }) {
  const rows: Array<{ label: string; value: number | null; caption?: string }> = [
    { label: 'Clarity', value: score.clarity },
    { label: 'Fluency', value: score.fluency },
    { label: 'Rhythm & intonation', value: score.prosody, caption: score.prosody === null ? 'US target only' : undefined },
  ];
  return (
    <View style={styles.breakdown}>
      {rows.map((row) => (
        <View
          key={row.label}
          style={styles.scoreRow}
          accessible
          accessibilityLabel={row.value === null ? `${row.label}: not available${row.caption ? `, ${row.caption}` : ''}` : `${row.label}: ${Math.round(row.value)} out of 100`}
        >
          <View style={styles.scoreRowHeader}>
            <Text style={styles.scoreRowLabel}>{row.label}</Text>
            <Text style={[styles.scoreRowValue, row.value === null && styles.notAvailable]}>{row.value === null ? '—' : Math.round(row.value)}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${row.value ?? 0}%` }, row.value === null && styles.progressUnavailable]} />
          </View>
          {row.caption ? <Text style={styles.caption}>{row.caption}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function AssessmentInsight({ assessment }: { assessment: SpeechAssessment }) {
  return (
    <Card style={styles.insightCard}>
      <View style={styles.insightHeader}>
        <ScoreBadge score={assessment.score.overall} />
        <View style={styles.insightCopy}>
          <Pill label={assessment.isDemo ? 'Sample feedback' : 'Your feedback'} tone={assessment.isDemo ? 'amber' : 'teal'} />
          <Text style={styles.insightTitle}>A clear next step</Text>
          <Body style={styles.tip}>{assessment.coachingTip}</Body>
        </View>
      </View>
      <Divider />
      <ScoreBreakdownView score={assessment.score} />
    </Card>
  );
}

export function WordFeedbackList({
  assessment,
  onPlayWord,
  activeWord,
  loadingWord,
}: {
  assessment: SpeechAssessment;
  onPlayWord?: (word: string) => void;
  activeWord?: string;
  loadingWord?: string;
}) {
  if (!assessment.flaggedWords.length) {
    return <Text style={styles.noFeedback}>No individual words need extra attention in this attempt. Use the recording comparison to listen for overall rhythm.</Text>;
  }

  return (
    <View style={styles.feedbackList}>
      {assessment.flaggedWords.map((item) => (
        <View key={`${item.word}-${item.issue}`} style={styles.feedbackItem}>
          <View style={styles.feedbackHeader}>
            <View style={styles.wordScore} accessible accessibilityLabel={`Word score ${Math.round(item.score)} out of 100`}>
              <Text style={styles.wordScoreNumber}>{Math.round(item.score)}</Text>
            </View>
            <View style={styles.wordCopy}>
              <Text style={styles.wordTitle}>“{item.word}”</Text>
              <Text style={styles.wordHint}>{item.hint}</Text>
            </View>
            <Pill label={issueLabel[item.issue]} tone="rose" />
          </View>
          {item.phonemes?.length ? <SoundFeedback phonemes={item.phonemes} /> : null}
          {onPlayWord ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Hear ${item.word} pronounced correctly`} onPress={() => onPlayWord(item.word)} hitSlop={6} style={({ pressed }) => [styles.listenWord, pressed && styles.listenWordPressed]}>
              <Icon name={activeWord === item.word && loadingWord !== item.word ? 'stop-circle-outline' : 'volume-high-outline'} size={iconSize.sm} color={colors.blue} />
              <Text style={styles.listenWordText}>
                {loadingWord === item.word ? 'Loading…' : activeWord === item.word ? 'Stop' : `Hear “${item.word}” correctly`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const issueLabel: Record<WordFeedback['issue'], string> = {
  pronunciation: 'Pronunciation',
  pace: 'Pace',
  stress: 'Stress',
  pause: 'Pause',
};

function SoundFeedback({ phonemes }: { phonemes: NonNullable<WordFeedback['phonemes']> }) {
  return (
    <View style={styles.soundList}>
      {phonemes.map((phoneme, index) => (
        <View key={`${phoneme.expected}-${phoneme.heard ?? 'unheard'}-${index}`} style={styles.soundItem}>
          <View style={styles.soundTopLine}>
            <Text style={styles.soundTarget}>Target {formatIpaSound(phoneme.expected)}</Text>
            {phoneme.heard && phoneme.heard !== phoneme.expected ? <Text style={styles.soundHeard}>Heard {formatIpaSound(phoneme.heard)}</Text> : null}
            <Text style={styles.soundScore}>{Math.round(phoneme.score)} sound score</Text>
          </View>
          <Text style={styles.soundTip}>{soundPlacementTip(phoneme.expected)}</Text>
        </View>
      ))}
    </View>
  );
}

export function HighlightedTranscript({ transcript, feedback }: { transcript: string; feedback: WordFeedback[] }) {
  const flaggedWords = new Set(feedback.map((item) => normalizedWord(item.word)).filter(Boolean));
  const parts = transcript.split(/([A-Za-z]+(?:['’][A-Za-z]+)?)/);
  return (
    <Text style={styles.transcriptText}>
      {parts.map((part, index) => (
        flaggedWords.has(normalizedWord(part))
          ? <Text key={`${part}-${index}`} style={styles.transcriptFlagged}>{part}</Text>
          : part
      ))}
    </Text>
  );
}

function normalizedWord(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z]/g, '');
}

const styles = StyleSheet.create({
  scoreBadge: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 7 },
  scoreBadgeCompact: { width: 64, height: 64, borderRadius: 32, borderWidth: 5 },
  strong: { backgroundColor: '#E1F7F2', borderColor: '#63D4C4' },
  growing: { backgroundColor: '#E9EEFF', borderColor: '#A9B9FF' },
  starting: { backgroundColor: '#FFF3DB', borderColor: '#FED089' },
  scoreNumber: { color: colors.ink, fontSize: 29, lineHeight: 32, fontWeight: '900', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  scoreNumberCompact: { fontSize: 21, lineHeight: 24 },
  scoreLabel: { color: colors.muted, fontSize: 11, lineHeight: 13, fontWeight: '800', textAlign: 'center', paddingHorizontal: 6 },
  insightCard: { padding: 17 },
  insightHeader: { flexDirection: 'row', gap: 15, alignItems: 'center' },
  insightCopy: { flex: 1, gap: 5 },
  insightTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', marginTop: 2 },
  tip: { fontSize: 13, lineHeight: 19 },
  breakdown: { gap: 14 },
  scoreRow: { gap: 6 },
  scoreRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  scoreRowLabel: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  scoreRowValue: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  notAvailable: { color: colors.muted },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: '#EDF0F5', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: colors.blue },
  progressUnavailable: { backgroundColor: '#D7DDE8' },
  caption: { color: colors.muted, fontSize: 12 },
  feedbackList: { gap: 10 },
  noFeedback: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  feedbackItem: { gap: 10, padding: 12, borderRadius: 15, backgroundColor: '#FBFCFF', borderWidth: 1, borderColor: '#E7EBF3' },
  feedbackHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  wordScore: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFE9EE', alignItems: 'center', justifyContent: 'center' },
  wordScoreNumber: { color: colors.roseText, fontWeight: '900', fontSize: 13 },
  wordCopy: { flex: 1, gap: 2 },
  wordTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  wordHint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  soundList: { gap: 7, paddingLeft: 49 },
  soundItem: { gap: 3, backgroundColor: '#F3F8F7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  soundTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  soundTarget: { color: colors.tealText, fontSize: 13, fontWeight: '900' },
  soundHeard: { color: colors.roseText, fontSize: 13, fontWeight: '800' },
  soundScore: { color: colors.muted, fontSize: 12, fontWeight: '800', marginLeft: 'auto' },
  soundTip: { color: '#38655F', fontSize: 13, lineHeight: 18 },
  listenWord: { alignSelf: 'flex-start', marginLeft: 49, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  listenWordPressed: { opacity: 0.65 },
  listenWordText: { color: colors.blue, fontSize: 14, fontWeight: '800' },
  transcriptText: { color: colors.ink, fontSize: 16, lineHeight: 24, fontStyle: 'italic' },
  transcriptFlagged: { color: colors.roseText, backgroundColor: colors.roseSoft, fontWeight: '900', textDecorationLine: 'underline' },
});
