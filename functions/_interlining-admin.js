import { fetchImwebJson } from './_imweb.js';

export const INTERLINING_UNIT = 'u20251229236e9cd97a160';
export const INTERLINING_FORM = 'b2026101363ba4ccc3c2e2';

export function adminJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export class InterliningError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function communityData(env, path, params) {
  const url = new URL(`https://openapi.imweb.me/community/${path}`);
  url.search = new URLSearchParams(params).toString();
  const { response, payload } = await fetchImwebJson(env, url.toString(), {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || (payload.statusCode && Number(payload.statusCode) !== 200)) {
    const code = String(payload.error?.errorCode || payload.error?.code || payload.errorCode || payload.code || payload.statusCode || response.status);
    if (response.status === 403 || code === '30103') {
      throw new InterliningError('COMMUNITY_PERMISSION_REQUIRED', '신청 목록 조회 권한을 연결해 주세요.', 403);
    }
    if (response.status === 401 || ['30101', '30102', 'MISSING_IMWEB_ACCESS_TOKEN'].includes(code)) {
      throw new InterliningError('IMWEB_CONNECTION_REQUIRED', '아임웹 연결을 다시 확인해 주세요.', 503);
    }
    throw new InterliningError('IMWEB_UNAVAILABLE', '신청 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!payload.data || !Array.isArray(payload.data.list)) {
    throw new InterliningError('IMWEB_RESPONSE_CHANGED', '신청 목록 응답을 확인하지 못했습니다.');
  }
  return payload.data;
}

export async function resolveInterliningForm(env) {
  for (let page = 1; page <= 20; page++) {
    const data = await communityData(env, 'forms', { page, limit: 100, unitCode: INTERLINING_UNIT });
    const form = data.list.find((item) =>
      (item.formCode === INTERLINING_FORM || item.boardCode === INTERLINING_FORM) &&
      item.unitCode === INTERLINING_UNIT,
    );
    if (form && Number.isInteger(Number(form.formNo)) && Number(form.formNo) > 0) return Number(form.formNo);
    if (page >= Number(data.totalPage || 1)) break;
  }
  throw new InterliningError('FORM_NOT_FOUND', 'interlining 입력폼을 찾지 못했습니다. 연결된 사이트를 확인해 주세요.', 404);
}

function answerText(item) {
  const values = Array.isArray(item.valueList) ? item.valueList.filter((value) => value != null && value !== '') : [];
  if (item.value != null && item.value !== '') values.unshift(item.value);
  const parts = [...new Set(values.map(String))];
  const separator = item.itemType === 'phonenumber' && parts.length === 3 && parts.every((part) => /^\d+$/.test(part)) ? '-' : ' / ';
  const base = parts.join(separator);
  return item.etcValue ? `${base}${base ? ' / ' : ''}${item.etcValue}` : base;
}

export function normalizeSubmission(row) {
  const answers = (Array.isArray(row.item) ? row.item : []).map((item) => ({
    code: String(item.itemCode || ''),
    label: String(item.itemSubject || ''),
    value: answerText(item),
  }));
  const answer = (code, label) => answers.find((item) => item.code === code)?.value ||
    answers.find((item) => item.label === label)?.value || '';
  return {
    code: String(row.submitCode || ''),
    submittedAt: String(row.wtime || ''),
    fullName: answer('39c93ffaf43e1', '성함'),
    instagram: answer('dC0eEfFepr', 'instagram'),
    phone: answer('9074cf8680318', '연락처'),
    address: answer('4ZQ5r3I60o', '주소'),
    guests: answer('6q2cg10z0S', '동반인원 수'),
    filmingConsent: answers.find((item) => item.code === '17vc6yN7V6' || item.label.includes('현장 기록'))?.value || '',
    answers,
  };
}

export function errorResponse(error) {
  return adminJson({ ok: false, error: {
    code: error instanceof InterliningError ? error.code : 'IMWEB_UNAVAILABLE',
    message: error instanceof InterliningError ? error.message : '신청 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  } }, error instanceof InterliningError ? error.status : 502);
}
