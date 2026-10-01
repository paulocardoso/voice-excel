import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Edge, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView } from 'expo-glass-effect';
import { StatusBar } from 'expo-status-bar';
import { Session } from '@supabase/supabase-js';
import { AssessmentInsight, HighlightedTranscript, ScoreBadge, ScoreBreakdownView, WordFeedbackList } from './src/components/ScoreDisplay';
import { PronunciationComparison } from './src/components/PronunciationComparison';
import { RecordingPanel } from './src/components/RecordingPanel';
import { AppScreen, Body, Card, Divider, Eyebrow, FloatingBarInsetContext, Icon, IconName, Metric, Pill, PrimaryButton, SecondaryButton, TextLink, Title, colors, iconSize, useLiquidGlass } from './src/components/ui';
import { exercisesFor, nextExercise } from './src/data/curriculum';
import { track } from './src/lib/analytics';
import { useModelVoice } from './src/lib/useModelVoice';
import { isModelVoiceAvailable } from './src/services/modelVoice';
import { clearState, emptyState, loadState, persistState } from './src/lib/storage';
import { deleteRemoteAccount } from './src/services/account';
import { devAuthBypassEnabled, isSupabaseConfigured, restoreSession, sendMagicLink, signInAnonymously, signInErrorMessage, signOut, subscribeToMagicLinks, supabase } from './src/services/auth';
import { configureBilling, isRevenueCatConfigured, purchasePro, restorePro } from './src/services/billing';
import { syncProfile } from './src/services/profileSync';
import { loadRemoteProfile } from './src/services/profileRepository';
import { canStartPractice, normalizedFreeUsage, recordCompletedPractice } from './src/services/entitlements';
import { assessRecording, AssessmentError, discardLocalRecording, isDemoAssessmentMode } from './src/services/speechAssessment';
import {
  AppState,
  EnglishVariety,
  Exercise,
  LearningGoal,
  SpeechAssessment,
  UserProfile,
  varietyMeta,
} from './src/types';

type Tab = 'home' | 'practice' | 'progress' | 'profile';
type PracticeStage = 'catalog' | 'session' | 'result';

const baselineExercise: Pick<Exercise, 'id' | 'mode' | 'referenceText' | 'prompt' | 'title'> = {
  id: 'baseline-assessment',
  mode: 'scripted',
  title: 'Your speech baseline',
  prompt: 'Read this sentence in your natural speaking voice.',
  referenceText: 'I am ready to share clear ideas and take the next step in my career.',
};

/** Full-screen flows have no tab bar, so they own the bottom inset too. */
const FULL_SCREEN_EDGES: Edge[] = ['top', 'bottom', 'left', 'right'];
const FLOATING_BAR_HEIGHT = 64;
const FLOATING_BAR_GAP = 8;

export default function App() {
  return (
    <SafeAreaProvider>
      <WorkVoiceApp />
    </SafeAreaProvider>
  );
}

