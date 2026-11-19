import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, Card, IconButton, ScreenHeader } from '@/components/ui';
import {
  CONTACT_MAX,
  FeedbackSendError,
  type FeedbackError,
  type FeedbackType,
  MESSAGE_MAX,
  MESSAGE_MIN,
  sendFeedback,
} from '@/lib/feedback';
import { tr } from '@/lib/i18n';
import { useIsTablet } from '@/lib/layout';
import { goBack } from '@/lib/nav';
import { inputDir, ltr, row } from '@/lib/rtl';
import { colors, fonts } from '@/lib/theme';

const types = (): { key: FeedbackType; icon: IconName; label: string; hint: string }[] => [
  {
    key: 'problem',
    icon: 'alert',
    label: tr('مشكلة', 'Problem'),
    hint: tr('اكتب ما حدث، وفي أي صفحة، وما الذي توقعت أن يحدث.', 'Tell us what happened, on which screen, and what you expected.'),
  },
  {
    key: 'suggestion',
    icon: 'star',
    label: tr('اقتراح', 'Suggestion'),
    hint: tr('ما الميزة أو التحسين الذي تريده في التطبيق؟', 'What feature or improvement would you like to see?'),
  },
  {
    key: 'question',
    icon: 'help',
    label: tr('استفسار', 'Question'),
    hint: tr('اكتب سؤالك، ويفضّل أن تترك وسيلة تواصل لنرد عليك.', 'Ask away, and leave a way to reach you so we can reply.'),
  },
];

const errorText = (reason: FeedbackError) =>
  reason === 'offline'
    ? tr('تعذّر الإرسال. تأكد من اتصالك بالإنترنت ثم حاول مرة أخرى.', "Couldn't send. Check your internet connection and try again.")
    : reason === 'rate'
      ? tr('أرسلت رسائل كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.', 'Too many messages in a short time. Wait a minute and try again.')
      : tr(
          'تعذّر إرسال رسالتك الآن. حاول لاحقًا أو تواصل معنا عبر واتساب أو تيليجرام.',
          "We couldn't send your message right now. Try again later, or reach us on WhatsApp or Telegram.",
        );

const isType = (v: unknown): v is FeedbackType => v === 'problem' || v === 'suggestion' || v === 'question';

