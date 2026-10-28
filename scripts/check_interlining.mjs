import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { onRequestPost } from '../functions/api/interlining.js';

test('closed intake rejects old clients before reading requests or touching storage', async () => {
  const response = await onRequestPost({ request: { text() { throw new Error('must not read personal data'); } }, env: { ATHOCE_KV: new Proxy({}, { get() { throw new Error('must not store personal data'); } }) } });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'INTAKE_CLOSED');
});
test('archived invitation has no collection form or form script', async () => {
  const html = await readFile(new URL('../interlining/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<form|<input|<script/);
  assert.match(html, /접수가 종료되었습니다/);
});
