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
  constructor(code, message, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function errorResponse(error) {
  return adminJson({ ok: false, error: {
    code: error instanceof InterliningError ? error.code : 'STORAGE_UNAVAILABLE',
    message: error instanceof InterliningError ? error.message : '신청 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  } }, error instanceof InterliningError ? error.status : 503);
}
