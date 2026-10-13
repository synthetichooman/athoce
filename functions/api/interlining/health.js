import { interliningAccess } from '../../_interlining-access.js';
import { adminJson } from '../../_interlining-admin.js';
import { onRequestPost } from '../interlining.js';

// Check the actual submission session without saving a response or exposing tokens.
export async function onRequestGet({ env, request }) {
  if (!(await interliningAccess(request, env))) return adminJson({ ok: false }, 401);
  if (new URL(request.url).searchParams.get('stage') === 'source') {
    try {
      const source = await fetch('https://hooman.kr/interlining', { headers: { accept: 'text/html', 'user-agent': 'athoce-interlining/1.0 (+https://athoce.kr/interlining)' }, signal: AbortSignal.timeout(10000) });
      const html = await source.text();
      return adminJson({ ok: source.ok, status: source.status, bytes: html.length, formFound: html.includes('addFormw202610131151c71d9961a'), ...(source.ok ? {} : { upstreamMessage: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) }) });
    } catch (error) { return adminJson({ ok: false, error: String(error.message).slice(0, 200) }, 502); }
  }
  const origin = new URL(request.url).origin;
  const probe = new Request(`${origin}/api/interlining`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'connection check', instagram: 'connection check', phoneFirst: '010', phoneMiddle: '0000', phoneLast: '0000', address: 'connection check', addressDetail: 'connection check', postcode: '00000', guests: '0', filmingConsent: '동의' }),
  });
  return onRequestPost({ request: probe, prepareOnly: true });
}
