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

  const stop = useCallback(() => {
    requestRef.current += 1;
    player.pause();
    void Speech.stop().catch(() => undefined);
    setActiveKey(undefined);
    setLoadingKey(undefined);
    setUsingRemote(false);
  }, [player]);

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
    player.pause();
    await Speech.stop().catch(() => undefined);
    setActiveKey(key);
    setUsingRemote(false);

    if (allowRemote && isModelVoiceAvailable()) {
      setLoadingKey(key);
      try {
        const uri = await fetchModelVoice(text, variety, pace);
        if (request !== requestRef.current) return;
        // A recording session may have left the audio route on the earpiece.
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        player.replace(uri);
        player.play();
        setLoadingKey(undefined);
        setUsingRemote(true);
        return;
      } catch {
        if (request !== requestRef.current) return;
        setLoadingKey(undefined);
        // Fall through to the device voice so the learner still hears a model.
      }
    }

    const finish = () => {
      if (request === requestRef.current) setActiveKey(undefined);
    };
    Speech.speak(text, { language: variety, rate: DEVICE_RATE[pace], pitch: 1, onDone: finish, onStopped: finish, onError: finish });
  }, [player]);

  useEffect(() => {
    if (usingRemote && status.didJustFinish) {
      setActiveKey(undefined);
      setUsingRemote(false);
    }
  }, [status.didJustFinish, usingRemote]);

  useEffect(() => () => { void Speech.stop().catch(() => undefined); }, []);

  return { play, stop, activeKey, loadingKey };
}