function localDateKey(value: Date | string = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function WorkVoiceApp() {
  const [state, setState] = useState<AppState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [selectedExercise, setSelectedExercise] = useState<Exercise | undefined>();
  const [practiceStage, setPracticeStage] = useState<PracticeStage>('catalog');
  const [latestAssessment, setLatestAssessment] = useState<SpeechAssessment | undefined>();
  const [latestRecordingUri, setLatestRecordingUri] = useState<string | undefined>();
  const [showPaywall, setShowPaywall] = useState(false);
  const retainedRecordingRef = useRef<string | undefined>(undefined);
  const profile = state.profile;

  const setRetainedRecording = useCallback((uri?: string) => {
    const previousUri = retainedRecordingRef.current;
    if (previousUri && previousUri !== uri) discardLocalRecording(previousUri);
    retainedRecordingRef.current = uri;
    setLatestRecordingUri(uri);
  }, []);

  const clearLatestRecording = useCallback(() => {
    if (retainedRecordingRef.current) discardLocalRecording(retainedRecordingRef.current);
    retainedRecordingRef.current = undefined;
    setLatestRecordingUri(undefined);
  }, []);

  useEffect(() => () => {
    if (retainedRecordingRef.current) discardLocalRecording(retainedRecordingRef.current);
  }, []);

  useEffect(() => {
    void loadState().then((loaded) => {
      setState(loaded);
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let isMounted = true;
    void restoreSession()
      .then(async (restored) => {
        if (restored || !devAuthBypassEnabled) return restored;
        try {
          const anonymous = await signInAnonymously();
          console.log('[auth] Development sign-in bypass: using an anonymous Supabase account.');
          return anonymous;
        } catch (issue) {
          // Fall back to the normal email sign-in screen.
          console.warn(`[auth] Sign-in bypass failed (enable anonymous sign-ins in Supabase): ${issue instanceof Error ? issue.message : String(issue)}`);
          return null;
        }
      })
      .then((restored) => {
        if (isMounted) setSession(restored);
      })
      .finally(() => {
        if (isMounted) setAuthReady(true);
      });
    const linkSubscription = subscribeToMagicLinks((nextSession) => setSession(nextSession));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => {
      isMounted = false;
      linkSubscription();
      authListener.subscription.unsubscribe();
    };
  }, []);

  const commit = useCallback((next: AppState) => {
    setState(next);
    void persistState(next);
    if (next.profile) void syncProfile(next.profile);
  }, []);

  const updateProfile = useCallback((updater: (profile: UserProfile) => UserProfile) => {
    setState((previous) => {
      if (!previous.profile) return previous;
      const next = { ...previous, profile: updater(previous.profile) };
      void persistState(next);
      if (next.profile) void syncProfile(next.profile);
      return next;
    });
  }, []);

  const resetApp = useCallback(async () => {
    // Remove the ephemeral comparison recording even if a remote account
    // deletion later fails.
    clearLatestRecording();
    await deleteRemoteAccount();
    await signOut();
    await clearState();
    setSelectedExercise(undefined);
    setLatestAssessment(undefined);
    setPracticeStage('catalog');
    setTab('home');
    setState(emptyState);
  }, [clearLatestRecording]);

  useEffect(() => {
    if (!hydrated || !session?.user.id || state.profile) return;
    let isMounted = true;
    void loadRemoteProfile().then((remoteProfile) => {
      if (!isMounted || !remoteProfile) return;
      const next = { version: 1 as const, profile: remoteProfile };
      setState(next);
      void persistState(next);
    });
    return () => { isMounted = false; };
  }, [hydrated, session?.user.id, state.profile]);

  useEffect(() => {
    if (!session?.user.id || !profile?.completedOnboarding || profile.plan === 'pro') return;
    void configureBilling(session.user.id).then((outcome) => {
      if (outcome === 'pro') updateProfile((current) => ({ ...current, plan: 'pro' }));
    }).catch(() => {
      // The paywall will surface a purchase error if billing remains unavailable.
    });
  }, [profile?.completedOnboarding, profile?.plan, session?.user.id, updateProfile]);

  const useGlass = useLiquidGlass();
  const insets = useSafeAreaInsets();
  const floatingBarInset = useGlass ? FLOATING_BAR_HEIGHT + FLOATING_BAR_GAP + Math.max(insets.bottom, FLOATING_BAR_GAP) : 0;
  const inPractice = Boolean(selectedExercise) && practiceStage !== 'catalog';
  const latestAssessmentRef = useRef(latestAssessment);
  latestAssessmentRef.current = latestAssessment;
  const backActionsRef = useRef<{ closePractice: () => void; completePractice: () => void }>(undefined);

  // Android hardware back: leave a practice or return to Home instead of exiting the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showPaywall) {
        setShowPaywall(false);
        return true;
      }
      if (inPractice && practiceStage === 'result' && latestAssessmentRef.current) {
        Alert.alert('Save this practice?', 'Saving keeps your feedback in your progress history.', [
          { text: 'Keep reviewing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => backActionsRef.current?.closePractice() },
          { text: 'Save', onPress: () => backActionsRef.current?.completePractice() },
        ]);
        return true;
      }
      if (inPractice) {
        backActionsRef.current?.closePractice();
        return true;
      }
      if (profile?.completedOnboarding && tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [inPractice, practiceStage, profile?.completedOnboarding, showPaywall, tab]);

  if (!hydrated || !authReady) {
    return <LoadingScreen />;
  }

  if (isSupabaseConfigured && !session) {
    return <MagicLinkScreen />;
  }

  if (!profile?.completedOnboarding) {
    return (
      <>
        <StatusBar style="dark" />
        <Onboarding
          onComplete={(nextProfile) => {
            commit({ version: 1, profile: nextProfile });
            track('onboarding_completed', { target: nextProfile.targetVariety });
          }}
        />
      </>
    );
  }

  const openPaywall = (placement: string) => {
    setShowPaywall(true);
    track('paywall_viewed', { placement });
  };

  const openExercise = (exercise: Exercise) => {
    if (!canStartPractice(profile)) {
      openPaywall('practice-limit');
      return;
    }
    clearLatestRecording();
    setSelectedExercise(exercise);
    setLatestAssessment(undefined);
    setPracticeStage('session');
    track('practice_started', { exercise: exercise.id, mode: exercise.mode });
  };

  const completePractice = () => {
    if (!selectedExercise || !latestAssessment) return;
    updateProfile((current) => {
      // Live assessments are already persisted and entitlement-counted by the
      // gateway. Demo assessments consume the local free allowance on save.
      const withUsage = latestAssessment.isDemo ? recordCompletedPractice(current) : current;
      return {
        ...withUsage,
        practiceResults: [
          ...withUsage.practiceResults,
          { exerciseId: selectedExercise.id, completedAt: new Date().toISOString(), assessment: latestAssessment },
        ],
      };
    });
    track('practice_completed', { exercise: selectedExercise.id });
    clearLatestRecording();
    setSelectedExercise(undefined);
    setLatestAssessment(undefined);
    setPracticeStage('catalog');
    setTab('home');
  };

  const closePractice = () => {
    clearLatestRecording();
    setSelectedExercise(undefined);
    setLatestAssessment(undefined);
    setPracticeStage('catalog');
  };
  backActionsRef.current = { closePractice, completePractice };

  if (selectedExercise && practiceStage === 'session') {
    return (
      <>
        <StatusBar style="dark" />
        <PracticeSession
          exercise={selectedExercise}
          onBack={closePractice}
          onAssessment={(assessment, recordingUri) => {
            setRetainedRecording(recordingUri);
            if (!assessment.isDemo) updateProfile((current) => recordCompletedPractice(current));
            setLatestAssessment(assessment);
            setPracticeStage('result');
            track('practice_analyzed', { exercise: selectedExercise.id, demo: assessment.isDemo });
          }}
        />
      </>
    );
  }

  if (selectedExercise && practiceStage === 'result' && latestAssessment) {
    return (
      <>
        <StatusBar style="dark" />
        <ResultScreen
          exercise={selectedExercise}
          assessment={latestAssessment}
          recordingUri={latestRecordingUri}
          canRetry={profile.plan === 'pro' || latestAssessment.isDemo}
          onRetry={() => {
            clearLatestRecording();
            setLatestAssessment(undefined);
            setPracticeStage('session');
          }}
          onComplete={completePractice}
        />
      </>
    );
  }

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      <FloatingBarInsetContext.Provider value={floatingBarInset}>
      <View style={styles.mainArea}>
        {tab === 'home' ? (
          <HomeScreen
            profile={profile}
            onStartExercise={openExercise}
            onOpenPractice={() => setTab('practice')}
            onOpenProfile={() => setTab('profile')}
            onUpgrade={() => openPaywall('home-free-notice')}
          />
        ) : null}
        {tab === 'practice' ? <PracticeCatalog profile={profile} onStartExercise={openExercise} onUpgrade={() => openPaywall('catalog')} /> : null}
        {tab === 'progress' ? <ProgressScreen profile={profile} onStartPractice={() => setTab('practice')} /> : null}
        {tab === 'profile' ? (
          <ProfileScreen
            profile={profile}
            onUpdate={updateProfile}
            onReset={resetApp}
            onUpgrade={() => openPaywall('profile')}
            onSignOut={isSupabaseConfigured && session && !session.user.is_anonymous ? () => void signOut() : undefined}
          />
        ) : null}
      </View>
      </FloatingBarInsetContext.Provider>
      <BottomNav active={tab} onChange={setTab} glass={useGlass} />
      <PaywallModal
        visible={showPaywall}
        glass={useGlass}
        onClose={() => setShowPaywall(false)}
        onPurchase={async () => {
          const outcome = await purchasePro(session?.user.id);
          if (outcome === 'pro' || outcome === 'preview') {
            updateProfile((current) => ({ ...current, plan: 'pro' }));
            setShowPaywall(false);
          }
          return outcome;
        }}
        onRestore={async () => {
          const outcome = await restorePro(session?.user.id);
          if (outcome === 'pro') updateProfile((current) => ({ ...current, plan: 'pro' }));
          return outcome;
        }}
      />
    </View>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loadingScreen} accessible accessibilityLabel="Loading WorkVoice">
      <View style={styles.logoMark}><Text style={styles.logoMarkText}>W</Text></View>
      <Text style={styles.loadingBrand}>WorkVoice</Text>
      <ActivityIndicator color={colors.blue} style={styles.loader} />
    </View>
  );
}

function MagicLinkScreen() {
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError('Enter a valid email address, like name@company.com.');
      return;
    }
    setIsSending(true);
    setError(undefined);
    try {
      await sendMagicLink(normalizedEmail);
      setSent(true);
    } catch (issue) {
      if (__DEV__) {
        const detail = issue && typeof issue === 'object' ? issue as { status?: number; code?: string; message?: string } : {};
        console.warn(`[auth] Sign-in link failed: status=${detail.status ?? '?'} code=${detail.code ?? '?'} ${detail.message ?? String(issue)}`);
      }
      setError(signInErrorMessage(issue));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AppScreen style={styles.authScreen} edges={FULL_SCREEN_EDGES}>
        <View style={styles.authTop}>
          <View style={styles.brandRow}><View style={styles.logoMark}><Text style={styles.logoMarkText}>W</Text></View><Text style={styles.brand}>WorkVoice</Text></View>
          <Pill label="YOUR PRIVATE PRACTICE SPACE" tone="teal" />
          <Title style={styles.authTitle}>Start with the conversations that matter at work.</Title>
          <Body style={styles.authBody}>Sign in to keep your derived feedback and learning path in your private account.</Body>
        </View>
        <Card style={styles.authCard}>
          <Text style={styles.authLabel} nativeID="work-email-label">Work email</Text>
          <TextInput
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (error) setError(undefined);
            }}
            accessibilityLabel="Work email"
            accessibilityLabelledBy="work-email-label"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            placeholder="you@company.com"
            placeholderTextColor="#8A94A6"
            style={[styles.emailInput, error && styles.emailInputError]}
            editable={!isSending}
          />
          {error ? (
            <View style={styles.inlineMessage} accessibilityRole="alert">
              <Icon name="alert-circle" size={iconSize.sm} color={colors.roseText} />
              <Text style={styles.inlineError}>{error}</Text>
            </View>
          ) : sent ? (
            <View style={styles.inlineMessage} accessibilityLiveRegion="polite">
              <Icon name="mail-unread-outline" size={iconSize.sm} color={colors.tealText} />
              <Text style={styles.sentText}>Link sent. Check your inbox, then open it on this device.</Text>
            </View>
          ) : <Text style={styles.authHint}>We’ll email a secure, password-free sign-in link.</Text>}
          <PrimaryButton label={isSending ? 'Sending link…' : sent ? 'Send another link' : 'Email me a sign-in link'} onPress={() => void submit()} loading={isSending} />
        </Card>
        <View style={styles.privacyRow}>
          <Icon name="lock-closed-outline" size={14} color={colors.muted} />
          <Text style={styles.privacyFootnoteInline}>Audio is never used to train public models and is deleted after analysis.</Text>
        </View>
      </AppScreen>
      </KeyboardAvoidingView>
    </>
  );
}

