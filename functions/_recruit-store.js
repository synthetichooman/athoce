import { submissionKeys as listKeys, readSubmissions } from './_interlining-store.js';
export const SUBMISSION_PREFIX = 'recruit:submission:';
export const submissionKeys = (env) => listKeys(env, SUBMISSION_PREFIX);
export { readSubmissions };

export async function saveSubmission(env, fields, id) {
  if (!env?.ATHOCE_KV) throw new Error('Submission storage is unavailable');
  const key = `${SUBMISSION_PREFIX}${id}`;
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields))))].map(b => b.toString(16).padStart(2, '0')).join('');
  const existing = await env.ATHOCE_KV.get(key, 'json');
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      const error = new Error('This submission already exists');
      error.code = 'SUBMISSION_CONFLICT';
      throw error;
    }
    return existing;
  }
  const phone = [fields.phoneFirst, fields.phoneMiddle, fields.phoneLast].join('-');
  const availableDays = fields.availableDays.join(', ');
  const record = {
    code: `recruit-${id}`, source: 'athoce', submittedAt: new Date().toISOString(), fingerprint,
    fullName: fields.fullName, instagram: fields.instagram, phone, availableDays,
    introduction: fields.introduction,
    answers: [
      { code: 'fullName', label: '이름', value: fields.fullName },
      { code: 'instagram', label: '인스타그램', value: fields.instagram },
      { code: 'phone', label: '연락처', value: phone },
      { code: 'availableDays', label: '근무 가능 요일', value: availableDays },
      { code: 'introduction', label: '자기소개', value: fields.introduction },
    ],
  };
  await env.ATHOCE_KV.put(key, JSON.stringify(record), { metadata: { submittedAt: record.submittedAt } });
  return record;
}