/** "أرسل ملاحظة": a problem, suggestion or question, sent from inside the app. */
export default function FeedbackScreen() {
  const tablet = useIsTablet();
  const params = useLocalSearchParams<{ type?: string }>();
  const [type, setType] = useState<FeedbackType>(isType(params.type) ? params.type : 'problem');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<FeedbackError | null>(null);
  const [sent, setSent] = useState<{ withContact: boolean } | null>(null);

  const ready = message.trim().length >= MESSAGE_MIN && !sending;
  const current = types().find((t) => t.key === type)!;

  const submit = async () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback({ type, message, contact });
      setSent({ withContact: contact.trim().length > 0 });
      setMessage('');
      setContact('');
    } catch (e) {
      setError(e instanceof FeedbackSendError ? e.reason : 'server');
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, tablet && styles.contentTablet]}
          keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title={tr('أرسل ملاحظة', 'Send feedback')}
            leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />}
          />

          {sent ? (
            <Card style={styles.sentCard}>
              <View style={styles.sentIcon}>
                <Icon name="check" size={30} color={colors.success} strokeWidth={2.5} />
              </View>
              <AppText size={18} weight="bold" align="center">
                {tr('وصلتنا رسالتك', 'Message received')}
              </AppText>
              <AppText size={14} color={colors.muted} align="center">
                {sent.withContact
                  ? tr('شكرًا لك! سنطّلع عليها ونرد عليك عبر وسيلة التواصل التي كتبتها.', "Thank you! We'll read it and get back to you using the contact you left.")
                  : tr('شكرًا لك! سنطّلع عليها قريبًا.', "Thank you! We'll read it soon.")}
              </AppText>
              <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 6 }}>
                <Button label={tr('رجوع', 'Back')} onPress={goBack} />
                <Button label={tr('إرسال رسالة أخرى', 'Send another message')} variant="ghost" onPress={() => setSent(null)} />
              </View>
            </Card>
          ) : (
            <>
              <AppText size={14} color={colors.muted}>
                {tr(
                  'واجهت مشكلة أو عندك اقتراح؟ اكتب لنا هنا وستصلنا رسالتك مباشرة.',
                  'Hit a problem or have an idea? Write to us here and it reaches us directly.',
                )}
              </AppText>

              <View style={[styles.types, { flexDirection: row }]} accessibilityRole="radiogroup">
                {types().map((t) => {
                  const on = t.key === type;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => setType(t.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={t.label}
                      style={({ pressed }) => [styles.type, on && styles.typeOn, pressed && !on && { opacity: 0.8 }]}>
                      <Icon name={t.icon} size={22} color={on ? colors.accent : colors.muted} />
                      <AppText size={13.5} weight="semibold" color={on ? colors.accentDark : colors.text}>
                        {t.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>

              <Card style={{ gap: 10 }}>
                <AppText size={14} weight="semibold">
                  {tr('رسالتك', 'Your message')}
                </AppText>
                <TextInput
                  value={message}
                  onChangeText={(t) => {
                    setMessage(t);
                    if (error) setError(null);
                  }}
                  placeholder={current.hint}
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, styles.messageInput, inputDir()]}
                  accessibilityLabel={tr('رسالتك', 'Your message')}
                  multiline
                  textAlignVertical="top"
                  maxLength={MESSAGE_MAX}
                />
                <AppText size={11.5} color={colors.faint} align="end">
                  {ltr(`${message.length} / ${MESSAGE_MAX}`)}
                </AppText>

                <AppText size={14} weight="semibold">
                  {tr('وسيلة للتواصل (اختياري)', 'How to reach you (optional)')}
                </AppText>
                <TextInput
                  value={contact}
                  onChangeText={setContact}
                  placeholder={tr('رقم واتساب أو بريد أو معرّف تيليجرام', 'WhatsApp number, email or Telegram username')}
                  placeholderTextColor={colors.placeholder}
                  // Numbers, emails and @usernames read left to right, even in Arabic.
                  style={[styles.input, inputDir(), contact ? { writingDirection: 'ltr' } : null]}
                  accessibilityLabel={tr('وسيلة للتواصل', 'How to reach you')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={CONTACT_MAX}
                />
                <AppText size={12} color={colors.muted}>
                  {tr('اتركها إذا أردت أن نرد عليك.', 'Leave one if you would like a reply.')}
                </AppText>
              </Card>

              {error ? (
                <View style={[styles.errorBox, { flexDirection: row }]} accessibilityLiveRegion="polite">
                  <Icon name="alert" size={18} color={colors.danger} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <AppText size={13} color={colors.danger}>
                      {errorText(error)}
                    </AppText>
                    {error !== 'offline' && error !== 'rate' ? (
                      <Pressable onPress={() => router.push('/contact')} accessibilityRole="link" hitSlop={6}>
                        <AppText size={13} weight="semibold" color={colors.accentDark}>
                          {tr('طرق التواصل الأخرى', 'Other ways to reach us')}
                        </AppText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <Button label={tr('إرسال', 'Send')} icon="message" onPress={submit} disabled={!ready} loading={sending} />

              <View style={[styles.note, { flexDirection: row }]}>
                <Icon name="info" size={15} color={colors.faint} />
                <AppText size={12} color={colors.faint} style={{ flex: 1 }}>
                  {tr(
                    'يُرفق مع رسالتك إصدار التطبيق ونوع الجهاز ونظامه فقط، لمساعدتنا في حل المشكلة. لا تُرسل بيانات جدولك أو درجاتك.',
                    "Only the app version, device model and OS version are attached, to help us fix problems. Your timetable and grades aren't sent.",
                  )}
                </AppText>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  contentTablet: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: 24 },
  types: { gap: 8 },
  type: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
  },
  typeOn: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  messageInput: { minHeight: 140, paddingTop: 10, paddingBottom: 10 },
  errorBox: {
    gap: 8,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  note: { gap: 6, alignItems: 'flex-start', paddingHorizontal: 4 },
  sentCard: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  sentIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
});
