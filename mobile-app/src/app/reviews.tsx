import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, Card, IconButton, ScreenHeader } from '@/components/ui';
import { WebFrame, type WebFrameHandle } from '@/components/WebFrame';
import { tr } from '@/lib/i18n';
import { useIsTablet } from '@/lib/layout';
import { goBack } from '@/lib/nav';
import { allowImportFrame } from '@/lib/portal/portal';
import { REVIEW_AUTOFILL_BUNDLE } from '@/lib/portal/reviewAutofill.generated';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

/** The student portal, where course evaluations are filled in. */
const PORTAL_URL = 'https://stu-gate.qu.edu.sa/';

/** The extension's auto-fill script, run on every portal page (it only acts on evaluation pages). */
const AUTOFILL_SCRIPT = `(function(){ try { ${REVIEW_AUTOFILL_BUNDLE} } catch (e) {} })(); true;`;

const steps = () => [
  tr('اضغط «فتح صفحة التقييم» وسجّل دخولك في بوابة الطالب.', 'Tap “Open the evaluation page” and sign in to the student portal.'),
  tr('افتح صفحة تقييم المقرر الذي تريد تقييمه.', 'Open the evaluation page of the course you want to rate.'),
  tr('سيظهر زر «ملء الكل» بجانب جدول معلومات المقرر، واختر إجابتك المفضلة من القائمة بجانبه:', 'A “ملء الكل” (Fill all) button appears next to the course info table. Pick your answer from the list beside it:'),
  tr('اضغط «ملء الكل» لتعبئة جميع الأسئلة بالخيار المحدد.', 'Tap “ملء الكل” to fill every question with the chosen answer.'),
  tr('راجع إجاباتك، ويمكنك الضغط على «تراجع» لاستعادة الإجابات السابقة.', 'Check your answers. Tap “تراجع” (Undo) to bring back the previous ones.'),
  tr('الأداة تملأ أسئلة الاختيار فقط وتترك الحقول النصية كما هي. اضغط «إرسال» في البوابة بنفسك.', 'The tool fills choice questions only and leaves text fields as they are. Tap “إرسال” (Submit) on the portal yourself.'),
];

const choices = () => [
  tr('موافق بشدة / موافق', 'Strongly agree / Agree'),
  tr('غير متأكد', 'Not sure'),
  tr('غير موافق / غير موافق بشدة', 'Disagree / Strongly disagree'),
];

const features = () => [
  tr('الكشف التلقائي عن أسئلة مقياس ليكرت', 'Finds Likert-scale questions automatically'),
  tr('دعم جميع خيارات الاستجابة الخمسة (من موافق بشدة إلى غير موافق بشدة)', 'Supports all five answers (from strongly agree to strongly disagree)'),
  tr('وظيفة التراجع لاستعادة الاختيارات السابقة', 'Undo to bring back previous choices'),
  tr('تأكيد قبل تطبيق التغييرات', 'Asks before applying changes'),
  tr('يعمل مع المحتوى الذي يُحمَّل لاحقاً في الصفحة', 'Works with content that loads later on the page'),
];

/** "تقييم المقررات": fills the portal's course evaluation surveys in one tap (same tool as the website/extension). */
export default function ReviewsScreen() {
  const [open, setOpen] = useState(false);
  return open ? <PortalView onClose={() => setOpen(false)} /> : <InfoView onOpen={() => setOpen(true)} />;
}

