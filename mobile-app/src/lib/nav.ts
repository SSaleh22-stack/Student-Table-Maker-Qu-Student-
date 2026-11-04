import { router } from 'expo-router';

/** Goes back, or to the timetable when there is no history (e.g. a page opened directly on web). */
export const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
