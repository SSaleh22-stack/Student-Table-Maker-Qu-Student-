import React, { useState } from 'react';
import Icon, { IconName } from './Icon';
import './FeedbackForm.css';

/**
 * "أرسل لنا رسالة": a problem, suggestion or question sent straight to the developer.
 *
 * Posts to the same Cloudflare Worker as the mobile app (feedback-worker/ at the repo root), which
 * forwards it to Telegram. Besides what the student types, only the source (website/extension),
 * its version, the OS, the browser and the language are sent.
 *
 * The website and the extension each keep a copy of this file; keep them in sync.
 */

const FEEDBACK_URL = 'https://qu-student-feedback.qasd-trips.workers.dev';
const MESSAGE_MAX = 2000;
const CONTACT_MAX = 200;
const MESSAGE_MIN = 3;
const TIMEOUT_MS = 15000;

type FeedbackType = 'problem' | 'suggestion' | 'question';
type SendError = 'offline' | 'rate' | 'server';

const TYPES: { key: FeedbackType; icon: IconName; ar: string; en: string; hintAr: string; hintEn: string }[] = [
  {
    key: 'problem',
    icon: 'alert',
    ar: 'مشكلة',
    en: 'Problem',
    hintAr: 'اكتب ما حدث، وفي أي صفحة، وما الذي توقعت أن يحدث.',
    hintEn: 'Tell us what happened, on which page, and what you expected.',
  },
  {
    key: 'suggestion',
    icon: 'star',
    ar: 'اقتراح',
    en: 'Suggestion',
    hintAr: 'ما الميزة أو التحسين الذي تريده؟',
    hintEn: 'What feature or improvement would you like to see?',
  },
  {
    key: 'question',
    icon: 'help',
    ar: 'استفسار',
    en: 'Question',
    hintAr: 'اكتب سؤالك، ويفضّل أن تترك وسيلة تواصل لنرد عليك.',
    hintEn: 'Ask away, and leave a way to reach you so we can reply.',
  },
];

/** Operating system and browser, read from the user agent (no identifiers). */
function browserInfo() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /CrOS/.test(ua)
        ? 'ChromeOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  return { os, browser };
}

async function sendFeedback(body: object) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(FEEDBACK_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw 'offline' as SendError;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) throw 'rate' as SendError;
  const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (!res.ok || !data?.ok) throw 'server' as SendError;
}

interface FeedbackFormProps {
  /** Where the message comes from; shown with it in Telegram. */
  source: 'website' | 'extension';
  /** e.g. the extension's version; empty for the website. */
  version?: string;
  isAr: boolean;
}

const FeedbackForm: React.FC<FeedbackFormProps> = ({ source, version, isAr }) => {
  const [type, setType] = useState<FeedbackType>('problem');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [sent, setSent] = useState<{ withContact: boolean } | null>(null);

  const L = (ar: string, en: string) => (isAr ? ar : en);
  const current = TYPES.find((t) => t.key === type)!;
  const ready = message.trim().length >= MESSAGE_MIN && !sending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setSending(true);
    setError(null);
    const { os, browser } = browserInfo();
    try {
      await sendFeedback({
        type,
        message: message.trim().slice(0, MESSAGE_MAX),
        contact: contact.trim().slice(0, CONTACT_MAX),
        meta: {
          app: version ? `v${version}` : '',
          platform: source,
          os,
          device: browser,
          lang: isAr ? 'ar' : 'en',
        },
      });
      setSent({ withContact: contact.trim().length > 0 });
      setMessage('');
      setContact('');
    } catch (reason) {
      setError(reason === 'offline' || reason === 'rate' ? reason : 'server');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="qs-feedback-sent" role="status">
        <span className="qs-feedback-sent-icon">
          <Icon name="check" size={26} />
        </span>
        <strong>{L('وصلتنا رسالتك', 'Message received')}</strong>
        <p>
          {sent.withContact
            ? L(
                'شكرًا لك! سنطّلع عليها ونرد عليك عبر وسيلة التواصل التي كتبتها.',
                "Thank you! We'll read it and get back to you using the contact you left.",
              )
            : L('شكرًا لك! سنطّلع عليها قريبًا.', "Thank you! We'll read it soon.")}
        </p>
        <button type="button" className="qs-btn qs-btn-ghost qs-btn-sm" onClick={() => setSent(null)}>
          {L('إرسال رسالة أخرى', 'Send another message')}
        </button>
      </div>
    );
  }

  return (
    <form className="qs-feedback" onSubmit={submit}>
      <div className="qs-feedback-types" role="radiogroup" aria-label={L('نوع الرسالة', 'Message type')}>
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={t.key === type}
            className={`qs-feedback-type ${t.key === type ? 'active' : ''}`}
            onClick={() => setType(t.key)}
          >
            <Icon name={t.icon} size={18} />
            {isAr ? t.ar : t.en}
          </button>
        ))}
      </div>

      <label className="qs-feedback-field">
        <span className="qs-label">{L('رسالتك', 'Your message')}</span>
        <textarea
          className="qs-input qs-feedback-message"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (error) setError(null);
          }}
          placeholder={isAr ? current.hintAr : current.hintEn}
          maxLength={MESSAGE_MAX}
          rows={4}
        />
        <span className="qs-feedback-count" dir="ltr">
          {message.length} / {MESSAGE_MAX}
        </span>
      </label>

      <label className="qs-feedback-field">
        <span className="qs-label">{L('وسيلة للتواصل (اختياري)', 'How to reach you (optional)')}</span>
        <input
          className="qs-input"
          dir={contact ? 'ltr' : undefined}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder={L('رقم واتساب أو بريد أو معرّف تيليجرام', 'WhatsApp number, email or Telegram username')}
          maxLength={CONTACT_MAX}
          autoComplete="off"
        />
      </label>

      {error && (
        <p className="qs-feedback-error" role="alert">
          <Icon name="alert" size={16} />
          {error === 'offline'
            ? L('تعذّر الإرسال. تأكد من اتصالك بالإنترنت ثم حاول مرة أخرى.', "Couldn't send. Check your internet connection and try again.")
            : error === 'rate'
              ? L('أرسلت رسائل كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.', 'Too many messages in a short time. Wait a minute and try again.')
              : L('تعذّر إرسال رسالتك الآن. حاول لاحقًا أو تواصل معنا بالطرق أدناه.', "We couldn't send your message right now. Try later, or reach us below.")}
        </p>
      )}

      <button type="submit" className="qs-btn qs-btn-primary" disabled={!ready}>
        <Icon name="send" size={18} />
        {sending ? L('جارٍ الإرسال…', 'Sending…') : L('إرسال', 'Send')}
      </button>

      <p className="qs-feedback-note">
        {L(
          'يُرفق مع رسالتك نوع المتصفح والنظام فقط، لمساعدتنا في حل المشكلة. لا تُرسل بيانات جدولك أو درجاتك.',
          "Only your browser and operating system are attached, to help us fix problems. Your timetable and grades aren't sent.",
        )}
      </p>
    </form>
  );
};

export default FeedbackForm;
