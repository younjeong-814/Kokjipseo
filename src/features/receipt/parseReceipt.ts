// Vision OCR 단어 목록을 영수증 품목으로 바꾼다. 화면과 테스트에서 같이 쓰도록 순수 함수로 둔다.
export type OcrWord = { text: string; box: [number, number, number, number] };
export type ReceiptItem = { name: string; quantity: number; suspicious: boolean };
export type ReceiptResult = { items: ReceiptItem[]; date?: string; time?: string };

// Vision은 열 단위로 읽을 때가 많아서 단어의 세로 위치로 같은 줄을 다시 묶는다.
export function groupRows(words: OcrWord[]): string[] {
  const sorted = words
    .map(word => ({ text: word.text, x: word.box[0], y: (word.box[1] + word.box[3]) / 2, height: Math.max(1, word.box[3] - word.box[1]) }))
    .sort((a, b) => a.y - b.y);
  const rows: { y: number; height: number; words: typeof sorted }[] = [];
  for (const word of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(word.y - row.y) < Math.min(row.height, word.height) * 0.6) {
      row.words.push(word);
      row.y = row.words.reduce((sum, item) => sum + item.y, 0) / row.words.length;
    } else rows.push({ y: word.y, height: word.height, words: [word] });
  }
  return rows.map(row => row.words.sort((a, b) => a.x - b.x).map(word => word.text).join(' '));
}

const HEADER = /상품\s*명|품\s*명|품\s*목|상\s*품/;
const FOOTER = /합\s*계|총\s*액|총\s*금\s*액|구\s*매\s*액|판\s*매\s*액|결\s*제\s*금\s*액|받\s*을\s*금\s*액|받\s*은\s*금\s*액|과\s*세\s*물\s*품|면\s*세\s*물\s*품|부\s*가\s*세/;
const EXCLUDED = /봉투|쇼핑백|할인|쿠폰|포인트|적립|부가세|과세|면세|합계|카드|결제|승인|거스름|현금|영수증|사업자|대표|전화|TEL|주소|POS|계산원|교환|환불|회원|단가|수량|금액|매장|가맹점/i;
// 금액 뒤에 과세 표시(s)나 면세 표시(*, #)를 붙여 찍는 영수증이 있다. 1,980s · 990*
const AMOUNT = /^[\d,.]+(?:원|[sS*#])?$/;
// 영수증 하단 안내문. "~할 경우 법적 처벌을 받을 수 있습니다"처럼 문장으로 끝나거나 안내에만 쓰는 단어가 있는 줄
const NOTICE = /(?:니다|세요|십시오|바랍니다)[.!]?(?:\s|$)|경우|처벌|법적|무단|개인정보|고객센터|문의|유의|지참|보관하/;
// 서울시 성동구, 성남시 분당구처럼 시·도 다음에 구·군이 오는 주소 줄
const ADDRESS = /\S+[시도]\s+\S+[구군](?:\s|$)/;
// 면세·과세 표시는 품목 줄에도 붙는다. 제외 규칙에 걸리지 않게 먼저 지운다.
const TAX_MARK = /[([]\s*[면과]\s*세\s*[)\]]/g;
const SIZE = /\d+(?:\.\d+)?\s*(?:kg|g|ml|l|입|개입|개|봉|팩|구|ea|매|미|캔|병)(?![a-z])/gi;

export function parseReceipt(lines: string[]): ReceiptResult {
  const result: ReceiptResult = { items: [] };
  const text = lines.join('\n');
  // 4자리 연도를 먼저 찾고, 없으면 26.10.13 같은 2자리 연도를 본다.
  const date = text.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/) ?? text.match(/(?<![\d.])(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?![\d.])/);
  if (date) {
    const [year, month, day] = [Number(date[1].length === 2 ? `20${date[1]}` : date[1]), Number(date[2]), Number(date[3])];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) result.date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const time = text.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?!\d)/);
  if (time) result.time = `${time[1].padStart(2, '0')}:${time[2]}`;

  const header = lines.findIndex(line => HEADER.test(line));
  let section = header >= 0 ? lines.slice(header + 1) : lines;
  const footer = section.findIndex(line => FOOTER.test(line));
  if (footer >= 0) section = section.slice(0, footer);

  const items = new Map<string, ReceiptItem>();
  const add = (name: string, quantity: number) => {
    const existing = items.get(name);
    if (existing) existing.quantity += quantity;
    else items.set(name, { name, quantity, suspicious: name.length < 2 || /\d/.test(name) });
  };
  // 품목 줄에는 항상 금액이 있다. 금액 없는 줄(상호·날짜·인사말)은 다음 줄에 금액이 따로 찍힐 때만 품목이 된다.
  let pending: string | undefined;
  for (const raw of section) {
    const line = raw.replace(TAX_MARK, ' ');
    if (EXCLUDED.test(line) || NOTICE.test(line) || ADDRESS.test(line)) { pending = undefined; continue; }
    // OCR이 과세 표시를 금액과 떨어진 단어로 읽으면(1,980 s) 금액에 다시 붙인다.
    const tokens = line.replace(/\b\d{8,14}\b/g, ' ').replace(/(\d)\s+[sS](?=\s|$)/g, '$1').trim().split(/\s+/).filter(Boolean);
    const numbers: string[] = [];
    while (tokens.length && AMOUNT.test(tokens.at(-1)!)) numbers.unshift(tokens.pop()!);
    const name = cleanName(tokens.join(' '));
    // 바코드·수량·금액이 다음 줄에 따로 찍힌 영수증: 바로 앞 이름 줄의 품목으로 센다.
    if (!name) { if (pending && numbers.length) add(pending, readQuantity(numbers)); pending = undefined; continue; }
    if (numbers.length) { add(name, readQuantity(numbers)); pending = undefined; }
    else pending = name;
  }
  result.items = [...items.values()];
  return result;
}

// 줄 끝 숫자들에서 수량을 고른다.
// 단가 × 수량 = 금액이 성립하는 숫자를 우선한다(상품명 단가 수량 금액, 상품명 수량 단가 금액).
// 성립하지 않으면 '상품명 수량 금액' 형식으로 보고 첫 숫자를 쓴다.
export function readQuantity(numbers: string[]): number {
  const values = numbers.map(token => Number(token.replace(/[,원sS*#]/g, '')));
  const isCount = (index: number) => /^\d{1,2}$/.test(numbers[index]) && values[index] > 0;
  for (let index = 0; index < numbers.length; index++) {
    if (isCount(index) && values.some((price, j) => j !== index && values.some((total, k) => k !== index && k !== j && price * values[index] === total))) return values[index];
  }
  return numbers.length >= 2 && isCount(0) ? values[0] : 1;
}

export function cleanName(raw: string): string {
  const name = raw
    .replace(/^\s*\d{1,3}\s*[.)]?\s+/, '')
    .replace(/[[(（【<].*?[\])）】>]/g, ' ')
    .replace(SIZE, ' ')
    .replace(/[x×*]\s*\d+/gi, ' ')
    .replace(/[^\p{Script=Hangul}A-Za-z0-9 ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\p{Script=Hangul}/u.test(name) ? name.slice(0, 60) : '';
}
