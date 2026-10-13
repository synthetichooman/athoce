import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { onRequestPost } from '../functions/api/interlining.js';

const sourceFixture = `<form id="addFormw202610131151c71d9961a">
  <input name="board_code" value="board-example">
  <input name="unit_code" value="unit-example">
  <input name="widget_code" value="w202610131151c71d9961a">
  <input name="board_name" value="interlining, 2026">
  <input name="input_39c93ffaf43e1"><input name="input_dC0eEfFepr">
  <input name="phonenumber1_9074cf8680318"><input name="phonenumber2_9074cf8680318">
  <input name="phonenumber3_9074cf8680318"><input name="address_4ZQ5r3I60o">
  <input name="address_detail_4ZQ5r3I60o"><input name="address_post_4ZQ5r3I60o">
  <input name='radio_6q2cg10z0S'><input name='radio_etc_6q2cg10z0S'><input name='radio_17vc6yN7V6'>
</form>`;
const input = {
  fullName: 'Sample', instagram: '@example', phoneFirst: '010', phoneMiddle: '0000',
  phoneLast: '0000', address: 'Sample address', addressDetail: 'Sample detail', postcode: '00000', guests: '0', filmingConsent: '동의', guestsDetail: '', website: '',
};
function request(body = input, origin = 'https://athoce.kr') {
  return new Request('https://athoce.kr/api/interlining', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('invalid requests never reach the original form', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected upstream call'); });
  for (const [body, origin, expected] of [
    [input, 'https://elsewhere.example', 403], [null, 'https://athoce.kr', 400],
    [{ ...input, fullName: '' }, 'https://athoce.kr', 400],
    [{ ...input, website: 'spam' }, 'https://athoce.kr', 400],
    [{ ...input, phoneLast: 'abc' }, 'https://athoce.kr', 400],
    [{ ...input, postcode: '1234' }, 'https://athoce.kr', 400],
    [{ ...input, filmingConsent: '' }, 'https://athoce.kr', 400],
    [{ ...input, guests: '4' }, 'https://athoce.kr', 400],
    [{ ...input, guests: 'etc', guestsDetail: '' }, 'https://athoce.kr', 400],
    [{ ...input, address: 'x'.repeat(9000) }, 'https://athoce.kr', 413],
  ]) {
    const response = await onRequestPost({ request: request(body, origin) });
    assert.equal(response.status, expected);
    assert.equal((await response.json()).ok, false);
  }
});

test('submissions preserve Imweb field mapping, session cookies, and numeric token keys', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(sourceFixture, { headers: { 'set-cookie': 'session=sample; Path=/; HttpOnly' } });
    if (calls.length === 2) {
      assert.match(options.headers.cookie, /session=sample/);
      return Response.json({ token: 'sample-token', token_key: 123 }, { headers: { 'set-cookie': 'token_session=sample; Path=/' } });
    }
    assert.equal(url, 'https://hooman.kr/ajax/form_add.cm');
    assert.match(options.headers.cookie, /session=sample/);
    assert.match(options.headers.cookie, /token_session=sample/);
    assert.equal(options.body.get('write_token_key'), '123');
    assert.equal(options.body.get('input_39c93ffaf43e1'), input.fullName);
    assert.equal(options.body.get('address_detail_4ZQ5r3I60o'), input.addressDetail);
    assert.equal(options.body.get('board_name'), 'interlining, 2026');
    assert.equal(options.body.get('radio_6q2cg10z0S'), 'etc');
    assert.equal(options.body.get('radio_etc_6q2cg10z0S'), '4');
    assert.equal(options.body.get('radio_17vc6yN7V6'), '동의');
    return Response.json({ msg: 'SUCCESS' });
  });
  const response = await onRequestPost({ request: request({ ...input, guests: 'etc', guestsDetail: '4' }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(calls.length, 3);
});

test('an original form change blocks submission', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response(sourceFixture.replace('address_detail_4ZQ5r3I60o', 'changed_field')));
  const response = await onRequestPost({ request: request() });
  assert.equal(response.status, 502);
  assert.equal(mock.mock.callCount(), 1);
});

test('Cloudflare legacy cookie headers preserve the upstream session', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    count++;
    if (count === 1) {
      return {
        ok: true,
        headers: { getAll: (name) => {
          assert.equal(name, 'Set-Cookie');
          return ['session=sample; Path=/'];
        } },
        text: async () => sourceFixture,
      };
    }
    assert.match(options.headers.cookie, /session=sample/);
    return count === 2
      ? Response.json({ token: 'sample-token', token_key: 123 })
      : Response.json({ msg: 'SUCCESS' });
  });
  const response = await onRequestPost({ request: request() });
  assert.equal((await response.json()).ok, true);
  assert.equal(count, 3);
});

test('ambiguous submissions are never automatically retried or reported as success', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    if (count === 1) return new Response(sourceFixture);
    if (count === 2) return Response.json({ token: 'sample-token', token_key: 123 });
    throw new Error('response lost');
  });
  const response = await onRequestPost({ request: request() });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.match(body.message, /중복 제출/);
  assert.equal(count, 3);
});

test('Imweb rejection is not reported as success', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    if (count === 1) return new Response(sourceFixture);
    if (count === 2) return Response.json({ token: 'sample-token', token_key: 123 });
    return Response.json({ msg: 'FORM_CLOSED' });
  });
  const response = await onRequestPost({ request: request() });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).ok, false);
});

test('both direct URL variants and required input names are present', async () => {
  const redirects = await readFile(new URL('../_redirects', import.meta.url), 'utf8');
  assert.match(redirects, /^\/interlining \/interlining\/index.html 200$/m);
  assert.match(redirects, /^\/interlining\/ \/interlining\/index.html 200$/m);
  const html = await readFile(new URL('../interlining/index.html', import.meta.url), 'utf8');
  for (const name of Object.keys(input)) assert.ok(html.includes(`name="${name}"`));
});
