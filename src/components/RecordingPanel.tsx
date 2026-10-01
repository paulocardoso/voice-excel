import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Animated, StyleSheet, Text, View } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useModelVoice } from '../lib/useModelVoice';
import { discardLocalRecording } from '../services/speechAssessment';
import { EnglishVariety } from '../types';
import { colors, PrimaryButton, SecondaryButton, TextLink } from './ui';

const MAX_RECORDING_DURATION_MS = 30_000;
const IDLE_BARS = [18, 26, 34, 23, 30, 18];
const ACTIVE_BARS = [22, 42, 58, 38, 50, 22];

export function RecordingPanel({
  promptText,
  targetVariety,
  onRecordingReady,
  disabled = false,
  allowRemoteVoice = false,
}: {
  promptText: string;
  targetVariety: EnglishVariety;
  onRecordingReady: (uri?: string) => void;
  disabled?: boolean;
  /** Only scripted text may be sent to the model-voice provider. */
  allowRemoteVoice?: boolean;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [isPreparing, setIsPreparing] = useState(false);
  const [wasAutoStopped, setWasAutoStopped] = useState(false);
  const modelVoice = useModelVoice();
  const isPromptPlaying = modelVoice.activeKey === 'prompt';
  const isPromptLoading = modelVoice.loadingKey === 'prompt';
  const stoppingRef = useRef(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const isRecording = recorderState.isRecording;
  const elapsedSeconds = Math.min(30, Math.ceil(recorderState.durationMillis / 1000));
  const progress = Math.min(1, recorderState.durationMillis / MAX_RECORDING_DURATION_MS);

  useEffect(() => {
    if (!isRecording) {
      pulse.setValue(1);
      return;
    }
    let loop: Animated.CompositeAnimation | undefined;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled || reduceMotion) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]));
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [isRecording, pulse]);

  const playPrompt = useCallback(() => {
    if (isPromptPlaying) {
      modelVoice.stop();
      return;
    }
    void modelVoice.play({ key: 'prompt', text: promptText, variety: targetVariety, pace: 'phrase', allowRemote: allowRemoteVoice });
  }, [allowRemoteVoice, isPromptPlaying, modelVoice, promptText, targetVariety]);

  const startRecording = useCallback(async () => {
    setIsPreparing(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone needed', 'Allow microphone access in Settings to record a speaking attempt.');
        return;
      }
      modelVoice.stop();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      stoppingRef.current = false;
      setWasAutoStopped(false);
      await recorder.prepareToRecordAsync();
      recorder.record();
      AccessibilityInfo.announceForAccessibility('Recording started. You have 30 seconds.');
    } catch {
      Alert.alert('Could not start recording', 'Please check microphone access and try again.');
    } finally {
      setIsPreparing(false);
    }
  }, [modelVoice, recorder]);

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      await recorder.stop();
      onRecordingReady(recorder.uri ?? undefined);
    } catch {
      Alert.alert('Could not save recording', 'Please record your answer again.');
    }
  }, [onRecordingReady, recorder]);

  const discardRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      await recorder.stop();
    } finally {
      discardLocalRecording(recorder.uri ?? undefined);
      AccessibilityInfo.announceForAccessibility('Recording discarded.');
    }
  }, [recorder]);

  useEffect(() => {
    if (isRecording && recorderState.durationMillis >= MAX_RECORDING_DURATION_MS) {
      setWasAutoStopped(true);
      void stopRecording();
    }
  }, [recorderState.durationMillis, isRecording, stopRecording]);

  const statusText = isRecording
    ? `Recording · ${elapsedSeconds} of 30 seconds`
    : wasAutoStopped
      ? 'Time is up. Your 30-second attempt is being analyzed.'
      : 'Listen once, then record your response.';

  return (
    <View style={styles.container}>
      <View
        style={[styles.wave, isRecording && styles.waveRecording]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {(isRecording ? ACTIVE_BARS : IDLE_BARS).map((height, index) => (
          <Animated.View
            key={index}
            style={[styles.waveBar, isRecording && styles.waveBarRecording, { height, opacity: isRecording && index % 2 ? pulse : 1 }]}
          />
        ))}
      </View>
      {isRecording ? (
        <View style={styles.timerTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.timerFill, { width: `${progress * 100}%` }]} />
        </View>
      ) : null}
      <View style={styles.statusRow}>
        {isRecording ? <Animated.View style={[styles.recDot, { opacity: pulse }]} /> : null}
        {/* Live region so screen readers hear state changes without moving focus. */}
        <Text style={[styles.status, isRecording && styles.statusRecording]} accessibilityLiveRegion="polite">{statusText}</Text>
      </View>
      {isRecording ? (
        <>
          <PrimaryButton label="Stop & analyze" icon="stop" onPress={() => void stopRecording()} disabled={disabled} />
          <TextLink label="Discard and start over" icon="refresh" onPress={() => void discardRecording()} style={styles.discard} />
        </>
      ) : (
        <>
          <PrimaryButton
            label={isPreparing ? 'Preparing microphone…' : 'Start recording'}
            icon="mic"
            loading={isPreparing}
            onPress={() => void startRecording()}
            disabled={disabled}
          />
          <SecondaryButton
            label={isPromptLoading ? 'Loading model voice…' : isPromptPlaying ? 'Stop model phrase' : 'Listen to model phrase'}
            icon={isPromptPlaying ? 'stop-circle-outline' : 'volume-high-outline'}
            onPress={playPrompt}
            disabled={disabled}
            style={styles.listenButton}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, alignItems: 'stretch' },
  wave: { height: 74, borderRadius: 18, backgroundColor: '#EEF2FF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  waveRecording: { backgroundColor: colors.roseSoft },
  waveBar: { width: 6, borderRadius: 6, backgroundColor: colors.blue },
  waveBarRecording: { backgroundColor: colors.rose },
  timerTrack: { height: 4, borderRadius: 999, backgroundColor: '#F4D3DB', overflow: 'hidden' },
  timerFill: { height: '100%', backgroundColor: colors.rose },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 6 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.rose },
  status: { color: colors.muted, textAlign: 'center', fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
  statusRecording: { color: colors.roseText, fontWeight: '800' },
  listenButton: { minHeight: 48 },
  discard: { alignSelf: 'center' },
});
