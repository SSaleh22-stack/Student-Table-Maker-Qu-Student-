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
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useLang, useLanguageBoot } from '@/lib/i18n';
import { colors } from '@/lib/theme';
import { AppDataProvider } from '@/store/AppData';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });
  const langReady = useLanguageBoot();
  const lang = useLang();

  useEffect(() => {
    if ((loaded || error) && langReady) SplashScreen.hideAsync();
  }, [loaded, error, langReady]);

  if ((!loaded && !error) || !langReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppDataProvider>
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
            <Stack.Screen name="reviews" />
          </Stack>
          </View>
        </AppDataProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