function Onboarding({ onComplete }: { onComplete: (profile: UserProfile) => void }) {
  const [step, setStep] = useState(0);
  const [targetVariety, setTargetVariety] = useState<EnglishVariety>('en-US');
  const [goals, setGoals] = useState<LearningGoal[]>(['meetings', 'interviews']);
  const [baseline, setBaseline] = useState<SpeechAssessment | undefined>();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const toggleGoal = (goal: LearningGoal) => {
    setGoals((current) => {
      if (current.includes(goal)) return current.length === 1 ? current : current.filter((item) => item !== goal);
      return [...current, goal];
    });
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 0 || step === 3 || isAnalyzing) return step !== 0;
      setStep(step - 1);
      return true;
    });
    return () => subscription.remove();
  }, [isAnalyzing, step]);

  const analyzeBaseline = async (audioUri?: string) => {
    setError(undefined);
    setIsAnalyzing(true);
    try {
      const assessment = await assessRecording({ audioUri, targetVariety, exercise: baselineExercise });
      setBaseline(assessment);
      setStep(3);
    } catch (issue) {
      setError(issue instanceof AssessmentError ? issue.message : 'We could not analyze your speech. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (step === 0) {
    return (
      <AppScreen style={styles.onboardingScreen} edges={FULL_SCREEN_EDGES}>
        <View style={styles.heroSpacer} />
        <View style={styles.brandRow}>
          <View style={styles.logoMark}><Text style={styles.logoMarkText}>W</Text></View>
          <Text style={styles.brand}>WorkVoice</Text>
        </View>
        <Pill label="WORKPLACE ENGLISH COACH" tone="teal" />
        <Title style={styles.heroTitle}>Speak with clarity when it matters.</Title>
        <Body style={styles.heroBody}>Practice the conversations that move your work forward, then get one useful next step from your speaking coach.</Body>
        <View style={styles.heroVisual} accessible accessibilityLabel="Example: you say “I have a clear update for the team.” and receive a clarity score of 82.">
          <View style={styles.heroSpeech}>
            <View style={styles.heroSpeechHeader}><Icon name="mic" size={iconSize.sm} color={colors.blue} /><Text style={styles.heroSpeechMeta}>You said</Text></View>
            <Text style={styles.heroSpeechText}>“I have a clear update for the team.”</Text>
          </View>
          <View style={styles.heroScore}><Text style={styles.heroScoreNumber}>82</Text><Text style={styles.heroScoreText}>clarity</Text></View>
        </View>
        <View style={styles.onboardingActions}>
          <PrimaryButton label="Build my practice plan" icon="arrow-forward" onPress={() => { setStep(1); track('onboarding_started'); }} />
          <Text style={styles.privacyFootnote}>Your recordings are analyzed transiently and deleted after feedback.</Text>
        </View>
      </AppScreen>
    );
  }

  if (step === 1) {
    return (
      <AppScreen edges={FULL_SCREEN_EDGES}>
        <StepIndicator current={2} />
        <Eyebrow>Your target</Eyebrow>
        <Title style={styles.stepTitle}>What kind of English do you want to practice?</Title>
        <Body style={styles.stepBody}>Choose the target you hear most often at work. You can change it later.</Body>
        <View style={styles.selectionList}>
          <SelectionCard
            selected={targetVariety === 'en-US'}
            badge="US"
            title="American English"
            description="US pronunciation, rhythm, and intonation coaching"
            onPress={() => setTargetVariety('en-US')}
          />
          <SelectionCard
            selected={targetVariety === 'en-GB'}
            badge="UK"
            title="British English"
            description="UK pronunciation and fluency coaching"
            onPress={() => setTargetVariety('en-GB')}
          />
        </View>
        <Divider />
        <Eyebrow>Your goals</Eyebrow>
        <Title style={styles.miniTitle}>Where do you want to feel more confident?</Title>
        <Text style={styles.goalHelper}>Choose one or both. At least one is needed to build your plan.</Text>
        <View style={styles.goalRow}>
          <ChoiceChip label="Meetings" icon="people-outline" selected={goals.includes('meetings')} onPress={() => toggleGoal('meetings')} />
          <ChoiceChip label="Interviews" icon="briefcase-outline" selected={goals.includes('interviews')} onPress={() => toggleGoal('interviews')} />
        </View>
        <View style={styles.bottomAction}>
          <PrimaryButton label="Continue" icon="arrow-forward" onPress={() => setStep(2)} />
          <SecondaryButton label="Back" onPress={() => setStep(0)} style={styles.backButton} />
        </View>
      </AppScreen>
    );
  }

  if (step === 2) {
    return (
      <AppScreen edges={FULL_SCREEN_EDGES}>
        <StepIndicator current={3} />
        <Eyebrow>Two-minute baseline</Eyebrow>
        <Title style={styles.stepTitle}>Let’s find your best first focus.</Title>
        <Body style={styles.stepBody}>Read the sentence naturally. We’ll use this attempt to tailor the starting exercises, not to judge your accent.</Body>
        <Card style={styles.baselineCard}>
          <Pill label={varietyMeta[targetVariety].label} tone="blue" />
          <Text style={styles.baselinePrompt}>{baselineExercise.referenceText}</Text>
          <Divider />
          {isAnalyzing ? (
            <View style={styles.analyzing} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.blue} /><Text style={styles.analyzingText}>Turning your attempt into a clear next step…</Text></View>
          ) : (
            <RecordingPanel
              promptText={baselineExercise.referenceText ?? baselineExercise.prompt}
              targetVariety={targetVariety}
              allowRemoteVoice
              onRecordingReady={(uri) => void analyzeBaseline(uri)}
            />
          )}
          {isDemoAssessmentMode() && !isAnalyzing ? <SecondaryButton label="Skip and preview sample feedback" onPress={() => void analyzeBaseline()} style={styles.sampleButton} /> : null}
          {error ? <ErrorMessage message={error} /> : null}
        </Card>
        <Text style={styles.privacyFootnote}>Raw audio is not stored in your learning history.</Text>
        <SecondaryButton label="Back" onPress={() => setStep(1)} disabled={isAnalyzing} style={styles.backOnly} />
      </AppScreen>
    );
  }

  return (
    <AppScreen edges={FULL_SCREEN_EDGES}>
      <StepIndicator current={4} />
      <Eyebrow>Your starting point</Eyebrow>
      <Title style={styles.stepTitle}>A practical path for stronger workplace voice.</Title>
      {baseline ? <AssessmentInsight assessment={baseline} /> : null}
      <Card style={styles.pathCard}>
        <Pill label="YOUR FIRST WEEK" tone="teal" />
        <Text style={styles.pathTitle}>Build a clear meeting update</Text>
        <Body>Start with daily stand-ups, then practice a project-status role-play. Each session takes 3–5 minutes.</Body>
        <View style={styles.pathBullets}>
          {['Finish key words clearly', 'Add pauses between ideas', 'Practice confident next steps'].map((item) => (
            <View key={item} style={styles.pathBulletRow}>
              <Icon name="checkmark-circle" size={iconSize.sm} color={colors.teal} />
              <Text style={styles.pathBullet}>{item}</Text>
            </View>
          ))}
        </View>
      </Card>
      <View style={styles.bottomAction}>
        <PrimaryButton
          label="Start my first practice"
          icon="arrow-forward"
          onPress={() =>
            onComplete({
              displayName: 'You',
              targetVariety,
              goals,
              baseline,
              completedOnboarding: true,
              practiceResults: [],
              plan: 'free',
              freePracticesToday: 0,
              hasSeenPrivacyNotice: true,
            })
          }
        />
      </View>
    </AppScreen>
  );
}

