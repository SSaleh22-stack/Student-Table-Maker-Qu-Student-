/**
 * Sends a problem, suggestion or question from the "Send feedback" screen to the developer.
 *
 * Messages go to a small Cloudflare Worker (source and setup: feedback-worker/ at the repo root),
 * which forwards them to the developer's Telegram. The bot token lives only on the Worker.
 *
 * Besides what the student types, each message carries the app version, platform, OS version,
 * device model and app language, so problems can be reproduced. A message about one feature (the
 * notebook beta) also carries that topic. Nothing else is sent, and nothing is tracked (NB-5).
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getLang } from '@/lib/i18n';

/** The deployed Worker's URL, printed by `npx wrangler deploy` in feedback-worker/. */
export const FEEDBACK_URL = 'https://qu-student-feedback.qasd-trips.workers.dev';

const TIMEOUT_MS = 15000;

export type FeedbackType = 'problem' | 'suggestion' | 'question';

/** A feature the message is about, from the screen's `topic` param (only these are accepted). */
export const FEEDBACK_TOPICS = ['notebook'] as const;
export type FeedbackTopic = (typeof FEEDBACK_TOPICS)[number];

export const isFeedbackTopic = (v: unknown): v is FeedbackTopic =>
  typeof v === 'string' && (FEEDBACK_TOPICS as readonly string[]).includes(v);

/**
 * Put in front of the message, so the developer sees the feature at a glance in Telegram. Always
 * in Arabic, whatever the app language.
 */
export const topicPrefix = (topic?: FeedbackTopic): string => (topic === 'notebook' ? '[المذكرات] ' : '');

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

/** What is attached to every message, plus its topic when it has one. */
export function feedbackMeta(topic?: FeedbackTopic) {
  return {
    app: `v${Constants.expoConfig?.version ?? '0.0.0'}`,
    platform: Platform.OS,
    os: Platform.OS === 'web' ? '' : String(Platform.Version ?? ''),
    device: Device.modelName ?? '',
    lang: getLang(),
    ...(topic ? { topic } : {}),
  };
}

/** Resolves when the message reached the Worker and Telegram; throws FeedbackSendError otherwise. */
export async function sendFeedback(input: { type: FeedbackType; message: string; contact: string; topic?: FeedbackTopic }) {
  const topic = isFeedbackTopic(input.topic) ? input.topic : undefined;
  const prefix = topicPrefix(topic);
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
        // The prefix counts toward the Worker's limit, so the text is cut to leave room for it.
        message: prefix + input.message.trim().slice(0, MESSAGE_MAX - prefix.length),
        contact: input.contact.trim().slice(0, CONTACT_MAX),
        meta: feedbackMeta(topic),
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
