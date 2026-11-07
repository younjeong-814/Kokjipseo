import { isFood, resolveExpiry, foodCategories, ingredientCategories, categoryKind } from './expiry';
export const INGREDIENTS_KEY = 'kokjipseo.manual-ingredients.v1';
export const categories = [...ingredientCategories, ...foodCategories] as const;
export const storageLocations = ['냉장','냉동','실온'] as const;
export const conditionLabels = ['싱싱해요', '시들시들해요', '못 먹겠어요 (상했어요)'] as const;
export type IngredientSource = 'manual' | 'ocr' | 'camera';
export type IngredientCondition = typeof conditionLabels[number];
export type ConditionRecord = { id: string; recordedAt: string; status: IngredientCondition };
export type IngredientDraft = { name: string; category: string; storage: string; quantity: number; unit: string; date: string; source?: IngredientSource; kind?: 'ingredient' | 'food'; storageStartedOn?: string; recommendationVariant?: string; dateSource?: 'manual' | 'automatic' };
export type Ingredient = IngredientDraft & { id: string; createdAt: string; updatedAt: string; remainingPercent?: number; remainingAdjusted?: boolean; conditionHistory?: ConditionRecord[] };
type LocalStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function validateDraft(draft: IngredientDraft): string | null {
  if (draft.kind !== undefined && !['ingredient', 'food'].includes(draft.kind)) return '등록 종류를 확인해 주세요.';
  if (draft.dateSource !== undefined && !['manual', 'automatic'].includes(draft.dateSource)) return '날짜 설정을 확인해 주세요.';
  if (draft.recommendationVariant !== undefined && typeof draft.recommendationVariant !== 'string') return '보관 조건을 확인해 주세요.';
  if (draft.storageStartedOn !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.storageStartedOn) || !Number.isFinite(Date.parse(`${draft.storageStartedOn}T00:00:00Z`)) || new Date(`${draft.storageStartedOn}T00:00:00Z`).toISOString().slice(0, 10) !== draft.storageStartedOn)) return '올바른 보관 시작일을 선택해 주세요.';
  if (draft.source !== undefined && !['manual','ocr','camera'].includes(draft.source)) return '등록 방식을 확인해 주세요.';
  if (!draft.name.trim() || draft.name.trim().length > 60) return '재료명을 1~60자로 입력해 주세요.';
  if (![...categories, '조미료', '기타', '국·탕', '기타음식', '기타식재료'].some(value => value === draft.category)) return '카테고리를 선택해 주세요.';
  if (!storageLocations.some(value => value === draft.storage)) return '보관 위치를 선택해 주세요.';
  if (!Number.isFinite(draft.quantity) || draft.quantity <= 0) return '수량을 0보다 큰 숫자로 입력해 주세요.';
  if (!draft.unit.trim() || draft.unit.trim().length > 10) return '수량 단위를 1~10자로 입력해 주세요.';
  if (draft.date) {
    const parsed = new Date(`${draft.date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== draft.date) return '올바른 소비 권장일을 선택해 주세요.';
  }
  return null;
}

export function loadIngredients(storage: LocalStorage): Ingredient[] {
  const raw = storage.getItem(INGREDIENTS_KEY);
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || !data.every(item => item && typeof item === 'object' && ['name','category','storage','unit','date','id','createdAt','updatedAt'].every(key => typeof item[key] === 'string') && typeof item.quantity === 'number' && !validateDraft(item) && item.id && Number.isFinite(Date.parse(item.createdAt)) && Number.isFinite(Date.parse(item.updatedAt))) || new Set(data.map(item => item.id)).size !== data.length) throw new Error('Invalid ingredient storage');
  for (const item of data) {
    if (item.remainingAdjusted !== undefined && typeof item.remainingAdjusted !== 'boolean') throw new Error('Invalid remaining adjustment');
    if (item.source !== undefined && !['manual','ocr','camera'].includes(item.source)) throw new Error('Invalid source');
    if (item.remainingPercent !== undefined && ![0,25,50,75,100].includes(item.remainingPercent)) throw new Error('Invalid remaining amount');
    if (item.conditionHistory !== undefined && (!Array.isArray(item.conditionHistory) || !item.conditionHistory.every((record: ConditionRecord) => record && typeof record.id === 'string' && typeof record.recordedAt === 'string' && Number.isFinite(Date.parse(record.recordedAt)) && conditionLabels.includes(record.status)))) throw new Error('Invalid history');
  }
  return (data as Ingredient[]).map(item => item.date ? item : resolveExpiry(item, item));
}

export function saveIngredient(storage: LocalStorage, draft: IngredientDraft, id?: string): Ingredient[] {
  const error = validateDraft(draft);
  if (error) throw new Error(error);
  const items = loadIngredients(storage);
  const previous = id ? items.find(item => item.id === id) : undefined;
  if (id && !previous) throw new Error('다른 탭에서 삭제된 항목입니다. 목록을 다시 확인해 주세요.');
  const now = new Date().toISOString();
  const kind = categoryKind(draft.category) ?? draft.kind ?? previous?.kind ?? (isFood(draft) ? 'food' : 'ingredient');
  const item: Ingredient = { ...previous, ...resolveExpiry(draft, previous), source: previous?.source ?? draft.source ?? 'manual', remainingPercent: previous?.remainingPercent ?? 100, conditionHistory: previous?.conditionHistory ?? [], name: draft.name.trim(), unit: draft.unit.trim(), id: previous?.id ?? crypto.randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now };
  item.kind = kind;
  const next = previous ? items.map(value => value.id === id ? item : value) : [item, ...items];
  storage.setItem(INGREDIENTS_KEY, JSON.stringify(next));
  return next;
}

export function deleteIngredient(storage: LocalStorage, id: string): Ingredient[] {
  return takeIngredient(storage, id).items;
}

export type RemovedIngredient = { item: Ingredient; index: number };

export function takeIngredient(storage: LocalStorage, id: string): { items: Ingredient[]; removed?: RemovedIngredient } {
  const items = loadIngredients(storage);
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return { items };
  const [item] = items.splice(index, 1);
  storage.setItem(INGREDIENTS_KEY, JSON.stringify(items));
  return { items, removed: { item, index } };
}

export function restoreIngredient(storage: LocalStorage, { item, index }: RemovedIngredient): Ingredient[] {
  const items = loadIngredients(storage);
  if (items.some(current => current.id === item.id)) return items;
  items.splice(index, 0, item);
  storage.setItem(INGREDIENTS_KEY, JSON.stringify(items));
  return items;
}

export function updateIngredientDetails(storage: LocalStorage, id: string, patch: { storage: string; date: string; dateSource?: 'manual' | 'automatic'; remainingPercent: number; remainingAdjusted?: boolean }): Ingredient[] {
  const items = loadIngredients(storage);
  const item = items.find(value => value.id === id);
  if (!item) throw new Error('삭제된 항목입니다. 목록을 확인해 주세요.');
  const invalid = validateDraft({ ...item, ...patch });
  if (invalid || ![0,25,50,75,100].includes(patch.remainingPercent)) throw new Error(invalid || '남은 양을 확인해 주세요.');
  const dateSource = patch.dateSource ?? (patch.date && patch.date !== item.date ? 'manual' : item.dateSource);
  const next = items.map(value => value.id === id ? { ...value, ...resolveExpiry({ ...value, ...patch, dateSource }, value), remainingAdjusted: patch.remainingAdjusted === true || value.remainingAdjusted || (value.remainingPercent ?? 100) < 100 || patch.remainingPercent < 100, updatedAt: new Date().toISOString() } : value);
  storage.setItem(INGREDIENTS_KEY, JSON.stringify(next));
  return next;
}

export function recordIngredientCondition(storage: LocalStorage, id: string, status: IngredientCondition): Ingredient[] {
  if (!conditionLabels.includes(status)) throw new Error('상태를 선택해 주세요.');
  const items = loadIngredients(storage);
  if (!items.some(item => item.id === id)) throw new Error('삭제된 항목입니다. 목록을 확인해 주세요.');
  const now = new Date().toISOString();
  const record = { id: crypto.randomUUID(), recordedAt: now, status };
  const next = items.map(item => item.id === id ? { ...item, conditionHistory: [record, ...(item.conditionHistory ?? [])], updatedAt: now } : item);
  storage.setItem(INGREDIENTS_KEY, JSON.stringify(next));
  return next;
}

export function updateIngredientInfo(storage: LocalStorage, id: string, patch: { name: string; quantity?: number; unit?: string }): Ingredient[] {
  const items = loadIngredients(storage);
  const item = items.find(value => value.id === id);
  if (!item) throw new Error('삭제된 항목입니다. 목록을 확인해 주세요.');
  const quantityChanged = patch.quantity !== undefined && patch.quantity !== item.quantity || patch.unit !== undefined && patch.unit !== item.unit;
  if ((item.remainingAdjusted || (item.remainingPercent ?? 100) < 100) && quantityChanged) throw new Error('남은 양이 변경된 식재료는 이름만 수정할 수 있어요.');
  const updated = { ...item, name: patch.name.trim(), quantity: patch.quantity ?? item.quantity, unit: patch.unit?.trim() ?? item.unit, updatedAt: new Date().toISOString() };
  const invalid = validateDraft(updated);
  if (invalid) throw new Error(invalid);
  const next = items.map(value => value.id === id ? resolveExpiry(updated, item) : value);
  storage.setItem(INGREDIENTS_KEY, JSON.stringify(next));
  return next;
}

export function saveRecognizedIngredients(storage: LocalStorage, drafts: IngredientDraft[]): Ingredient[] {
  const items = loadIngredients(storage);
  const now = new Date().toISOString();
  const added = drafts.map(draft => {
    const invalid = validateDraft(draft);
    if (invalid) throw new Error(invalid);
    return { ...resolveExpiry(draft, undefined, new Date(now)), kind: draft.kind ?? (isFood(draft) ? 'food' as const : 'ingredient' as const), name: draft.name.trim(), unit: draft.unit.trim(), source: draft.source ?? 'camera', id: crypto.randomUUID(), createdAt: now, updatedAt: now, remainingPercent: 100, conditionHistory: [] };
  });
  const next = [...added, ...items];
  storage.setItem(INGREDIENTS_KEY, JSON.stringify(next));
  return next;
}
