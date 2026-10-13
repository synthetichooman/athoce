// Keep the original Imweb form as the owner of submissions.
const SOURCE_URL = 'https://hooman.kr/interlining';
const SOURCE_ORIGIN = 'https://hooman.kr';
const USER_AGENT = 'athoce-interlining/1.0 (+https://athoce.kr/interlining)';
const WIDGET_CODE = 'w202610131151c71d9961a';
const FIELDS = {
  fullName: 'input_39c93ffaf43e1',
  instagram: 'input_dC0eEfFepr',
  phoneFirst: 'phonenumber1_9074cf8680318',
  phoneMiddle: 'phonenumber2_9074cf8680318',
  phoneLast: 'phonenumber3_9074cf8680318',
  address: 'address_4ZQ5r3I60o',
  addressDetail: 'address_detail_4ZQ5r3I60o',
  postcode: 'address_post_4ZQ5r3I60o',
  guests: 'radio_6q2cg10z0S',
  filmingConsent: 'radio_17vc6yN7V6',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function captureCookies(response, cookies) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : response.headers.getAll('Set-Cookie');
  for (const cookie of setCookies) {
    const pair = cookie.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function upstreamHeaders(cookies) {
  return {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
    'user-agent': USER_AGENT,
    origin: SOURCE_ORIGIN,
    referer: SOURCE_URL,
    'x-requested-with': 'XMLHttpRequest',
    cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
  };
}

export async function onRequestPost({ request, prepareOnly = false }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return json({ ok: false, message: '이 페이지에서 직접 제출해 주세요.' }, 403);
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return json({ ok: false, message: '잘못된 요청입니다.' }, 415);
  }
  const raw = await request.text();
  if (raw.length > 8192) return json({ ok: false, message: '입력 내용이 너무 깁니다.' }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, message: '잘못된 요청입니다.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.website) {
    return json({ ok: false, message: '잘못된 요청입니다.' }, 400);
  }
  const fields = {};
  for (const key of Object.keys(FIELDS)) {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    const maxLength = key === 'address' || key === 'addressDetail' ? 300 : 100;
    if (!value || value.length > maxLength) {
      return json({ ok: false, message: '필수 항목을 확인해 주세요.' }, 400);
    }
    fields[key] = value;
  }
  if (!/^\d{2,4}$/.test(fields.phoneFirst) || !/^\d{3,4}$/.test(fields.phoneMiddle) ||
      !/^\d{4}$/.test(fields.phoneLast) || !/^\d{5}$/.test(fields.postcode)) {
    return json({ ok: false, message: '연락처와 우편번호를 확인해 주세요.' }, 400);
  }
  if (!['0', '1', '2', '3', 'etc'].includes(fields.guests) || fields.filmingConsent !== '동의') {
    return json({ ok: false, message: '동반인원 수와 촬영 동의를 확인해 주세요.' }, 400);
  }
  const guestsDetail = typeof body.guestsDetail === 'string' ? body.guestsDetail.trim() : '';
  if (fields.guests === 'etc' && (!guestsDetail || guestsDetail.length > 100)) {
    return json({ ok: false, message: '동반인원 수를 직접 입력해 주세요.' }, 400);
  }

  let submissionStarted = false;
  try {
    // A fresh anonymous session keeps tokens/cookies out of the browser and storage.
    const cookies = new Map();
    const source = await fetch(SOURCE_URL, { headers: { accept: 'text/html', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!source.ok) throw new Error('source_unavailable');
    captureCookies(source, cookies);
    const html = await source.text();
    const originalForm = html.match(new RegExp(`<form\\b[^>]*id=["']addForm${WIDGET_CODE}["'][^>]*>([\\s\\S]*?)<\\/form>`))?.[1];
    if (!originalForm) throw new Error('source_form_changed');
    const payload = new URLSearchParams();
    for (const key of ['board_code', 'unit_code', 'widget_code', 'board_name']) {
      const value = originalForm.match(new RegExp(`name=["']${key}["']\\s+value=["']([^"']+)["']`))?.[1];
      if (!value) throw new Error('source_form_changed');
      payload.set(key, value);
    }
    for (const [key, upstreamName] of Object.entries(FIELDS)) {
      if (!originalForm.includes(`name="${upstreamName}"`) && !originalForm.includes(`name='${upstreamName}'`)) {
        throw new Error('source_fields_changed');
      }
      payload.set(upstreamName, fields[key]);
    }
    if (!/name=["']radio_etc_6q2cg10z0S["']/.test(originalForm)) throw new Error('source_fields_changed');
    payload.set('radio_etc_6q2cg10z0S', fields.guests === 'etc' ? guestsDetail : '');
    const tokenResponse = await fetch(`${SOURCE_ORIGIN}/ajax/make_token.cm?form`, {
      method: 'POST',
      headers: upstreamHeaders(cookies),
      body: 'expire=86400',
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!tokenResponse.ok) throw new Error('token_unavailable');
    captureCookies(tokenResponse, cookies);
    const token = await tokenResponse.json();
    if (!token.token || token.token_key == null) throw new Error('token_unavailable');
    payload.set('write_token', token.token);
    payload.set('write_token_key', String(token.token_key));

    if (prepareOnly) return json({ ok: true, ready: true });

    // Never automatically retry this POST: a lost response can already be saved.
    submissionStarted = true;
    const submission = await fetch(`${SOURCE_ORIGIN}/ajax/form_add.cm`, {
      method: 'POST',
      headers: upstreamHeaders(cookies),
      body: payload,
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (!submission.ok) throw new Error('submission_response_unavailable');
    const result = await submission.json();
    if (result.msg !== 'SUCCESS') {
      return json({ ok: false, message: '접수하지 못했습니다. 입력 내용을 확인해 주세요.' }, 422);
    }
    return json({ ok: true, message: '정상적으로 접수되었습니다.' });
  } catch (error) {
    return json({
      ok: false,
      code: submissionStarted ? 'SUBMISSION_UNCONFIRMED' : ({ source_unavailable: 'SOURCE_UNAVAILABLE', source_form_changed: 'SOURCE_FORM_CHANGED', source_fields_changed: 'SOURCE_FIELDS_CHANGED', token_unavailable: 'TOKEN_UNAVAILABLE' }[error.message] || 'PREPARATION_FAILED'),
      message: submissionStarted
        ? '접수 결과를 확인하지 못했습니다. 중복 제출을 피하려면 접수 여부를 먼저 확인해 주세요.'
        : '접수 연결을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    }, 502);
  }
}
