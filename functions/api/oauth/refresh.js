import { refreshImwebToken } from '../../_imweb.js';
import { isAdminAuthorized } from '../../_config.js';

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

export async function onRequestGet({ env, request }) {
  if (!(await isAdminAuthorized(request, env))) {
    return new Response('관리자 로그인이 필요합니다.', { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  const refreshed = await refreshImwebToken(env);
  const stored = Boolean(refreshed.storedInKv || refreshed.storedInManager);

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
      <p>${stored ? '새 토큰이 서버에 저장되었습니다.' : '토큰 저장소 설정을 확인해주세요.'}</p>
      <p><strong>storedInKv</strong>: ${refreshed.storedInKv ? 'yes' : 'no'}</p>
      <p>${stored ? '재배포 없이 다음 API 요청부터 갱신된 토큰을 사용합니다.' : '관리자에게 문의해주세요.'}</p>
    </main>
  </body>
</html>`);
}
