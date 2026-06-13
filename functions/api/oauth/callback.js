const DEFAULT_CLIENT_ID = '41b37086-2076-4edd-ade4-b447c22544ea';

function clean(value, fallback = '') {
  return String(value || fallback).trim();
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderResult({ title, body, token, refreshToken }) {
  const escapedToken = token ? escapeHtml(token) : '';
  const escapedRefreshToken = refreshToken ? escapeHtml(refreshToken) : '';

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        color: #171717;
        background: #fafafa;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(760px, calc(100% - 32px));
        margin: 0 auto;
        padding: 48px 0;
      }
      h1 {
        margin: 0 0 16px;
        font-size: 24px;
        letter-spacing: 0;
      }
      p {
        line-height: 1.6;
      }
      code, textarea {
        font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      textarea {
        width: 100%;
        min-height: 140px;
        padding: 12px;
        border: 1px solid #d8d8d8;
        border-radius: 8px;
        resize: vertical;
      }
      .box {
        margin-top: 20px;
        padding: 20px;
        border: 1px solid #e4e4e4;
        border-radius: 8px;
        background: #fff;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      ${body}
      ${
        token
          ? `<div class="box">
              <p><strong>Cloudflare Pages 환경변수에 넣을 값</strong></p>
              <p><code>IMWEB_ACCESS_TOKEN</code>의 Value에 아래 문자열만 넣으세요. <code>Bearer</code>는 붙이지 않습니다.</p>
              <textarea readonly>${escapedToken}</textarea>
            </div>`
          : ''
      }
      ${
        refreshToken
          ? `<div class="box">
              <p><strong>자동 갱신용 refreshToken</strong></p>
              <p><code>IMWEB_REFRESH_TOKEN</code>의 Value에 아래 문자열을 넣으세요.</p>
              <textarea readonly>${escapedRefreshToken}</textarea>
            </div>`
          : ''
      }
    </main>
  </body>
</html>`;
}

export async function onRequestGet({ env, request }) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const oauthErrorCode = requestUrl.searchParams.get('errorCode') || requestUrl.searchParams.get('code');
  const oauthErrorMessage = requestUrl.searchParams.get('message');

  if (oauthErrorMessage && !code) {
    return htmlResponse(
      renderResult({
        title: '아임웹 인가 실패',
        body: `<p>아임웹이 인가 코드를 발급하지 않았습니다.</p>
          <div class="box">
            <p><strong>errorCode</strong>: ${escapeHtml(oauthErrorCode || '-')}</p>
            <p><strong>message</strong>: ${escapeHtml(oauthErrorMessage)}</p>
          </div>`,
      }),
      400,
    );
  }

  if (!code) {
    return htmlResponse(
      renderResult({
        title: '인가 코드가 없습니다',
        body: '<p><code>/api/oauth/start</code> 주소에서 OAuth 승인을 다시 시작하세요.</p>',
      }),
      400,
    );
  }

  const clientId = clean(env.IMWEB_CLIENT_ID, DEFAULT_CLIENT_ID);
  const clientSecret = clean(env.IMWEB_CLIENT_SECRET);

  if (!clientSecret) {
    return htmlResponse(
      renderResult({
        title: 'clientSecret 환경변수가 없습니다',
        body: '<p>Cloudflare Pages 환경변수에 <code>IMWEB_CLIENT_SECRET</code>을 먼저 추가한 뒤 재배포하세요.</p>',
      }),
      500,
    );
  }

  const origin = requestUrl.origin;
  const redirectUri = clean(env.IMWEB_REDIRECT_URI, `${origin}/api/oauth/callback`);
  const form = new URLSearchParams();

  form.set('clientId', clientId);
  form.set('clientSecret', clientSecret);
  form.set('redirectUri', redirectUri);
  form.set('code', code);
  form.set('grantType', 'authorization_code');

  const tokenResponse = await fetch('https://openapi.imweb.me/oauth2/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });

  const text = await tokenResponse.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  const accessToken = payload?.data?.accessToken || payload?.accessToken;
  const refreshToken = payload?.data?.refreshToken || payload?.refreshToken;

  if (!tokenResponse.ok || !accessToken) {
    return htmlResponse(
      renderResult({
        title: 'accessToken 발급 실패',
        body: `<p>아임웹 토큰 교환 요청이 실패했습니다. <code>30098</code>이면 대개 clientId 또는 clientSecret이 올바르지 않은 상태입니다.</p>
          <div class="box">
            <p><strong>HTTP status</strong>: ${tokenResponse.status}</p>
            <p><strong>clientId</strong>: <code>${escapeHtml(clientId)}</code></p>
            <p><strong>clientSecret configured</strong>: ${clientSecret ? 'yes' : 'no'}</p>
            <p><strong>clientSecret length</strong>: ${clientSecret.length}</p>
            <p><strong>clientSecret equals clientId</strong>: ${clientSecret === clientId ? 'yes' : 'no'}</p>
            <p><strong>clientSecret looks like UUID</strong>: ${looksLikeUuid(clientSecret) ? 'yes' : 'no'}</p>
            <p><strong>redirectUri</strong>: <code>${escapeHtml(redirectUri)}</code></p>
            <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
          </div>`,
      }),
      400,
    );
  }

  return htmlResponse(
    renderResult({
      title: 'accessToken 발급 성공',
      body: `<p>아래 토큰을 Cloudflare Pages의 <code>IMWEB_ACCESS_TOKEN</code> 값으로 저장하고, Pages 프로젝트를 재배포하세요.</p>
        <div class="box">
          <p><strong>scope</strong>: ${escapeHtml(payload?.data?.scope || payload?.scope || '-')}</p>
          <p><strong>redirectUri</strong>: <code>${escapeHtml(redirectUri)}</code></p>
        </div>`,
      token: accessToken,
      refreshToken,
    }),
  );
}
