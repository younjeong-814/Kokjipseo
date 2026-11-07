import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/receipt/parseReceipt.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function('exports', compiled)(exports);
const { groupRows, parseReceipt, cleanName, readQuantity } = exports;

const word = (text, x, y) => ({ text, box: [x, y, x + 40, y + 20] });

test('groups column-ordered words into rows by vertical position', () => {
  // Vision이 이름 열을 먼저, 금액 열을 나중에 읽은 경우
  const words = [word('두부', 10, 100), word('대파', 10, 130), word('2,500', 200, 102), word('2,000', 200, 131), word('1', 150, 99), word('1', 150, 129)];
  assert.deepEqual(groupRows(words), ['두부 1 2,500', '대파 1 2,000']);
});

test('extracts items between header and total, with quantity, date and time', () => {
  const result = parseReceipt([
    '콕집서 마트',
    '구매 영수증',
    '2026.10.13 14:30',
    '상품명 수량 금액',
    '001 CJ 행복한콩 두부(300g) 2 5,000',
    '대파 1 2,000',
    '서울우유 1L 1 3,200',
    '종량제봉투 10L 1 500',
    '대파 1 2,000',
    '합계 12,700원',
    '카드 결제 12,700',
  ]);
  assert.equal(result.date, '2026-10-13');
  assert.equal(result.time, '14:30');
  assert.deepEqual(result.items.map(({ name, quantity }) => [name, quantity]), [
    ['CJ 행복한콩 두부', 2],
    ['대파', 2],
    ['서울우유', 1],
  ]);
});

test('attaches quantity printed on the following barcode line', () => {
  const { items } = parseReceipt(['상품명', '양파 1.5kg', '8801234567890 3 2,990 8,970', '합계 8,970']);
  assert.deepEqual(items.map(({ name, quantity }) => [name, quantity]), [['양파', 3]]);
});

test('cleans product names', () => {
  assert.equal(cleanName('*[행사] 국산 깐마늘 200g'), '국산 깐마늘');
  assert.equal(cleanName('12345 6,000'), '');
});

test('reads quantity in "unit price, quantity, amount" order', () => {
  const { items } = parseReceipt(['상품명 단가 수량 금액', '풀무원 국산콩 두부 2,500 2 5,000', '양파 3,980 1 3,980', '서울우유 1L 2,980 3 8,940', '합계 17,920']);
  assert.deepEqual(items.map(({ name, quantity }) => [name, quantity]), [['풀무원 국산콩 두부', 2], ['양파', 1], ['서울우유', 3]]);
  assert.equal(readQuantity(['2', '1,000', '2,000']), 2);
  assert.equal(readQuantity(['1', '2,500']), 1);
  assert.equal(readQuantity(['2,500']), 1);
});

test('keeps tax-marked items and stops at purchase total', () => {
  const { items } = parseReceipt(['품명 수량 금액', '(면세)계란 10구 1 4,990', '행사할인 -500', '바나나우유 2 3,400', '종량제봉투 10L 1 500', '총 구매액 8,390']);
  assert.deepEqual(items.map(({ name, quantity }) => [name, quantity]), [['계란', 1], ['바나나우유', 2]]);
});

test('sums duplicates when quantity is on the following barcode line', () => {
  const { items } = parseReceipt(['상품명', '두부', '8801234567890 2 2,500 5,000', '두부', '8801234567890 1 2,500 2,500', '합계 7,500']);
  assert.deepEqual(items.map(({ name, quantity }) => [name, quantity]), [['두부', 3]]);
});

test('reads two-digit years', () => {
  assert.equal(parseReceipt(['26.10.13 18:00', '상품명', '고등어 1 5,900', '합계 5,900']).date, '2026-10-13');
});

test('without a header, keeps only lines that carry an amount', () => {
  const { items } = parseReceipt(['GS25 성수역점', '서울시 성동구 아차산로 100', '2026년 10월 13일 14:22', '바나나우유 1,700', '신라면 1,100', '감사합니다 또 오세요', '합계 2,800']);
  assert.deepEqual(items.map(({ name }) => name), ['바나나우유', '신라면']);
});

test('drops a name line when no amount line follows it', () => {
  const { items } = parseReceipt(['상품명', '행사상품 안내', '두부', '8801234567890 1 2,500 2,500', '합계 2,500']);
  assert.deepEqual(items.map(({ name, quantity }) => [name, quantity]), [['두부', 1]]);
});

test('drops receipt notice sentences even when numbers follow them', () => {
  const { items } = parseReceipt([
    '개할 경우 법적 처벌 을 받을 수 있습니다 2',
    '상품명',
    '두부 1 2,500',
    '공개할 경우 법적 처벌 을 받을 수 있습니다',
    '0001 0002',
    '교환·환불은 영수증을 지참해 주세요 7',
    '개인정보 처리방침 안내 1',
    '감사합니다 1',
    '합계 2,500',
  ]);
  assert.deepEqual(items.map(({ name }) => name), ['두부']);
});

test('keeps items whose amount carries a tax mark such as 1,980s', () => {
  const { items } = parseReceipt([
    '상품명 수량 단가 금액',
    '백설콩식용유1.8L',
    '8801007402345 1 3,250 3,250s',
    '곰표튀김가루1kg',
    '8801176250020 1 1,250 1,250s',
    'N)고래밥볶음4P2700',
    '8801117115302 2 990 1,980 s',
    '대파',
    '201017 * 1 990 990',
    '미닛메이드제주감귤1.5L',
    '8801094626402 1 990 990s',
    '합계 8,450',
  ]);
  assert.deepEqual(items.map(({ name, quantity }) => [name, quantity]), [
    ['백설콩식용유', 1], ['곰표튀김가루', 1], ['N 고래밥볶음4P2700', 2], ['대파', 1], ['미닛메이드제주감귤', 1],
  ]);
});
