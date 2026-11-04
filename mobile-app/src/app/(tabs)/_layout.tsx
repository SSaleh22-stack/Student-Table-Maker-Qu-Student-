import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/TabBar';
import { tr } from '@/lib/i18n';
import { colors } from '@/lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" options={{ title: tr('الرئيسية', 'Home') }} />
      <Tabs.Screen name="timetable" options={{ title: tr('الجدول', 'Timetable') }} />
      <Tabs.Screen name="qeeem" options={{ title: tr('قيم', 'Qeeem') }} />
      <Tabs.Screen name="more" options={{ title: tr('المزيد', 'More') }} />
    </Tabs>
  );
}
