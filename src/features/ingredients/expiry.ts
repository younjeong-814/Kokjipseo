import { storageRecommendations } from '../../data/storageRecommendations';
import { toDateKey } from '../../lib/date';
import { matchIngredient } from './classify';

const normalized = (value: string) => value.normalize('NFC').replace(/\s+/g, '');
const rowsNamed = (name: string) => storageRecommendations.filter(row => [normalized(row.name), normalized(row.name + row.variant)].includes(normalized(name)));
/**
 * DB에서 찾을 이름. 정확히 같은 이름이 있으면 그대로 쓰고, 없으면 분류 규칙의 키워드로 찾는다.
 * 풀무원 국산콩 두부 → 두부, 서울우유 → 우유. 키워드도 DB에 없으면 null(추측하지 않음).
 */
export function recommendationName(name: string): string | null {
  if (rowsNamed(name).length) return name;
  const keyword = matchIngredient(name)?.keyword;
  return keyword && rowsNamed(keyword).length ? keyword : null;
}
export const ingredientCategories = ['육류', '과일', '채소', '두부·콩류', '유제품', '수산물', '조미료·소스', '가공식품', '기타 식재료'] as const;
export const foodCategories = ['밀키트', '반찬', '국·찌개', '배달음식', '기타 음식'] as const;
export function categoryKind(category = ''): 'ingredient' | 'food' | undefined {
  if (foodCategories.some(value => value === category) || category === '국·탕' || category === '기타음식') return 'food';
  if (ingredientCategories.some(value => value === category) || category === '조미료' || category === '기타식재료') return 'ingredient';
  return undefined;
}
export const isFood = (item: { name: string; category?: string; kind?: 'ingredient' | 'food' }) => {
  const kind = categoryKind(item.category) ?? item.kind;
  if (kind) return kind === 'food';
  const name = recommendationName(item.name);
  return name !== null && rowsNamed(name).some(row => row.category === '음식');
};

// "냉동 비권장"처럼 다른 보관방식을 가리키는 메모는 그 행을 막지 않는다. "비권장"만 있으면 그 행이 비권장이다.
const discouraged = (row: { storage: string; note: string }) => {
  const match = row.note.match(/(냉장|냉동|실온)?\s*비권장/);
  return Boolean(match) && (!match![1] || row.storage.split('/').includes(match![1]));
};
/** 인식 결과의 보관 위치: 기록이 하나면 그것, 아니면 냉장 → 실온 → 냉동 순. DB에 없으면 냉장. */
export function defaultStorage(name: string): '냉장' | '냉동' | '실온' {
  const found = recommendationName(name);
  const options = new Set((found ? rowsNamed(found) : []).filter(row => !discouraged(row)).flatMap(row => row.storage.split('/')));
  if (options.size === 1) return [...options][0] as '냉장' | '냉동' | '실온';
  return options.has('냉장') || !options.size ? '냉장' : options.has('실온') ? '실온' : '냉동';
}

/** Exact DB name first, then the classification keyword (recommendationName). Qualified rows require a variant or qualified name. */
export function recommendedDays(name: string, storage: string, variant = ''): number | null {
  const exact = exactRecommendedDays(name, storage, variant);
  if (exact !== null) return exact;
  const keyword = recommendationName(name);
  return keyword && keyword !== name ? exactRecommendedDays(keyword, storage, variant) : null;
}

function exactRecommendedDays(name: string, storage: string, variant: string): number | null {
  const matches = storageRecommendations.filter(row => row.storage.split('/').includes(storage) && (
    variant ? normalized(row.name) === normalized(name) && normalized(row.variant) === normalized(variant)
      : normalized(row.name + row.variant) === normalized(name) || (!row.variant && normalized(row.name) === normalized(name))
        || (row.category === '음식' && ['입력 시', '보관 처리'].includes(row.variant) && normalized(row.name) === normalized(name))
  ));
  return matches.length ? Math.min(...matches.map(row => row.days)) : null;
}

export function calculateRecommendedDate(name: string, storage: string, startedOn: string, variant = ''): string {
  const days = recommendedDays(name, storage, variant);
  const start = new Date(`${startedOn}T00:00:00Z`);
  if (days === null || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== startedOn) return '';
  // Whole calendar days: round down so the recommendation never exceeds 80%.
  start.setUTCDate(start.getUTCDate() + Math.floor(days * 0.8));
  return start.toISOString().slice(0, 10);
}

// 이름으로 DB를 못 찾은 음식은 카테고리 기준 행을 쓴다. 치킨 → 배달음식(3일 × 80% = 2일).
const categoryRecords: Record<string, string> = { '배달음식': '배달음식', '밀키트': '밀키트', '반찬': '반찬', '국·찌개': '조리 음식', '국·탕': '조리 음식' };

// 조미료·소스는 DB의 조미료 행(간장·고추장·된장 등)으로 찾을 때만 날짜를 계산한다.
// 그 밖의 조미료(쌈장·참치액 등)는 비워 둔다. 원재료 행(참치 냉장 1일)이 대신 걸리는 것을 막는다.
const seasoningCategories = ['조미료·소스', '조미료'];
function seasoningWithoutRecord(name: string, category = ''): boolean {
  if (!seasoningCategories.includes(category)) return false;
  const found = recommendationName(name);
  return !found || !rowsNamed(found).some(row => row.category === '조미료');
}

type ExpiryInput ={ name: string; category?: string; storage: string; date: string; storageStartedOn?: string; recommendationVariant?: string; dateSource?: 'manual' | 'automatic' };
export function resolveExpiry<T extends ExpiryInput>(input: T, previous?: ExpiryInput & { createdAt?: string }, now = new Date()) {
  const storageStartedOn = input.storageStartedOn || previous?.storageStartedOn || toDateKey(previous?.createdAt ? new Date(previous.createdAt) : now);
  const automatic = !input.date || input.dateSource === 'automatic' || (input.dateSource !== 'manual' && previous?.dateSource === 'automatic' && input.date === previous.date);
  const variant = input.recommendationVariant ?? previous?.recommendationVariant;
  const record = categoryRecords[input.category ?? ''];
  const date = automatic ? seasoningWithoutRecord(input.name, input.category) ? '' : calculateRecommendedDate(input.name, input.storage, storageStartedOn, variant) || (record ? calculateRecommendedDate(record, input.storage, storageStartedOn) : '') : input.date;
  return { ...input, storageStartedOn, date, dateSource: date ? automatic ? 'automatic' as const : 'manual' as const : undefined };
}

export function deadlineDays(date: string, today = toDateKey(new Date())): number | null {
  return date ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;
}
export function deadlineLabel(days: number) { return days === 0 ? 'D-DAY' : days > 0 ? `D-${days}` : `D+${-days}`; }
export function compareExpiry(a: { date: string }, b: { date: string }) { return (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31'); }
