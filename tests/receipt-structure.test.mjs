import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const cache = new Map();
function load(url) {
  url = new URL(url, import.meta.url);
  if (cache.has(url.href)) return cache.get(url.href);
  const exports = {}; cache.set(url.href, exports);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', code)(exports, p => load(new URL(p.endsWith('.ts') ? p : `${p}.ts`, url)));
  return exports;
}
const { groundedIn, parseReceiptItems, structureReceipt, receiptResponse } = load('../supabase/functions/_shared/receipt.ts');

const lines = ['상품명 수량 단가 금액', '백설콩식용유1.8L', '8801007402345 1 3,250 3,250s', '미닛메이드제주감귤1.5L', '8801094626402 1 990 990s', '합계 4,240'];
const gemini = (body, status = 200) => async () => status === 200 ? Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }) : new Response('', { status });
const word = (text, y) => ({ text, box: [10, y, 50, y + 20] });

test('accepts items that point at a real line and flags names the line does not support', () => {
  const items = parseReceiptItems({ items: [
    { name: '콩식용유', quantity: 1, line: 1 },
    { name: '감귤주스', quantity: 1, line: 3 },
    { name: '소고기', quantity: 1, line: 5 },
    { name: '바나나', quantity: 1, line: 40 },
    { name: '튀김가루', quantity: 1, line: 0 },
  ] }, lines);
  assert.deepEqual(items.map(({ name, suspicious }) => [name, suspicious]), [['콩식용유', false], ['감귤주스', false], ['소고기', true], ['튀김가루', true]]);
});

test('merges repeated names, clamps quantity and rejects malformed results', () => {
  const items = parseReceiptItems({ items: [{ name: ' 콩식용유 ', quantity: 0, line: 1 }, { name: '콩식용유', quantity: 2, line: 1 }] }, lines);
  assert.deepEqual(items, [{ name: '콩식용유', quantity: 3, suspicious: false }]);
  assert.throws(() => parseReceiptItems({ items: [{ name: '콩식용유', quantity: '1', line: 1 }] }, lines));
  assert.throws(() => parseReceiptItems({}, lines));
  assert.equal(groundedIn('식', '식용유'), false);
});

test('sends numbered lines to Gemini and reads its structured items', async () => {
  let sent;
  const items = await structureReceipt('K', 'gemini-3.6-flash', lines, async (url, init) => { sent = JSON.parse(init.body); return gemini({ items: [{ name: '튀김가루', quantity: 1, line: 1 }] })(); });
  assert.match(sent.contents[0].parts[0].text, /\n1: 백설콩식용유1\.8L\n2: 8801007402345/);
  assert.equal(sent.generationConfig.responseJsonSchema.required[0], 'items');
  assert.equal(items[0].name, '튀김가루');
});

test('falls back to words only when Gemini is missing or fails', async () => {
  const words = [word('대파', 0), word('990', 0)];
  assert.deepEqual(await receiptResponse(words, undefined, 'gemini-3.6-flash'), { words });
  const failed = await receiptResponse(words, 'K', 'gemini-3.6-flash', gemini(null, 503));
  assert.deepEqual(failed, { words });
  const ok = await receiptResponse(words, 'K', 'gemini-3.6-flash', gemini({ items: [{ name: '대파', quantity: 1, line: 0 }] }));
  assert.deepEqual(ok.items, [{ name: '대파', quantity: 1, suspicious: false }]);
});

test('checks the neighbouring lines when OCR splits a product name in two', () => {
  const split = ['백설 콩 2 990 1,980s', '식용유 1.8L', '8801007402345'];
  assert.equal(parseReceiptItems({ items: [{ name: '콩식용유', quantity: 2, line: 0 }] }, split)[0].suspicious, false);
});