function InfoView({ onOpen }: { onOpen: () => void }) {
  const tablet = useIsTablet();
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.content, tablet && styles.contentTablet]}>
        <ScreenHeader title={tr('تقييم المقررات', 'Course evaluations')} leading={<IconButton icon="back" label={tr('رجوع', 'Back')} onPress={goBack} />} />

        <AppText size={14} color={colors.muted}>
          {tr(
            'تساعدك هذه الأداة على ملء نماذج تقييم المقررات بسرعة في بوابة الطالب بجامعة القصيم. اختر خيار الاستجابة المفضل لديك وطبّقه على جميع الأسئلة دفعة واحدة.',
            'This tool helps you fill in course evaluation forms quickly on the Qassim University student portal. Pick your preferred answer and apply it to every question at once.',
          )}
        </AppText>

        <Card style={{ gap: 10 }}>
          <AppText size={15} weight="bold">
            {tr('طريقة الاستخدام', 'How to use it')}
          </AppText>
          {steps().map((step, i) => (
            <View key={step} style={{ gap: 6 }}>
              <View style={[styles.step, { flexDirection: row }]}>
                <View style={styles.stepNum}>
                  <AppText size={12} weight="bold" color={colors.accentDark}>
                    {i + 1}
                  </AppText>
                </View>
                <AppText size={13.5} style={{ flex: 1 }}>
                  {step}
                </AppText>
              </View>
              {i === 2 ? (
                <View style={styles.choices}>
                  {choices().map((c) => (
                    <AppText key={c} size={13} color={colors.muted}>
                      • {c}
                    </AppText>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </Card>

        <Card style={{ gap: 8 }}>
          <AppText size={15} weight="bold">
            {tr('المميزات', 'Features')}
          </AppText>
          {features().map((f) => (
            <View key={f} style={[styles.step, { flexDirection: row }]}>
              <View style={styles.check}>
                <Icon name="check" size={12} color={colors.success} strokeWidth={2.6} />
              </View>
              <AppText size={13.5} style={{ flex: 1 }}>
                {f}
              </AppText>
            </View>
          ))}
        </Card>

        <Button label={tr('فتح صفحة التقييم', 'Open the evaluation page')} icon="clipboardCheck" onPress={onOpen} />
        <View style={[styles.note, { flexDirection: row }]}>
          <Icon name="lock" size={13} color={colors.muted} />
          <AppText size={12} color={colors.muted} style={{ flex: 1 }}>
            {tr(
              'تسجيل الدخول يتم في موقع الجامعة، ولا نحتفظ بكلمة المرور. لا يُرسَل أي تقييم إلا عندما تضغط «إرسال» بنفسك.',
              'You sign in on the university website; we never keep your password. No evaluation is sent until you tap Submit yourself.',
            )}
          </AppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PortalView({ onClose }: { onClose: () => void }) {
  const frame = useRef<WebFrameHandle>(null);
  const [url, setUrl] = useState(PORTAL_URL);
  const host = useMemo(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return 'stu-gate.qu.edu.sa';
    }
  }, [url]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={[styles.top, { flexDirection: row }]}>
        <IconButton icon="back" label={tr('رجوع إلى الشرح', 'Back to the guide')} tone="muted" onPress={onClose} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <AppText weight="bold" size={15} align="center">
            {tr('تقييم المقررات', 'Course evaluations')}
          </AppText>
          <View style={[styles.url, { flexDirection: row }]}>
            <Icon name="lock" size={11} color={colors.muted} />
            <AppText size={11} color={colors.muted}>
              {host}
            </AppText>
          </View>
        </View>
        <IconButton icon="refresh" label={tr('إعادة تحميل الصفحة', 'Reload the page')} tone="muted" onPress={() => frame.current?.reload()} />
      </View>
      <View style={{ flex: 1 }}>
        <WebFrame
          ref={frame}
          uri={PORTAL_URL}
          injectedJavaScript={AUTOFILL_SCRIPT}
          onNavigation={(s) => setUrl(s.url)}
          allowUrl={allowImportFrame}
        />
      </View>
      <View style={[styles.hint, { flexDirection: row }]}>
        <Icon name="info" size={14} color={colors.accentDark} />
        <AppText size={12} color={colors.text} style={{ flex: 1 }}>
          {tr('في صفحة تقييم المقرر سيظهر زر «ملء الكل» بجانب جدول معلومات المقرر.', 'On the course evaluation page, a “ملء الكل” (Fill all) button appears next to the course info table.')}
        </AppText>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  contentTablet: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 24 },
  step: { alignItems: 'flex-start', gap: 10 },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choices: { paddingHorizontal: 34, gap: 2 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  note: { alignItems: 'flex-start', gap: 6, paddingHorizontal: 4 },
  top: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  url: { alignItems: 'center', gap: 4 },
  hint: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.accentSoft,
  },
});
