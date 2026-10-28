// The event has ended and its personal data has been destroyed.
// Reject old tabs and retries before reading or storing any applicant data.
export function onRequestPost() {
  return new Response(JSON.stringify({ ok: false, code: 'INTAKE_CLOSED', message: 'interlining 접수가 종료되었습니다.' }), {
    status: 410,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
