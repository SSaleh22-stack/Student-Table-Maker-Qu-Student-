/**
 * Sends a problem, suggestion or question from the "Send feedback" screen to the developer.
 *
 * Messages go to a small Cloudflare Worker (source and setup: feedback-worker/ at the repo root),
 * which forwards them to the developer's Telegram. The bot token lives only on the Worker.
 *
 * Besides what the student types, each message carries the app version, platform, OS version,
 * device model and app language, so problems can be reproduced. Nothing else is sent.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getLang } from '@/lib/i18n';

/** The deployed Worker's URL, printed by `npx wrangler deploy` in feedback-worker/. */
export const FEEDBACK_URL = 'https://qu-student-feedback.qasd-trips.workers.dev';

const TIMEOUT_MS = 15000;

export type FeedbackType = 'problem' | 'suggestion' | 'question';

export const MESSAGE_MAX = 2000;
export const CONTACT_MAX = 200;
/** The Worker rejects anything shorter. */
export const MESSAGE_MIN = 3;

export type FeedbackError = 'offline' | 'rate' | 'server' | 'not-configured';

export class FeedbackSendError extends Error {
  constructor(public reason: FeedbackError) {
    super(reason);
  }
}

/** What is attached to every message; also shown to the student on the screen. */
export function feedbackMeta() {
  return {
    app: `v${Constants.expoConfig?.version ?? '0.0.0'}`,
    platform: Platform.OS,
    os: Platform.OS === 'web' ? '' : String(Platform.Version ?? ''),
    device: Device.modelName ?? '',
    lang: getLang(),
  };
}

/** Resolves when the message reached the Worker and Telegram; throws FeedbackSendError otherwise. */
export async function sendFeedback(input: { type: FeedbackType; message: string; contact: string }) {
  if (!FEEDBACK_URL) throw new FeedbackSendError('not-configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(FEEDBACK_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        type: input.type,
        message: input.message.trim().slice(0, MESSAGE_MAX),
        contact: input.contact.trim().slice(0, CONTACT_MAX),
        meta: feedbackMeta(),
      }),
    });
  } catch {
    throw new FeedbackSendError('offline');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) throw new FeedbackSendError('rate');
  const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (!res.ok || !data?.ok) throw new FeedbackSendError('server');
}
