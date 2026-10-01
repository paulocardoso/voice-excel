import { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { ModelVoice } from '../lib/useModelVoice';
import { EnglishVariety } from '../types';
import { Body, Card, Pill, PrimaryButton, SecondaryButton, colors } from './ui';

export function PronunciationComparison({
  learnerRecordingUri,
  modelText,
  modelLabel = 'Model pronunciation',
  targetVariety,
  modelVoice,
  allowRemoteModel,
}: {
  learnerRecordingUri?: string;
  modelText: string;
  modelLabel?: string;
  targetVariety: EnglishVariety;
  /** Shared with the word list so only one model clip plays at a time. */
  modelVoice: ModelVoice;
  /** Only scripted text may be sent to the model-voice provider. */
  allowRemoteModel: boolean;
}) {
  const player = useAudioPlayer(learnerRecordingUri ?? null, { updateInterval: 200 });
  const playerStatus = useAudioPlayerStatus(player);
  const isModelPlaying = modelVoice.activeKey === 'model';
  const isModelLoading = modelVoice.loadingKey === 'model';
  const hasRecording = Boolean(learnerRecordingUri);

  useEffect(() => {
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    return () => {
      player.pause();
    };
  }, [player]);

  const playLearner = useCallback(async () => {
    if (!hasRecording) return;
    modelVoice.stop();
    // Switching from the model clip back to the learner's recording.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (playerStatus.playing) {
      player.pause();
      return;
    }
    if (playerStatus.didJustFinish || (playerStatus.duration > 0 && playerStatus.currentTime >= playerStatus.duration - 0.1)) {
      await player.seekTo(0);
    }
    player.play();
  }, [hasRecording, modelVoice, player, playerStatus.currentTime, playerStatus.didJustFinish, playerStatus.duration, playerStatus.playing]);

  const playModel = useCallback(() => {
    player.pause();
    if (isModelPlaying) {
      modelVoice.stop();
      return;
    }
    void modelVoice.play({ key: 'model', text: modelText, variety: targetVariety, pace: 'phrase', allowRemote: allowRemoteModel });
  }, [allowRemoteModel, isModelPlaying, modelText, modelVoice, player, targetVariety]);

  const progress = playerStatus.duration > 0 ? Math.min(100, (playerStatus.currentTime / playerStatus.duration) * 100) : 0;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Pill label="LISTEN & COMPARE" tone="teal" />
          <Text style={styles.title}>Hear the difference, then try it again.</Text>
        </View>
        {hasRecording ? null : <Pill label="SAMPLE MODE" tone="gray" />}
      </View>
      <Body style={styles.instructions}>Play your attempt, listen to the model, then replay your attempt with one focus word in mind.</Body>
      {hasRecording ? (
        <View
          style={styles.progressArea}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Your recording playback"
          accessibilityValue={{ min: 0, max: Math.max(1, Math.round(playerStatus.duration)), now: Math.round(playerStatus.currentTime) }}
        >
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
          <Text style={styles.progressText}>{formatTime(playerStatus.currentTime)} / {formatTime(playerStatus.duration)}</Text>
        </View>
      ) : (
        <Text style={styles.sampleNote}>Make a recording in a live assessment to replay it here.</Text>
      )}
      <View style={styles.actions}>
        <PrimaryButton
          label={playerStatus.playing ? 'Pause your recording' : 'Play your recording'}
          icon={playerStatus.playing ? 'pause' : 'play'}
          onPress={() => void playLearner()}
          disabled={!hasRecording}
        />
        <SecondaryButton
          label={isModelLoading ? 'Loading model voice…' : isModelPlaying ? 'Stop model pronunciation' : `Play ${modelLabel.toLowerCase()}`}
          icon={isModelPlaying ? 'stop-circle-outline' : 'volume-high-outline'}
          onPress={playModel}
        />
      </View>
      <View style={styles.modelPhrase}>
        <Text style={styles.modelLabel}>{modelLabel}</Text>
        <Text style={styles.modelText}>{modelText}</Text>
      </View>
      {hasRecording ? <Text style={styles.privacy}>This recording remains on this device only while you compare it. It is deleted when you retry, save, or leave.</Text> : null}
    </Card>
  );
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  card: { gap: 12, marginTop: 15, borderColor: '#CFE9E4' },
  header: { flexDirection: 'row', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' },
  headerCopy: { flex: 1, gap: 7 },
  title: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: '900' },
  instructions: { fontSize: 13, lineHeight: 19 },
  progressArea: { gap: 6 },
  progressTrack: { height: 7, borderRadius: 999, backgroundColor: '#E6F2F0', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: colors.teal },
  progressText: { color: colors.muted, fontSize: 12, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  sampleNote: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  actions: { gap: 9 },
  modelPhrase: { backgroundColor: '#F5F8FF', borderRadius: 14, padding: 12, gap: 4 },
  modelLabel: { color: colors.blue, fontSize: 12, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  modelText: { color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: '700' },
  privacy: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
