import { getImwebTokenHealth, refreshImwebToken } from '../../_imweb.js';
import { sendTelegramMessageToChat } from '../../_telegram.js';

function clean(value, fallback = '') {
  return String(value || fallback).trim();
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function getCommand(text = '') {
  return clean(text).split(/\s+/)[0].split('@')[0].toLowerCase();
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    return String(value);
  }

  return new Date(time).toISOString();
}

function formatExpiresIn(seconds) {
  if (seconds === null || seconds === undefined) {
    return 'unknown';
  }

  if (seconds <= 0) {
    return 'expired';
  }

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${minutes}m`;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) {
    return 'unknown';
  }

  if (seconds < 60) {
    return `${Math.max(0, seconds)}s`;
  }

  return formatExpiresIn(seconds);
}

function formatHealth(health = {}) {
  return [
    '[athoce] imweb token status',
    `kv: ${health.kvConfigured ? 'connected' : 'not connected'}`,
    `source: ${health.tokenSource || '-'}`,
    `accessToken: ${health.hasAccessToken ? 'present' : 'missing'}`,
    `refreshToken: ${health.hasRefreshToken ? 'present' : 'missing'}`,
    `refreshedAgo: ${formatDuration(health.refreshedAgoSeconds)}`,
    `refreshInterval: ${formatDuration(health.refreshIntervalSeconds)}`,
    `expiresIn: ${formatExpiresIn(health.expiresInSeconds)}`,
    `expiresAt: ${formatDateTime(health.expiresAt)}`,
    `updatedAt: ${formatDateTime(health.updatedAt)}`,
    `refreshRecommended: ${health.refreshRecommended ? 'yes' : 'no'}`,
    `lastFailure: ${formatDateTime(health.lastRefreshFailedAt)}`,
    `lastError: ${health.lastRefreshError?.message || '-'}`,
  ].join('\n');
}

function helpText() {
  return [
    '[athoce] bot commands',
    '/status - 토큰 상태 확인',
    '/refresh - accessToken 갱신 시도',
    '/reauth - Imweb 재승인 링크 받기',
    '/ping - 봇 연결 확인',
  ].join('\n');
}

async function handleCommand(env, command) {
  if (command === '/ping') {
    return '[athoce] pong';
  }

  if (command === '/status') {
    return formatHealth(await getImwebTokenHealth(env));
  }

  if (command === '/refresh') {
    const refreshed = await refreshImwebToken(env);
    const health = await getImwebTokenHealth(env);

    return [
      refreshed.ok
        ? '[athoce] imweb token refresh succeeded'
        : '[athoce] imweb token refresh failed',
      refreshed.ok ? `storedInKv: ${refreshed.storedInKv ? 'yes' : 'no'}` : `error: ${refreshed.error?.message || '-'}`,
      refreshed.ok ? `reusedConcurrentRefresh: ${refreshed.reusedConcurrentRefresh ? 'yes' : 'no'}` : '',
      '',
      formatHealth(health),
    ].filter((line) => line !== '').join('\n');
  }

  if (command === '/reauth') {
    return ['[athoce] imweb reauthorization', 'https://athoce.kr/api/oauth/start'].join('\n');
  }

  return helpText();
}

export async function onRequestPost({ env, request }) {
  const webhookSecret = clean(env.TELEGRAM_WEBHOOK_SECRET);
  const requestSecret = clean(request.headers.get('x-telegram-bot-api-secret-token'));

  if (!webhookSecret || requestSecret !== webhookSecret) {
    return jsonResponse({ ok: false }, 403);
  }

  let update;

  try {
    update = await request.json();
  } catch {
    return jsonResponse({ ok: false }, 400);
  }

  const message = update?.message || update?.edited_message;
  const chatId = clean(message?.chat?.id);
  const allowedChatId = clean(env.TELEGRAM_CHAT_ID);

  if (!chatId || chatId !== allowedChatId) {
    return jsonResponse({ ok: true, ignored: true });
  }

  const command = getCommand(message?.text);
  const text = await handleCommand(env, command);
  await sendTelegramMessageToChat(env, chatId, text);

  return jsonResponse({ ok: true });
}

export async function onRequestGet() {
  return jsonResponse({ ok: true, endpoint: 'telegram-webhook' });
}