function HomeScreen({
  profile,
  onStartExercise,
  onOpenPractice,
  onOpenProfile,
  onUpgrade,
}: {
  profile: UserProfile;
  onStartExercise: (exercise: Exercise) => void;
  onOpenPractice: () => void;
  onOpenProfile: () => void;
  onUpgrade: () => void;
}) {
  const completedIds = profile.practiceResults.map((result) => result.exerciseId);
  const exercise = nextExercise(profile.targetVariety, completedIds);
  const currentScore = profile.practiceResults.at(-1)?.assessment.score.overall ?? profile.baseline?.score.overall ?? 0;
  const usage = normalizedFreeUsage(profile);
  const isBlocked = !canStartPractice(profile);
  const today = localDateKey();
  const completedToday = profile.practiceResults.filter((item) => localDateKey(item.completedAt) === today).length;
  const pathTotal = exercisesFor(profile.targetVariety).length;
  const uniqueCompleted = new Set(completedIds).size;

  return (
    <AppScreen>
      <View style={styles.topBar}>
        <View>
          <Eyebrow>Good to see you</Eyebrow>
          <Title style={styles.homeTitle}>Ready to be heard?</Title>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Profile and settings" onPress={onOpenProfile} hitSlop={4} style={({ pressed }) => [styles.avatar, pressed && styles.cardPressed]}>
          <Icon name="person" size={iconSize.md} color={colors.blue} />
        </Pressable>
      </View>
      <Card style={styles.todayCard}>
        <View style={styles.todayHeader}>
          <View style={styles.todayCopy}>
            <Pill label="TODAY’S PRACTICE" tone="teal" />
            <Text style={styles.todayTitle}>{exercise.title}</Text>
            <Text style={styles.todayDescription}>{exercise.scenario} · {exercise.estimatedMinutes} min</Text>
          </View>
          <View style={[styles.categoryIcon, exercise.category === 'interviews' && styles.categoryIconInterview]}>
            <Icon name={exercise.category === 'meetings' ? 'people-outline' : 'briefcase-outline'} size={iconSize.lg} color={exercise.category === 'meetings' ? colors.blue : colors.tealText} />
          </View>
        </View>
        <Divider />
        <Text style={styles.todayPrompt}>{exercise.mode === 'scripted' ? exercise.referenceText : exercise.prompt}</Text>
        {/* When the free practice is used, keep the button active so it leads to the upgrade path instead of a dead end. */}
        <PrimaryButton
          label={isBlocked ? 'Unlock more practice today' : 'Practice now'}
          icon={isBlocked ? 'lock-open-outline' : 'mic'}
          onPress={() => onStartExercise(exercise)}
          accessibilityHint={isBlocked ? 'Today’s free practice is used. Opens WorkVoice Pro options.' : undefined}
          style={styles.todayButton}
        />
        {isBlocked ? <Text style={styles.blockedHint}>You’ve used today’s free practice. A new one unlocks tomorrow.</Text> : null}
      </Card>
      <View style={styles.statsRow}>
        <Metric value={currentScore ? `${Math.round(currentScore)}` : '—'} label="Current score" caption={profile.practiceResults.length ? 'Latest attempt' : 'Baseline'} />
        <Metric value={`${completedToday}`} label="Today’s sessions" caption={completedToday ? 'Nice work' : 'Start small'} />
        <Metric value={`${uniqueCompleted}/${pathTotal}`} label="Path complete" caption={`${varietyMeta[profile.targetVariety].shortLabel} track`} />
      </View>
      <View style={styles.sectionHeader}>
        <View style={styles.flexShrink}><Eyebrow>Your path</Eyebrow><Text accessibilityRole="header" style={styles.sectionTitle}>Practice for work, not perfection.</Text></View>
        <TextLink label="See all" icon="chevron-forward" onPress={onOpenPractice} accessibilityLabel="See all exercises" />
      </View>
      <View style={styles.pathPreviewRow}>
        <PathPreview order="01" label="Clear updates" done={uniqueCompleted > 0} />
        <PathPreview order="02" label="Confident requests" done={uniqueCompleted > 4} />
        <PathPreview order="03" label="Interview stories" done={uniqueCompleted > 19} />
      </View>
      {profile.plan === 'free' ? <FreePlanNotice used={usage} onUpgrade={onUpgrade} /> : null}
    </AppScreen>
  );
}

function PracticeCatalog({ profile, onStartExercise, onUpgrade }: { profile: UserProfile; onStartExercise: (exercise: Exercise) => void; onUpgrade: () => void }) {
  const [filter, setFilter] = useState<'all' | LearningGoal>('all');
  const exercises = useMemo(
    () => exercisesFor(profile.targetVariety).filter((exercise) => filter === 'all' || exercise.category === filter),
    [filter, profile.targetVariety],
  );
  const completed = new Set(profile.practiceResults.map((result) => result.exerciseId));
  const isBlocked = !canStartPractice(profile);

  return (
    <AppScreen>
      <Eyebrow>Practice studio</Eyebrow>
      <Title style={styles.homeTitle}>Build your work voice.</Title>
      <Body style={styles.catalogIntro}>Short, repeatable speaking sessions for the moments you want to handle with confidence.</Body>
      <View style={styles.filterRow}>
        <ChoiceChip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
        <ChoiceChip label="Meetings" selected={filter === 'meetings'} onPress={() => setFilter('meetings')} />
        <ChoiceChip label="Interviews" selected={filter === 'interviews'} onPress={() => setFilter('interviews')} />
      </View>
      {profile.plan === 'free' ? (
        <View style={[styles.limitBanner, isBlocked && styles.limitBannerBlocked]}>
          <Icon name={isBlocked ? 'lock-closed-outline' : 'time-outline'} size={iconSize.sm} color={isBlocked ? colors.amberText : colors.muted} />
          <Text style={[styles.limitHint, isBlocked && styles.limitHintBlocked]}>
            {isBlocked ? 'Today’s free practice is complete. Pro unlocks unlimited practice.' : 'Free plan: one completed practice per day.'}
          </Text>
          {isBlocked ? <TextLink label="See Pro" onPress={onUpgrade} style={styles.limitLink} /> : null}
        </View>
      ) : <Text style={styles.limitHint}>Pro plan: unlimited practice and retries.</Text>}
      <View style={styles.exerciseList}>
        {exercises.map((exercise) => {
          const isDone = completed.has(exercise.id);
          const categoryLabel = exercise.category === 'meetings' ? 'Meetings' : 'Interviews';
          const modeLabel = exercise.mode === 'scripted' ? 'Read & repeat' : 'Role-play';
          return (
            <Pressable
              key={exercise.id}
              accessibilityRole="button"
              accessibilityLabel={`${exercise.title}. ${categoryLabel}, ${modeLabel}, ${exercise.estimatedMinutes} minutes.${isDone ? ' Completed.' : ''}`}
              accessibilityHint={isBlocked ? 'Locked for today. Opens WorkVoice Pro options.' : exercise.description}
              onPress={() => onStartExercise(exercise)}
              style={({ pressed }) => [styles.exerciseCard, pressed && styles.cardPressed]}
            >
              <View style={[styles.exerciseOrder, isDone && styles.exerciseOrderDone]}>
                {isDone ? <Icon name="checkmark" size={iconSize.sm} color={colors.tealText} /> : <Text style={styles.exerciseOrderText}>{String(exercise.order).padStart(2, '0')}</Text>}
              </View>
              <View style={styles.exerciseCopy}>
                <View style={styles.exerciseMeta}><Pill label={categoryLabel} tone={exercise.category === 'meetings' ? 'blue' : 'teal'} /><Pill label={modeLabel} tone="gray" /><Pill label={`${exercise.estimatedMinutes} min`} tone="gray" icon="time-outline" /></View>
                <Text style={styles.exerciseTitle}>{exercise.title}</Text>
                <Text style={styles.exerciseDescription}>{exercise.description}</Text>
              </View>
              <Icon name={isBlocked ? 'lock-closed-outline' : 'chevron-forward'} size={iconSize.md} color={isBlocked ? colors.muted : colors.blue} />
            </Pressable>
          );
        })}
      </View>
    </AppScreen>
  );
}

