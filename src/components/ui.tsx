import { ComponentProps, createContext, ReactNode, useContext, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

export const colors = {
  ink: '#17243A',
  muted: '#667085',
  canvas: '#F5F7FB',
  surface: '#FFFFFF',
  line: '#E5EAF2',
  blue: '#365CF5',
  blueSoft: '#E9EEFF',
  teal: '#0B9D8B',
  tealSoft: '#E1F7F2',
  // Text-on-tint variants: each meets 4.5:1 against its soft background and white.
  tealText: '#06705F',
  amber: '#D97706',
  amberSoft: '#FFF3DB',
  amberText: '#B45309',
  rose: '#C2415D',
  roseSoft: '#FFE9EE',
  roseText: '#A62B48',
  lavender: '#7C3AED',
};

const glassSupported = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

/**
 * True only on iOS 26+ with Liquid Glass available and Reduce Transparency off.
 * Everywhere else, callers keep the solid surfaces.
 */
export function useLiquidGlass(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    if (!glassSupported) return;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => subscription.remove();
  }, []);
  return glassSupported && !reduceTransparency;
}

/** Extra bottom padding for scroll content that runs underneath a floating tab bar. */
export const FloatingBarInsetContext = createContext(0);

export type IconName = ComponentProps<typeof Ionicons>['name'];

export const iconSize = { sm: 16, md: 20, lg: 24 } as const;

/** Decorative by default; pass `label` when the icon carries meaning on its own. */
export function Icon({ name, size = iconSize.md, color = colors.ink, label }: { name: IconName; size?: number; color?: string; label?: string }) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessible={Boolean(label)}
      accessibilityLabel={label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
      accessibilityElementsHidden={!label}
    />
  );
}

export function AppScreen({
  children,
  scroll = true,
  style,
  edges = ['top', 'left', 'right'],
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Screens shown above the tab bar leave the bottom inset to the tab bar. */
  edges?: Edge[];
}) {
  const floatingBarInset = useContext(FloatingBarInsetContext);
  const content = <View style={[styles.screenContent, style, floatingBarInset ? { paddingBottom: 28 + floatingBarInset } : null]}>{children}</View>;
  return (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {content}
        </ScrollView>
      ) : content}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[styles.title, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  style,
  icon,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: IconName;
  accessibilityHint?: string;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, disabled && styles.disabledButton, pressed && !inactive && styles.pressed, style]}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : icon ? <Icon name={icon} size={iconSize.md} color="#FFFFFF" /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  style,
  icon,
  tone = 'default',
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: IconName;
  tone?: 'default' | 'danger';
  accessibilityHint?: string;
}) {
  const textColor = disabled ? '#98A2B3' : tone === 'danger' ? colors.roseText : colors.blue;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        tone === 'danger' && styles.dangerButton,
        disabled && styles.disabledSecondary,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={iconSize.md} color={textColor} /> : null}
      <Text style={[styles.secondaryButtonText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

/** Inline text action with a 44pt touch target. */
export function TextLink({
  label,
  onPress,
  icon,
  disabled = false,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.textLink, pressed && styles.textLinkPressed, style]}
    >
      <Text style={styles.textLinkText}>{label}</Text>
      {icon ? <Icon name={icon} size={iconSize.sm} color={colors.blue} /> : null}
    </Pressable>
  );
}

export function Pill({ label, tone = 'blue', icon }: { label: string; tone?: 'blue' | 'teal' | 'amber' | 'rose' | 'gray'; icon?: IconName }) {
  const palette = pillPalette[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }]}>
      {icon ? <Icon name={icon} size={12} color={palette.text} /> : null}
      <Text style={[styles.pillText, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

const pillPalette = {
  blue: { background: colors.blueSoft, text: '#2F51E0' },
  teal: { background: colors.tealSoft, text: colors.tealText },
  amber: { background: colors.amberSoft, text: colors.amberText },
  rose: { background: colors.roseSoft, text: colors.roseText },
  gray: { background: '#EFF2F6', text: '#5A6478' },
};

export function Divider() {
  return <View style={styles.divider} />;
}

export function Metric({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label}: ${value}${caption ? `. ${caption}` : ''}`}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {caption ? <Text style={styles.metricCaption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  scrollContent: { flexGrow: 1 },
  // Keeps line length readable on tablets (supportsTablet is enabled).
  screenContent: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    shadowColor: '#24314B',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  eyebrow: { color: colors.blue, fontSize: 12, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.7, lineHeight: 34 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondaryButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#C9D4F6',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButtonText: { color: colors.blue, fontSize: 16, fontWeight: '800' },
  dangerButton: { borderColor: '#F2BBC8' },
  // Disabled uses reduced emphasis rather than a pale fill that hides the label.
  disabledButton: { opacity: 0.45 },
  disabledSecondary: { backgroundColor: '#F2F4F8', borderColor: '#E2E6EF' },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
  textLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  textLinkPressed: { opacity: 0.6 },
  textLinkText: { color: colors.blue, fontSize: 14, fontWeight: '800' },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '800' },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 14 },
  metric: { flex: 1, minWidth: 74 },
  metricValue: { color: colors.ink, fontSize: 23, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  metricLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  metricCaption: { color: colors.tealText, fontSize: 12, fontWeight: '700', marginTop: 4 },
});
