import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { IntroAnimation } from '@/components/IntroAnimation';
import { UpdateGate } from '@/components/UpdateGate';
import { useLang, useLanguageBoot } from '@/lib/i18n';
import { setupReminders } from '@/lib/reminders';
import { colors } from '@/lib/theme';
import { AppDataProvider } from '@/store/AppData';
import { TasksProvider, useTasks } from '@/store/Tasks';

SplashScreen.preventAutoHideAsync();

/**
 * Handles the buttons on task reminders ("تم إنجاز المهمة", "ذكّرني بعد 10 دقائق"). It starts once
 * the tasks are loaded, so a button pressed while the app was closed finds its task. The button
 * titles follow the language, so it starts again when the language changes.
 */
function TaskReminderActions() {
  const { loaded, getTask, toggleDone, snooze } = useTasks();
  const lang = useLang();
  const latest = useRef({ getTask, toggleDone, snooze });
  useEffect(() => {
    latest.current = { getTask, toggleDone, snooze };
  });

  useEffect(() => {
    if (!loaded) return;
    return setupReminders({
      onDone: (id) => {
        const task = latest.current.getTask(id);
        if (task && !task.done) latest.current.toggleDone(id);
      },
      onSnooze: (id) => latest.current.snooze(id),
    });
  }, [loaded, lang]);

  return null;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });
  const langReady = useLanguageBoot();
  const lang = useLang();
  // The opening animation plays once per app start (not when the language changes).
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    if ((loaded || error) && langReady) SplashScreen.hideAsync();
  }, [loaded, error, langReady]);

  if ((!loaded && !error) || !langReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppDataProvider>
          <TasksProvider>
            <TaskReminderActions />
            <StatusBar style="dark" />
            {/* Changing the language remounts every screen so text and layout direction update. */}
            <View key={lang} style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="import" options={{ presentation: 'fullScreenModal' }} />
              <Stack.Screen name="summary" />
              <Stack.Screen name="export" />
              <Stack.Screen name="calendar" />
              <Stack.Screen name="gpa" />
              <Stack.Screen name="absence" />
              <Stack.Screen name="tutorials" />
              <Stack.Screen name="contact" />
              <Stack.Screen name="feedback" />
              <Stack.Screen name="reviews" />
              <Stack.Screen
                name="task"
                options={{ presentation: 'modal', contentStyle: { backgroundColor: colors.surface } }}
              />
            </Stack>
            </View>
            <UpdateGate />
            {introDone ? null : <IntroAnimation onDone={() => setIntroDone(true)} />}
          </TasksProvider>
        </AppDataProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
