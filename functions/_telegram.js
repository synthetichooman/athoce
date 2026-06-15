const ALERT_THROTTLE_SECONDS = 60 * 30;
const TELEGRAM_ALERT_KEY_PREFIX = 'telegram_alert:';

function clean(value, fallback = '') {
  return String(value || fallback).trim();
}

function clip(value, maxLength = 3600) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function getTelegramConfig(env) {
  return {
    botToken: clean(env.TELEGRAM_BOT_TOKEN),
    chatId: clean(env.TELEGRAM_CHAT_ID),
  };
}

export function isTelegramConfigured(env) {
  const { botToken, chatId } = getTelegramConfig(env);
  return Boolean(botToken && chatId);
}

export async function sendTelegramMessage(env, text) {
  const { botToken, chatId } = getTelegramConfig(env);

  if (!botToken || !chatId) {
    return {
      ok: false,
      skipped: true,
      error: 'TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 없습니다.',
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: clip(text),
      disable_web_page_preview: true,
    }),
  });

  let payload = {};

  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  return {
    ok: response.ok && payload?.ok !== false,
    status: response.status,
    payload,
  };
}

export async function sendThrottledTelegramAlert(env, alertKey, text) {
  if (!isTelegramConfigured(env)) {
    return {
      ok: false,
      skipped: true,
      reason: 'telegram_not_configured',
    };
  }

  const key = `${TELEGRAM_ALERT_KEY_PREFIX}${clean(alertKey, 'default')}`;

  if (env.ATHOCE_KV) {
    const lastSentAt = await env.ATHOCE_KV.get(key);
    const lastSentTime = lastSentAt ? new Date(lastSentAt).getTime() : 0;

    if (Number.isFinite(lastSentTime) && Date.now() - lastSentTime < ALERT_THROTTLE_SECONDS * 1000) {
      return {
        ok: true,
        skipped: true,
        reason: 'throttled',
      };
    }

    await env.ATHOCE_KV.put(key, new Date().toISOString(), {
      expirationTtl: ALERT_THROTTLE_SECONDS,
    });
  }

  const result = await sendTelegramMessage(env, text);

  return result;
}
