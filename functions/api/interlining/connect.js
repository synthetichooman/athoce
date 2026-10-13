import { adminJson } from '../../_interlining-admin.js';

// Retire old bookmarks without initiating any external authorization.
export function onRequestGet() {
  return adminJson({ ok: false, error: { code: 'CONNECTION_NOT_NEEDED', message: '별도 연결 없이 ATHOCE에서 접수와 조회가 가능합니다.' } }, 410);
}