function PracticeSession({
  exercise,
  onBack,
  onAssessment,
}: {
  exercise: Exercise;
  onBack: () => void;
  onAssessment: (assessment: SpeechAssessment, recordingUri?: string) => void;
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const isActiveRef = useRef(true);

  useEffect(() => () => {
    isActiveRef.current = false;
  }, []);

  const analyze = async (audioUri?: string) => {
    setError(undefined);
    setIsAnalyzing(true);
    try {
      const assessment = await assessRecording(
        { audioUri, targetVariety: exercise.targetVariety, exercise },
        { retainLocalRecording: Boolean(audioUri) },
      );
      if (!isActiveRef.current) {
        discardLocalRecording(audioUri);
        return;
      }
      onAssessment(assessment, audioUri);
    } catch (issue) {
      if (isActiveRef.current) setError(issue instanceof AssessmentError ? issue.message : 'We could not analyze this attempt. Please try again.');
    } finally {
      if (isActiveRef.current) setIsAnalyzing(false);
    }
  };
  const spokenText = exercise.referenceText ?? exercise.prompt;

  return (
    <AppScreen edges={FULL_SCREEN_EDGES}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to practice studio" onPress={onBack} disabled={isAnalyzing} hitSlop={8} style={({ pressed }) => [styles.backLink, pressed && styles.textPressed, isAnalyzing && styles.dimmed]}>
        <Icon name="chevron-back" size={iconSize.md} color={colors.blue} />
        <Text style={styles.backLinkText}>Practice studio</Text>
      </Pressable>
      <View style={styles.sessionHeader}>
        <Pill label={exercise.mode === 'scripted' ? 'READ & REPEAT' : 'WORKPLACE ROLE-PLAY'} tone="teal" />
        <Text accessibilityRole="header" style={styles.sessionTitle}>{exercise.title}</Text>
        <Body>{exercise.description}</Body>
      </View>
      <Card style={styles.promptCard}>
        <Text style={styles.promptLabel}>{exercise.mode === 'scripted' ? 'Say this naturally' : 'Your prompt'}</Text>
        <Text style={styles.promptText}>{spokenText}</Text>
        <Divider />
        <View style={styles.coachTipRow} accessible accessibilityLabel={`Coach tip: ${exercise.coachTip}`}>
          <Icon name="bulb-outline" size={iconSize.md} color={colors.tealText} />
          <Text style={styles.coachTip}>{exercise.coachTip}</Text>
        </View>
      </Card>
      <Card style={styles.recordCard}>
        {isAnalyzing ? (
          <View style={styles.analysisLoading} accessibilityLiveRegion="polite"><ActivityIndicator size="large" color={colors.blue} /><Text style={styles.analysisTitle}>Analyzing your attempt</Text><Text style={styles.analysisBody}>This usually takes a few seconds.</Text></View>
        ) : (
          <>
            <RecordingPanel
              promptText={spokenText}
              targetVariety={exercise.targetVariety}
              allowRemoteVoice={exercise.mode === 'scripted'}
              onRecordingReady={(uri) => void analyze(uri)}
            />
            {isDemoAssessmentMode() ? <SecondaryButton label="Skip and preview sample feedback" onPress={() => void analyze()} style={styles.sampleButton} /> : null}
            {error ? <ErrorMessage message={error} /> : null}
          </>
        )}
      </Card>
      <Text style={styles.privacyFootnote}>Your recording stays on this device only while you compare it with the model, then it is deleted. Only feedback and progress are retained.</Text>
    </AppScreen>
  );
}

function ResultScreen({
  exercise,
  assessment,
  recordingUri,
  canRetry,
  onRetry,
  onComplete,
}: {
  exercise: Exercise;
  assessment: SpeechAssessment;
  recordingUri?: string;
  canRetry: boolean;
  onRetry: () => void;
  onComplete: () => void;
}) {
  const modelText = (exercise.referenceText ?? assessment.transcript) || exercise.prompt;
  const modelLabel = exercise.referenceText ? 'Reference pronunciation' : 'Model your response';
  // Role-play model text is the learner's own transcript, so it stays on the
  // device voice; only scripted exercises use the provider voice.
  const allowRemoteVoice = exercise.mode === 'scripted';
  const modelVoice = useModelVoice();
  const wordKey = (word: string) => `word:${word}`;
  const playCorrectWord = (word: string) => {
    if (modelVoice.activeKey === wordKey(word)) {
      modelVoice.stop();
      return;
    }
    void modelVoice.play({ key: wordKey(word), text: word, variety: exercise.targetVariety, pace: 'word', allowRemote: allowRemoteVoice });
  };
  const keyToWord = (key?: string) => (key?.startsWith('word:') ? key.slice(5) : undefined);

  return (
    <AppScreen edges={FULL_SCREEN_EDGES}>
      <Eyebrow>Practice complete</Eyebrow>
      <Title style={styles.resultTitle}>Your pronunciation map is ready.</Title>
      <Body style={styles.resultSubtitle}>Listen for one difference, adjust one detail, then try the phrase again.</Body>
      <AssessmentInsight assessment={assessment} />
      <PronunciationComparison
        learnerRecordingUri={recordingUri}
        modelText={modelText}
        modelLabel={modelLabel}
        targetVariety={exercise.targetVariety}
        modelVoice={modelVoice}
        allowRemoteModel={allowRemoteVoice}
      />
      <Card style={styles.feedbackCard}>
        <Text accessibilityRole="header" style={styles.cardHeading}>Where to improve</Text>
        <Text style={styles.feedbackIntro}>Each card shows the word to revisit, why it needs attention, and a model you can hear.</Text>
        <WordFeedbackList
          assessment={assessment}
          onPlayWord={playCorrectWord}
          activeWord={keyToWord(modelVoice.activeKey)}
          loadingWord={keyToWord(modelVoice.loadingKey)}
        />
        <Divider />
        <View style={styles.drillHeader}>
          <Icon name="repeat" size={iconSize.md} color={colors.tealText} />
          <Text accessibilityRole="header" style={styles.cardHeading}>Try this drill</Text>
        </View>
        <Text style={styles.drillText}>{assessment.nextDrill}</Text>
      </Card>
      <Card style={styles.transcriptCard}>
        <Pill label="TRANSCRIPT" tone="gray" />
        <Text style={styles.transcriptLegend}>Highlighted words are your clearest pronunciation focus.</Text>
        <HighlightedTranscript transcript={assessment.transcript} feedback={assessment.flaggedWords} />
        {assessment.isDemo ? (
          <View style={styles.inlineMessage}>
            <Icon name="information-circle-outline" size={iconSize.sm} color={colors.amberText} />
            <Text style={styles.demoNote}>This is sample feedback for preview. It is not based on your voice.</Text>
          </View>
        ) : null}
      </Card>
      <View style={styles.resultActions}>
        <PrimaryButton label="Save & continue" icon="checkmark" onPress={onComplete} />
        {canRetry ? <SecondaryButton label="Retry this exercise" icon="refresh" onPress={onRetry} style={styles.backButton} /> : null}
      </View>
    </AppScreen>
  );
}

function ProgressScreen({ profile, onStartPractice }: { profile: UserProfile; onStartPractice: () => void }) {
  const latest = profile.practiceResults.at(-1)?.assessment ?? profile.baseline;
  const baseline = profile.baseline;
  const scoreChange = latest && baseline ? Math.round(latest.score.overall - baseline.score.overall) : 0;
  const completedThisWeek = profile.practiceResults.filter((result) => Date.now() - new Date(result.completedAt).getTime() < 7 * 24 * 60 * 60 * 1000).length;
  const history = profile.practiceResults.slice(-5).reverse();
  return (
    <AppScreen>
      <Eyebrow>Your progress</Eyebrow>
      <Title style={styles.homeTitle}>Progress you can hear.</Title>
      <Body style={styles.catalogIntro}>Scores show a trend, not a judgment. The most useful signal is consistent practice.</Body>
      <Card style={styles.progressHero}>
        <ScoreBadge score={latest?.score.overall ?? 0} label="current score" />
        <View style={styles.progressHeroCopy}>
          <Text style={styles.progressHeadline} accessibilityRole="header">{scoreChange > 0 ? `+${scoreChange} since baseline` : scoreChange < 0 ? `${scoreChange} since baseline` : 'Your starting point'}</Text>
          <Text style={styles.progressSubline}>{profile.practiceResults.length ? `${profile.practiceResults.length} completed practices` : 'Complete a practice to see your trend.'}</Text>
          <Pill label={`${completedThisWeek} this week`} tone="teal" />
        </View>
      </Card>
      {latest ? <Card style={styles.progressScores}><Text accessibilityRole="header" style={styles.cardHeading}>Current feedback areas</Text><ScoreBreakdownView score={latest.score} /></Card> : null}
      <View style={styles.sectionHeader}><View><Eyebrow>Recent sessions</Eyebrow><Text accessibilityRole="header" style={styles.sectionTitle}>Your practice history</Text></View></View>
      {history.length ? history.map((item) => (
        <Card key={item.completedAt} style={styles.historyCard}>
          <View style={styles.historyTop}><Text style={styles.historyTitle}>{exerciseName(item.exerciseId, profile.targetVariety)}</Text><ScoreBadge score={item.assessment.score.overall} compact /></View>
          <Text style={styles.historyDate}>{formatDate(item.completedAt)} · {item.assessment.isDemo ? 'Sample feedback' : 'Speech feedback'}</Text>
        </Card>
      )) : <EmptyHistory onStartPractice={onStartPractice} />}
    </AppScreen>
  );
}

function ProfileScreen({
  profile,
  onUpdate,
  onReset,
  onUpgrade,
  onSignOut,
}: {
  profile: UserProfile;
  onUpdate: (updater: (profile: UserProfile) => UserProfile) => void;
  onReset: () => Promise<void>;
  onUpgrade: () => void;
  onSignOut?: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  useEffect(() => { track('privacy_viewed'); }, []);
  const changeTarget = (targetVariety: EnglishVariety) => {
    if (targetVariety === profile.targetVariety) return;
    onUpdate((current) => ({ ...current, targetVariety }));
    Alert.alert('Practice target updated', `Your next exercises will use ${varietyMeta[targetVariety].label}. Your existing progress remains visible.`);
  };
  const deleteData = () => {
    Alert.alert('Delete your learning data?', 'This permanently removes your profile, scores, and progress from this device and, if you are signed in, from your WorkVoice account. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete data', style: 'destructive',
        onPress: () => {
          setIsDeleting(true);
          void onReset()
            .catch(() => Alert.alert('Could not delete your data', 'Your account could not be deleted, so nothing was removed from this device either. Check your connection and try again.'))
            .finally(() => setIsDeleting(false));
        },
      },
    ]);
  };
  return (
    <AppScreen>
      <Eyebrow>Profile & privacy</Eyebrow>
      <Title style={styles.homeTitle}>Your learning settings.</Title>
      <Card style={styles.profilePlanCard}>
        <View style={styles.profilePlanTop}>
          <View style={styles.flexShrink}><Pill label={profile.plan === 'pro' ? 'PRO PLAN' : 'FREE PLAN'} tone={profile.plan === 'pro' ? 'teal' : 'blue'} /><Text style={styles.profilePlanTitle}>{profile.plan === 'pro' ? 'Unlimited workplace practice' : 'One daily practice'}</Text></View>
          <View style={[styles.planIcon, profile.plan === 'pro' && styles.planIconPro]}><Icon name={profile.plan === 'pro' ? 'sparkles' : 'calendar-outline'} size={iconSize.lg} color={profile.plan === 'pro' ? colors.tealText : colors.blue} /></View>
        </View>
        <Body>{profile.plan === 'pro' ? 'All exercises, unlimited retries, and full progress history are available.' : 'Practice once a day for free. Pro adds unlimited practice and retries.'}</Body>
        {profile.plan === 'free' ? <PrimaryButton label="See Pro options" icon="sparkles-outline" onPress={onUpgrade} style={styles.planButton} /> : null}
      </Card>
      <Text accessibilityRole="header" style={styles.settingsHeading}>Target English</Text>
      <View style={styles.selectionList}>
        <SelectionCard selected={profile.targetVariety === 'en-US'} badge="US" title="American English" description="Includes rhythm and intonation feedback" onPress={() => changeTarget('en-US')} compact />
        <SelectionCard selected={profile.targetVariety === 'en-GB'} badge="UK" title="British English" description="Includes clarity and fluency feedback" onPress={() => changeTarget('en-GB')} compact />
      </View>
      <Text accessibilityRole="header" style={styles.settingsHeading}>Voice privacy</Text>
      <Card style={styles.privacyCard}>
        <View style={styles.privacyTitleRow}>
          <Icon name="shield-checkmark-outline" size={iconSize.md} color={colors.tealText} />
          <Text style={styles.privacyTitle}>Your recordings are temporary</Text>
        </View>
        <Body>Audio is sent only to analyze an attempt, then deleted. Your history keeps derived scores, feedback, and completion data—not raw recordings.</Body>
        {isModelVoiceAvailable() ? (
          <Text style={styles.privacyDetail}>Model pronunciations for scripted exercises are generated by ElevenLabs from the exercise text. Your own words and recordings are never sent to it.</Text>
        ) : null}
      </Card>
      {onSignOut ? (
        <>
          <Text accessibilityRole="header" style={styles.settingsHeading}>Account</Text>
          <SecondaryButton label="Sign out" icon="log-out-outline" onPress={onSignOut} style={styles.signOutButton} />
        </>
      ) : null}
      {/* Destructive action is separated from normal settings and confirmed first. */}
      <View style={styles.dangerZone}>
        <Text style={styles.dangerHeading}>Delete data</Text>
        <Text style={styles.privacyDetail}>Removes your profile, scores, and progress. This cannot be undone.</Text>
        <SecondaryButton label={isDeleting ? 'Deleting data…' : 'Delete my learning data'} icon="trash-outline" tone="danger" onPress={deleteData} disabled={isDeleting} style={styles.deleteButton} />
      </View>
    </AppScreen>
  );
}

