export const SUBMISSION_PREFIX = 'interlining:submission:';

export async function saveSubmission(env, fields, id) {
  if (!env?.ATHOCE_KV) throw new Error('Submission storage is unavailable');
  const key = `${SUBMISSION_PREFIX}${id}`;
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields))))].map((value) => value.toString(16).padStart(2, '0')).join('');
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
  const address = `${fields.address} / ${fields.addressDetail} / ${fields.postcode}`;
  const guests = fields.guests === 'etc' ? fields.guestsDetail : fields.guests;
  const record = {
    code: `athoce-${id}`, source: 'athoce', submittedAt: new Date().toISOString(), fingerprint,
    fullName: fields.fullName, instagram: fields.instagram, phone, address, guests, filmingConsent: fields.filmingConsent,
    answers: [
      { code: '39c93ffaf43e1', label: '성함', value: fields.fullName },
      { code: 'dC0eEfFepr', label: 'instagram', value: fields.instagram },
      { code: '9074cf8680318', label: '연락처', value: phone },
      { code: '4ZQ5r3I60o', label: '주소', value: address },
      { code: '6q2cg10z0S', label: '동반인원 수', value: guests },
      { code: '17vc6yN7V6', label: '현장 기록 촬영 동의', value: fields.filmingConsent },
    ],
  };
  // One key per response avoids lost records from concurrent list updates.
  await env.ATHOCE_KV.put(key, JSON.stringify(record), { metadata: { submittedAt: record.submittedAt } });
  return record;
}

export async function submissionKeys(env) {
  if (!env?.ATHOCE_KV) throw new Error('Submission storage is unavailable');
  const keys = [];
  let cursor;
  do {
    const result = await env.ATHOCE_KV.list({ prefix: SUBMISSION_PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    keys.push(...result.keys);
    if (result.list_complete) break;
    if (!result.cursor || result.cursor === cursor) throw new Error('Submission listing is incomplete');
    cursor = result.cursor;
  } while (true);
  return keys.sort((a, b) => String(b.metadata?.submittedAt || '').localeCompare(String(a.metadata?.submittedAt || '')) || b.name.localeCompare(a.name));
}

export async function readSubmissions(env, keys) {
  const records = await Promise.all(keys.map((key) => env.ATHOCE_KV.get(key.name, 'json')));
  if (records.some((row) => !row || !row.code || !Array.isArray(row.answers))) throw new Error('Submission record is unavailable');
  return records.map(({ fingerprint, ...record }) => record);
}
