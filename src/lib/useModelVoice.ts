import { useCallback, useEffect, useRef, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Speech from 'expo-speech';
import { fetchModelVoice, isModelVoiceAvailable, ModelVoicePace } from '../services/modelVoice';
import { EnglishVariety } from '../types';

// Device-voice rates roughly matching the provider paces.
const DEVICE_RATE: Record<ModelVoicePace, number> = { phrase: 0.78, word: 0.66 };

export type ModelVoice = ReturnType<typeof useModelVoice>;

/**
 * Plays model pronunciations. Uses the ElevenLabs voice via the gateway when
 * `allowRemote` is true and it is available, otherwise the device voice.
 * One instance per screen keeps only one model clip playing at a time.
 */
export function useModelVoice() {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [activeKey, setActiveKey] = useState<string | undefined>();
  const [loadingKey, setLoadingKey] = useState<string | undefined>();
  const [usingRemote, setUsingRemote] = useState(false);
  const requestRef = useRef(0);
  // useAudioPlayer releases the native player on unmount; any later call on it
  // throws, so every player call below checks this first.
  const mountedRef = useRef(true);

  const pausePlayer = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      player.pause();
    } catch {
      // Player already released.
    }
  }, [player]);

  const stop = useCallback(() => {
    requestRef.current += 1;
    pausePlayer();
    void Speech.stop().catch(() => undefined);
    setActiveKey(undefined);
    setLoadingKey(undefined);
    setUsingRemote(false);
  }, [pausePlayer]);

  const play = useCallback(async ({
    key,
    text,
    variety,
    pace,
    allowRemote,
  }: {
    key: string;
    text: string;
    variety: EnglishVariety;
    pace: ModelVoicePace;
    allowRemote: boolean;
  }) => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    pausePlayer();
    await Speech.stop().catch(() => undefined);
    setActiveKey(key);
    setUsingRemote(false);

    if (allowRemote && isModelVoiceAvailable()) {
      setLoadingKey(key);
      try {
        const uri = await fetchModelVoice(text, variety, pace);
        if (request !== requestRef.current || !mountedRef.current) return;
        // A recording session may have left the audio route on the earpiece.
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (request !== requestRef.current || !mountedRef.current) return;
        player.replace(uri);
        player.play();
        setLoadingKey(undefined);
        setUsingRemote(true);
        return;
      } catch {
        if (request !== requestRef.current || !mountedRef.current) return;
        setLoadingKey(undefined);
        // Fall through to the device voice so the learner still hears a model.
      }
    }

    const finish = () => {
      if (request === requestRef.current) setActiveKey(undefined);
    };
    Speech.speak(text, { language: variety, rate: DEVICE_RATE[pace], pitch: 1, onDone: finish, onStopped: finish, onError: finish });
  }, [pausePlayer, player]);

  useEffect(() => {
    if (usingRemote && status.didJustFinish) {
      setActiveKey(undefined);
      setUsingRemote(false);
    }
  }, [status.didJustFinish, usingRemote]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cancels any download still in flight so it never touches the released player.
      requestRef.current += 1;
      void Speech.stop().catch(() => undefined);
    };
  }, []);

  return { play, stop, activeKey, loadingKey };
}