const navTabs: Array<{ id: Tab; icon: IconName; activeIcon: IconName; label: string }> = [
  { id: 'home', icon: 'home-outline', activeIcon: 'home', label: 'Home' },
  { id: 'practice', icon: 'mic-outline', activeIcon: 'mic', label: 'Practice' },
  { id: 'progress', icon: 'stats-chart-outline', activeIcon: 'stats-chart', label: 'Progress' },
  { id: 'profile', icon: 'person-outline', activeIcon: 'person', label: 'Profile' },
];

function BottomNav({ active, onChange, glass }: { active: Tab; onChange: (tab: Tab) => void; glass: boolean }) {
  const insets = useSafeAreaInsets();
  const items = navTabs.map((item) => {
    const isActive = active === item.id;
    return (
      <Pressable
        key={item.id}
        accessibilityRole="tab"
        accessibilityLabel={item.label}
        accessibilityState={{ selected: isActive }}
        onPress={() => onChange(item.id)}
        style={({ pressed }) => [styles.navItem, pressed && styles.textPressed]}
      >
        <View style={[styles.navIndicator, isActive && styles.navIndicatorActive]}>
          <Icon name={isActive ? item.activeIcon : item.icon} size={iconSize.lg} color={isActive ? colors.blue : colors.muted} />
        </View>
        <Text style={[styles.navLabel, glass && styles.navLabelOnGlass, isActive && styles.navActive]}>{item.label}</Text>
      </Pressable>
    );
  });

  if (glass) {
    // iOS 26: a floating Liquid Glass bar; screen content scrolls underneath it
    // (AppScreen reserves the space via FloatingBarInsetContext).
    return (
      <View pointerEvents="box-none" style={[styles.floatingNavWrap, { bottom: Math.max(insets.bottom, FLOATING_BAR_GAP) }]}>
        <GlassView
          accessibilityRole="tablist"
          glassEffectStyle="regular"
          colorScheme="light"
          tintColor="rgba(255,255,255,0.55)"
          style={styles.floatingNav}
        >
          {items}
        </GlassView>
      </View>
    );
  }

  return (
    <View accessibilityRole="tablist" style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items}
    </View>
  );
}

