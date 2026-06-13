import { refreshImwebToken } from '../../_imweb.js';

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

export async function onRequestGet({ env }) {
  const refreshed = await refreshImwebToken(env);

  if (!refreshed.ok) {
    return htmlResponse(
      `<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>토큰 갱신 실패</title></head>
  <body>
    <main style="font-family: system-ui, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 16px;">
      <h1>토큰 갱신 실패</h1>
      <pre>${escapeHtml(JSON.stringify(refreshed.error || refreshed.payload, null, 2))}</pre>
    </main>
  </body>
</html>`,
      400,
    );
  }

  return htmlResponse(`<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>토큰 갱신 성공</title></head>
  <body>
    <main style="font-family: system-ui, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 16px;">
      <h1>토큰 갱신 성공</h1>
      <p>${refreshed.storedInKv ? '새 토큰이 Cloudflare KV에 저장되었습니다.' : 'KV 바인딩이 없어 아래 값을 Cloudflare 환경변수에 직접 저장해야 합니다.'}</p>
      <p><strong>storedInKv</strong>: ${refreshed.storedInKv ? 'yes' : 'no'}</p>
      <p>${refreshed.storedInKv ? '재배포 없이 다음 API 요청부터 갱신된 토큰을 사용합니다.' : '저장 후 Cloudflare Pages를 재배포하세요.'}</p>
      ${
        refreshed.storedInKv
          ? ''
          : `<p><code>IMWEB_ACCESS_TOKEN</code></p>
            <textarea readonly style="width: 100%; min-height: 120px;">${escapeHtml(refreshed.accessToken)}</textarea>
            <p><code>IMWEB_REFRESH_TOKEN</code></p>
            <textarea readonly style="width: 100%; min-height: 120px;">${escapeHtml(refreshed.refreshToken)}</textarea>`
      }
    </main>
  </body>
</html>`);
}