function PaywallModal({
  visible,
  glass,
  onClose,
  onPurchase,
  onRestore,
}: {
  visible: boolean;
  glass: boolean;
  onClose: () => void;
  onPurchase: () => Promise<string>;
  onRestore: () => Promise<string>;
}) {
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | undefined>();
  const liveBilling = isRevenueCatConfigured();
  const insets = useSafeAreaInsets();
  const close = () => {
    if (isPurchasing) return;
    setMessage(undefined);
    onClose();
  };
  const buy = async () => {
    setIsPurchasing(true);
    setMessage(undefined);
    try {
      const outcome = await onPurchase();
      if (outcome === 'free') setMessage({ tone: 'error', text: 'Your purchase did not include Pro access. Please try again or contact support.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'We could not complete that purchase. Please try again.' });
    } finally {
      setIsPurchasing(false);
    }
  };
  const restore = async () => {
    setIsPurchasing(true);
    setMessage(undefined);
    try {
      const outcome = await onRestore();
      setMessage(outcome === 'pro'
        ? { tone: 'success', text: 'Your Pro access has been restored.' }
        : { tone: 'error', text: 'No active Pro purchase was found for this account.' });
    } catch {
      setMessage({ tone: 'error', text: 'We could not restore purchases right now. Please try again.' });
    } finally {
      setIsPurchasing(false);
    }
  };
  const sheetContent = (
    <>
          <View style={styles.modalHandle} />
          <View style={styles.paywallHeader}>
            <Pill label="WORKVOICE PRO" tone="teal" icon="sparkles" />
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={styles.closeButton}>
              <Icon name="close" size={iconSize.md} color={colors.muted} />
            </Pressable>
          </View>
          <Text accessibilityRole="header" style={styles.paywallTitle}>Keep your momentum going.</Text>
          <Text style={styles.paywallBody}>Unlock unlimited workplace practices, retries, and progress history.</Text>
          <View style={styles.paywallFeatures}>
            {['Unlimited daily speaking practice', 'Full meeting and interview paths', 'Personal progress history'].map((feature) => (
              <View key={feature} style={styles.paywallFeatureRow}>
                <Icon name="checkmark-circle" size={iconSize.md} color={colors.teal} />
                <Text style={styles.paywallFeature}>{feature}</Text>
              </View>
            ))}
          </View>
          <PrimaryButton label={isPurchasing ? 'Working…' : liveBilling ? 'Unlock Pro' : 'Preview Pro access'} onPress={() => void buy()} loading={isPurchasing} />
          {liveBilling ? <TextLink label="Restore purchases" onPress={() => void restore()} disabled={isPurchasing} style={styles.restoreLink} /> : null}
          <SecondaryButton label="Maybe later" onPress={close} disabled={isPurchasing} style={styles.backButton} />
          {message ? (
            <View style={styles.inlineMessage} accessibilityRole={message.tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite">
              <Icon name={message.tone === 'error' ? 'alert-circle' : 'checkmark-circle'} size={iconSize.sm} color={message.tone === 'error' ? colors.roseText : colors.tealText} />
              <Text style={[styles.billingMessage, message.tone === 'success' && styles.billingSuccess]}>{message.text}</Text>
            </View>
          ) : null}
          <Text style={styles.previewNotice}>{liveBilling ? 'Subscriptions are securely processed by the App Store or Google Play.' : 'Preview mode: no payment is taken.'}</Text>
    </>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.modalBackdrop, glass && styles.modalBackdropGlass]}>
        {/* Tapping the dimmed area dismisses the sheet, like a native bottom sheet. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
        {glass ? (
          <GlassView
            glassEffectStyle="regular"
            colorScheme="light"
            tintColor="rgba(255,255,255,0.78)"
            style={[styles.paywall, styles.paywallGlass, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
            accessibilityViewIsModal
          >
            {sheetContent}
          </GlassView>
        ) : (
          <View style={[styles.paywall, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]} accessibilityViewIsModal>
            {sheetContent}
          </View>
        )}
      </View>
    </Modal>
  );
}

function StepIndicator({ current, total = 4 }: { current: number; total?: number }) {
  return (
    <View style={styles.stepWrap} accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${current} of ${total}`} accessibilityValue={{ min: 1, max: total, now: current }}>
      <View style={styles.stepIndicator}>{Array.from({ length: total }, (_, index) => index + 1).map((number) => <View key={number} style={[styles.stepDot, number <= current && styles.stepDotActive]} />)}</View>
      <Text style={styles.stepText}>Step {current} of {total}</Text>
    </View>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <View style={[styles.inlineMessage, styles.centered]} accessibilityRole="alert">
      <Icon name="alert-circle" size={iconSize.sm} color={colors.roseText} />
      <Text style={styles.inlineError}>{message}</Text>
    </View>
  );
}

function SelectionCard({ selected, badge, title, description, onPress, compact = false }: { selected: boolean; badge: string; title: string; description: string; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={`${title}. ${description}`} accessibilityState={{ selected, checked: selected }} onPress={onPress} style={({ pressed }) => [styles.selectionCard, compact && styles.selectionCardCompact, selected && styles.selectionCardSelected, pressed && styles.cardPressed]}>
      <View style={[styles.varietyBadge, selected && styles.varietyBadgeSelected]}><Text style={[styles.varietyBadgeText, selected && styles.varietyBadgeTextSelected]}>{badge}</Text></View>
      <View style={styles.selectionCopy}><Text style={styles.selectionTitle}>{title}</Text><Text style={styles.selectionDescription}>{description}</Text></View>
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioInner} /> : null}</View>
    </Pressable>
  );
}

function ChoiceChip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: IconName }) {
  const color = selected ? colors.blue : colors.muted;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.choiceChip, selected && styles.choiceChipSelected, pressed && styles.textPressed]}
    >
      <Icon name={selected ? 'checkmark' : icon ?? 'add'} size={iconSize.sm} color={color} />
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function PathPreview({ order, label, done }: { order: string; label: string; done: boolean }) {
  return (
    <View style={styles.pathPreview} accessible accessibilityLabel={`Stage ${Number(order)}: ${label}. ${done ? 'Started' : 'Not started yet'}.`}>
      <View style={[styles.pathNumber, done && styles.pathNumberDone]}>
        {done ? <Icon name="checkmark" size={iconSize.sm} color={colors.tealText} /> : <Text style={styles.pathNumberText}>{order}</Text>}
      </View>
      <Text style={styles.pathPreviewLabel}>{label}</Text>
    </View>
  );
}

function FreePlanNotice({ used, onUpgrade }: { used: number; onUpgrade: () => void }) {
  return (
    <Card style={styles.freeNotice}>
      <View style={styles.freeNoticeTop}><Text style={styles.freeNoticeTitle}>Your free plan</Text><Pill label={`${used} of 1 used today`} tone="amber" /></View>
      <Body style={styles.freeNoticeBody}>Keep your daily habit, or unlock unlimited practice when you are ready.</Body>
      <TextLink label="See Pro options" icon="arrow-forward" onPress={onUpgrade} />
    </Card>
  );
}

function EmptyHistory({ onStartPractice }: { onStartPractice: () => void }) {
  return (
    <Card style={styles.emptyHistory}>
      <View style={styles.emptyIcon}><Icon name="mic-outline" size={iconSize.lg} color={colors.tealText} /></View>
      <Text style={styles.emptyTitle}>Your first session will appear here.</Text>
      <Body style={styles.emptyBody}>Complete a short practice and we’ll turn it into a useful progress snapshot.</Body>
      <TextLink label="Choose a practice" icon="arrow-forward" onPress={onStartPractice} style={styles.centeredLink} />
    </Card>
  );
}

function exerciseName(exerciseId: string, variety: EnglishVariety): string {
  return exercisesFor(variety).find((exercise) => exercise.id === exerciseId)?.title ?? 'Practice session';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value));
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  centered: { justifyContent: 'center' },
  textPressed: { opacity: 0.6 },
  dimmed: { opacity: 0.45 },
  inlineMessage: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  inlineError: { flexShrink: 1, color: colors.roseText, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  mainArea: { flex: 1 },
  loadingScreen: { flex: 1, backgroundColor: '#F5F7FB', alignItems: 'center', justifyContent: 'center' },
  logoMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  logoMarkText: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  loadingBrand: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 10 },
  loader: { marginTop: 22 },
  authScreen: { paddingTop: 32 },
  authTop: { gap: 13 },
  authTitle: { fontSize: 35, lineHeight: 41, marginTop: 6 },
  authBody: { fontSize: 16, lineHeight: 24, maxWidth: 355 },
  authCard: { marginTop: 34, gap: 10 },
  authLabel: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  emailInput: { height: 52, borderWidth: 1.5, borderColor: '#C3CCDB', borderRadius: 14, paddingHorizontal: 14, color: colors.ink, fontSize: 16, backgroundColor: '#FBFCFE' },
  emailInputError: { borderColor: colors.rose },
  authHint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 5 },
  sentText: { flexShrink: 1, color: colors.tealText, fontSize: 14, fontWeight: '700', lineHeight: 20, marginBottom: 5 },
  privacyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18, paddingHorizontal: 12 },
  privacyFootnoteInline: { flexShrink: 1, color: colors.muted, fontSize: 12, lineHeight: 17 },
  onboardingScreen: { paddingBottom: 18 },
  heroSpacer: { flex: 0.14 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 32 },
  brand: { color: colors.ink, fontSize: 21, fontWeight: '900', letterSpacing: -0.5 },
  heroTitle: { fontSize: 40, lineHeight: 45, marginTop: 14, maxWidth: 350 },
  heroBody: { fontSize: 17, lineHeight: 25, marginTop: 14, maxWidth: 350 },
  heroVisual: { height: 190, marginTop: 32, justifyContent: 'center' },
  heroSpeech: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 21, width: '83%', borderWidth: 1, borderColor: colors.line, shadowColor: '#24314B', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 7 }, shadowRadius: 16, elevation: 2 },
  heroSpeechText: { color: colors.ink, fontSize: 18, lineHeight: 26, fontWeight: '700' },
  heroSpeechHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  heroSpeechMeta: { color: colors.blue, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  heroScore: { position: 'absolute', right: 4, bottom: 0, width: 92, height: 92, borderRadius: 46, backgroundColor: colors.tealText, alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: '#B7EFE5' },
  heroScoreNumber: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  heroScoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  onboardingActions: { marginTop: 'auto', gap: 12 },
  privacyFootnote: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 12 },
  stepWrap: { gap: 8, marginBottom: 22, marginTop: 4 },
  stepIndicator: { flexDirection: 'row', gap: 6 },
  stepText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  stepDot: { height: 5, flex: 1, borderRadius: 99, backgroundColor: '#DEE4EF' },
  stepDotActive: { backgroundColor: colors.blue },
  stepTitle: { marginTop: 7, maxWidth: 370 },
  stepBody: { marginTop: 10, marginBottom: 24, fontSize: 16, lineHeight: 24 },
  selectionList: { gap: 11, marginTop: 18 },
  selectionCard: { minHeight: 88, borderRadius: 18, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectionCardCompact: { minHeight: 74, paddingVertical: 12 },
  selectionCardSelected: { borderColor: colors.blue, backgroundColor: '#F6F8FF' },
  varietyBadge: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#EFF2F6', alignItems: 'center', justifyContent: 'center' },
  varietyBadgeSelected: { backgroundColor: colors.blueSoft },
  varietyBadgeText: { color: '#5A6478', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  varietyBadgeTextSelected: { color: '#2F51E0' },
  selectionCopy: { flex: 1, gap: 3 },
  selectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  selectionDescription: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#C6CFDF', alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.blue },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.blue },
  miniTitle: { color: colors.ink, fontSize: 19, lineHeight: 25, fontWeight: '800', marginTop: 7 },
  goalHelper: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  goalRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  choiceChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#C3CCDB' },
  choiceChipSelected: { backgroundColor: colors.blueSoft, borderColor: colors.blue },
  choiceChipText: { color: colors.muted, fontSize: 14, fontWeight: '800' },
  choiceChipTextSelected: { color: colors.blue },
  bottomAction: { marginTop: 'auto', paddingTop: 28, gap: 10 },
  backButton: { minHeight: 46 },
  baselineCard: { gap: 14 },
  baselinePrompt: { color: colors.ink, fontSize: 22, lineHeight: 31, fontWeight: '700', letterSpacing: -0.2 },
  analyzing: { minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: 13 },
  analyzingText: { color: colors.ink, fontSize: 15, textAlign: 'center', fontWeight: '700' },
  sampleButton: { minHeight: 44 },
  backOnly: { marginTop: 22 },
  pathCard: { gap: 10, marginTop: 15 },
  pathTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  pathBullets: { gap: 8, marginTop: 4 },
  pathBulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pathBullet: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 21 },
  homeTitle: { fontSize: 28, marginTop: 4 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#DDE5FF', alignItems: 'center', justifyContent: 'center' },
  todayCard: { backgroundColor: '#FFFFFF', borderColor: '#DCE4FE', gap: 3 },
  todayHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  todayCopy: { flex: 1, gap: 6 },
  todayTitle: { color: colors.ink, fontSize: 21, lineHeight: 26, fontWeight: '900', marginTop: 3 },
  todayDescription: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  categoryIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.blueSoft, alignItems: 'center', justifyContent: 'center' },
  categoryIconInterview: { backgroundColor: colors.tealSoft },
  blockedHint: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  todayPrompt: { color: colors.ink, fontSize: 16, lineHeight: 24, fontWeight: '600', marginBottom: 10 },
  todayButton: { marginTop: 3 },
  statsRow: { flexDirection: 'row', gap: 12, paddingVertical: 23 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 5, marginBottom: 12 },
  sectionTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: '800', marginTop: 4 },
  pathPreviewRow: { flexDirection: 'row', gap: 8 },
  pathPreview: { flex: 1, minHeight: 114, padding: 12, borderRadius: 17, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, gap: 12 },
  pathNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF2F6' },
  pathNumberDone: { backgroundColor: colors.tealSoft },
  pathNumberText: { color: colors.muted, fontSize: 12, fontWeight: '900' },
  pathPreviewLabel: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  freeNotice: { marginTop: 21, gap: 8, padding: 16 },
  freeNoticeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  freeNoticeTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  freeNoticeBody: { fontSize: 14, lineHeight: 20 },
  catalogIntro: { marginTop: 9, fontSize: 15, lineHeight: 22 },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 20, flexWrap: 'wrap' },
  limitHint: { flexShrink: 1, color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 14 },
  limitBanner: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  limitBannerBlocked: { backgroundColor: colors.amberSoft, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  limitHintBlocked: { color: colors.amberText, fontWeight: '700', marginTop: 0, flex: 1 },
  limitLink: { minHeight: 40 },
  exerciseList: { gap: 10, marginTop: 16 },
  exerciseCard: { minHeight: 112, borderRadius: 19, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardPressed: { opacity: 0.86, transform: [{ scale: 0.992 }] },
  exerciseOrder: { width: 33, height: 33, borderRadius: 16.5, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  exerciseOrderDone: { backgroundColor: colors.tealSoft },
  exerciseOrderText: { color: colors.blue, fontSize: 12, fontWeight: '900' },
  exerciseCopy: { flex: 1, gap: 5 },
  exerciseMeta: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  exerciseTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  exerciseDescription: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  backLink: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -4, marginBottom: 11 },
  backLinkText: { color: colors.blue, fontSize: 14, fontWeight: '800' },
  sessionHeader: { gap: 8, marginBottom: 18 },
  sessionTitle: { color: colors.ink, fontSize: 29, lineHeight: 35, fontWeight: '900', letterSpacing: -0.6 },
  promptCard: { gap: 10 },
  promptLabel: { color: colors.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '800' },
  promptText: { color: colors.ink, fontSize: 21, lineHeight: 30, fontWeight: '700' },
  coachTipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  coachTip: { flex: 1, color: colors.tealText, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  recordCard: { marginTop: 14, minHeight: 230, justifyContent: 'center' },
  analysisLoading: { minHeight: 175, alignItems: 'center', justifyContent: 'center', gap: 10 },
  analysisTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: 4 },
  analysisBody: { color: colors.muted, fontSize: 14 },
  resultTitle: { marginTop: 6 },
  resultSubtitle: { marginTop: 9, marginBottom: 18 },
  feedbackCard: { gap: 12, marginTop: 15 },
  cardHeading: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  feedbackIntro: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  drillHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drillText: { color: colors.tealText, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  transcriptCard: { gap: 10, marginTop: 15 },
  transcript: { color: colors.ink, fontSize: 16, lineHeight: 24, fontStyle: 'italic' },
  transcriptLegend: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  demoNote: { flexShrink: 1, color: colors.amberText, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  resultActions: { gap: 10, marginTop: 21 },
  progressHero: { flexDirection: 'row', gap: 16, alignItems: 'center', marginTop: 20 },
  progressHeroCopy: { flex: 1, gap: 6 },
  progressHeadline: { color: colors.ink, fontSize: 19, lineHeight: 25, fontWeight: '900' },
  progressSubline: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  progressScores: { marginTop: 15, gap: 15 },
  historyCard: { marginBottom: 9, padding: 15 },
  historyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  historyTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', flex: 1 },
  historyDate: { color: colors.muted, fontSize: 13, marginTop: 6 },
  emptyHistory: { alignItems: 'center', paddingVertical: 28, gap: 7 },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tealSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  centeredLink: { alignSelf: 'center' },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptyBody: { textAlign: 'center', fontSize: 14, lineHeight: 20, maxWidth: 280 },
  profilePlanCard: { gap: 10, marginTop: 18 },
  profilePlanTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  profilePlanTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: 8 },
  planIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.blueSoft, alignItems: 'center', justifyContent: 'center' },
  planIconPro: { backgroundColor: colors.tealSoft },
  planButton: { marginTop: 4 },
  settingsHeading: { color: colors.ink, fontWeight: '800', fontSize: 17, marginTop: 24 },
  privacyCard: { gap: 9, marginTop: 12 },
  privacyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  privacyTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  privacyDetail: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  signOutButton: { marginTop: 12, minHeight: 48 },
  dangerZone: { marginTop: 36, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.line, gap: 6 },
  dangerHeading: { color: colors.roseText, fontWeight: '800', fontSize: 15 },
  deleteButton: { marginTop: 8, minHeight: 48 },
  bottomNav: { backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 6 },
  navItem: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 2 },
  navIndicator: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  navIndicatorActive: { backgroundColor: colors.blueSoft },
  navLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  navActive: { color: colors.blue, fontWeight: '800' },
  // Darker inactive label on glass: content behind the bar varies, so keep headroom above 4.5:1.
  navLabelOnGlass: { color: '#475467' },
  floatingNavWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  floatingNav: { width: '100%', maxWidth: 480, height: FLOATING_BAR_HEIGHT, borderRadius: FLOATING_BAR_HEIGHT / 2, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, overflow: 'hidden' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,36,58,0.42)' },
  // A lighter scrim keeps the glass sheet bright so its dark text stays legible.
  modalBackdropGlass: { backgroundColor: 'rgba(23,36,58,0.22)' },
  paywallGlass: { backgroundColor: 'transparent', overflow: 'hidden' },
  paywall: { width: '100%', maxWidth: 640, alignSelf: 'center', backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 13 },
  modalHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#D8DEE9', alignSelf: 'center', marginBottom: 6 },
  paywallHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F4F8', marginRight: -6 },
  paywallTitle: { color: colors.ink, fontSize: 27, lineHeight: 32, fontWeight: '900', letterSpacing: -0.5 },
  paywallBody: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  paywallFeatures: { gap: 10, backgroundColor: '#F5F8FF', padding: 14, borderRadius: 15 },
  paywallFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paywallFeature: { flexShrink: 1, color: colors.ink, fontSize: 15, fontWeight: '700' },
  restoreLink: { alignSelf: 'center' },
  billingMessage: { flexShrink: 1, color: colors.roseText, fontSize: 14, lineHeight: 20 },
  billingSuccess: { color: colors.tealText },
  previewNotice: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 17 },
});
