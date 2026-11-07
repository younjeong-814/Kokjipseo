import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadTs(url) {
  const source = readFileSync(url, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, path => loadTs(new URL(`${path}.ts`, url)));
  return exports;
}
const exports = loadTs(new URL('../src/features/ingredients/repository.ts', import.meta.url));
const expiry = loadTs(new URL('../src/features/ingredients/expiry.ts', import.meta.url));
const sorting = loadTs(new URL('../src/features/fridge/sorting.ts', import.meta.url));

test('food detail categories retain food classification and condition history', () => {
  for (const category of expiry.foodCategories) {
    const db = storage();
    const [item] = saveIngredient(db, { ...draft, category, name: '직접 만든 음식' });
    assert.equal(expiry.isFood(item), true);
    recordIngredientCondition(db, item.id, '시들시들해요');
    const [renamed] = exports.updateIngredientInfo(db, item.id, { name: '새 음식명' });
    assert.equal(renamed.category, category);
    assert.equal(expiry.isFood(renamed), true);
    assert.equal(loadIngredients(db)[0].conditionHistory[0].status, '시들시들해요');
  }
});

test('explicit food registration routes arbitrary names to food and preserves classification on rename', () => {
  const db = storage();
  const [food] = saveIngredient(db, { ...draft, name: '내가 만든 김치볶음밥', category: '기타음식', kind: 'food' });
  const [ingredient] = saveIngredient(db, { ...draft, name: '반찬', kind: 'ingredient' });
  const loaded = loadIngredients(db);
  assert.equal(loaded.filter(expiry.isFood).length, 1);
  assert.equal(loaded.filter(expiry.isFood)[0].id, food.id);
  assert.equal(loaded.filter(item => !expiry.isFood(item))[0].id, ingredient.id);
  const renamed = exports.updateIngredientInfo(db, food.id, { name: '남은 점심' }).find(item => item.id === food.id);
  assert.equal(expiry.isFood(renamed), true);
  saveIngredient(db, { ...ingredient, category: '기타음식', kind: 'food' }, ingredient.id);
  assert.equal(loadIngredients(db).filter(expiry.isFood).length, 2);
});

test('category determines the tab even if name or old kind contradict it; legacy categories remain readable', () => {
  for (const category of expiry.ingredientCategories) assert.equal(expiry.isFood({ name: '반찬', category, kind: 'food' }), false);
  for (const category of expiry.foodCategories) assert.equal(expiry.isFood({ name: '대파', category, kind: 'ingredient' }), true);
  assert.equal(exports.categories.length, 14);
  assert.equal(expiry.categoryKind('가공식품'), 'ingredient');
  assert.equal(expiry.categoryKind('기타 음식'), 'food');
  assert.equal(expiry.categoryKind('기타음식'), 'food');
  for (const category of ['조미료', '가공식품', '기타', '국·탕']) {
    const db = storage();
    saveIngredient(db, { ...draft, category });
    assert.equal(loadIngredients(db).length, 1);
  }
});

test('fridge sorting supports both directions for all three criteria without mutating items', () => {
  const items = [
    { id: 'a', date: '2026-10-25', createdAt: '2026-10-17T09:00:00Z', remainingPercent: 50 },
    { id: 'b', date: '', createdAt: '2026-10-19T09:00:00Z', remainingPercent: 25 },
    { id: 'c', date: '2026-10-20', createdAt: '2026-10-18T09:00:00Z', remainingPercent: 100 },
  ];
  for (const [sort, ascending, descending] of [
    ['소비기한', ['c', 'a', 'b'], ['a', 'c', 'b']],
    ['등록순', ['a', 'c', 'b'], ['b', 'c', 'a']],
    ['남은양순', ['b', 'a', 'c'], ['c', 'a', 'b']],
  ]) {
    assert.deepEqual(sorting.sortIngredients(items, { sort, direction: 'asc' }).map(item => item.id), ascending);
    assert.deepEqual(sorting.sortIngredients(items, { sort, direction: 'desc' }).map(item => item.id), descending);
  }
  assert.deepEqual(items.map(item => item.id), ['a', 'b', 'c']);
  const equal = [{ ...items[0], id: 'one' }, { ...items[0], id: 'two' }];
  assert.deepEqual(sorting.sortIngredients(equal, { sort: '소비기한', direction: 'desc' }).map(item => item.id), ['one', 'two']);
});

test('clicking the active criterion toggles direction; changing criterion starts descending', () => {
  for (const sort of ['소비기한', '등록순', '남은양순']) {
    assert.equal(sorting.nextSort({ sort, direction: 'asc' }, sort).direction, 'desc');
    assert.equal(sorting.nextSort({ sort, direction: 'desc' }, sort).direction, 'asc');
  }
  assert.deepEqual(sorting.nextSort({ sort: '소비기한', direction: 'desc' }, '등록순'), { sort: '등록순', direction: 'desc' });
  assert.deepEqual(sorting.nextSort({ sort: '등록순', direction: 'desc' }, '남은양순'), { sort: '남은양순', direction: 'desc' });
  assert.deepEqual(sorting.nextSort({ sort: '남은양순', direction: 'desc' }, '소비기한'), { sort: '소비기한', direction: 'desc' });
});
const { INGREDIENTS_KEY, loadIngredients, saveIngredient, deleteIngredient, validateDraft } = exports;
const { updateIngredientDetails, recordIngredientCondition, saveRecognizedIngredients } = exports;
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
const draft = { name: ' 시금치 ', category: '채소', storage: '냉장', quantity: 2, unit: '봉', date: '2026-10-20' };

test('list deletion keeps expired and unexpired items out of consumption and disposal history', () => {
  const db = storage();
  const { takeIngredient, restoreIngredient } = exports;
  const { loadHistory } = loadTs(new URL('../src/features/report/weeklyReport.ts', import.meta.url));
  const { syncActivities } = loadTs(new URL('../src/features/mypage/activityLog.ts', import.meta.url));
  const [expired] = saveIngredient(db, { ...draft, date: '2020-01-01' });
  const [unexpired] = saveIngredient(db, { ...draft, date: '2099-01-01' });
  const original = loadIngredients(db);
  syncActivities(db, original, []);

  for (const item of [expired, unexpired]) {
    const { items, removed } = takeIngredient(db, item.id);
    assert.equal(loadIngredients(db).some(current => current.id === item.id), false);
    assert.deepEqual(loadHistory(db), []);
    assert.deepEqual(syncActivities(db, items, loadHistory(db)).map(activity => activity.type), ['registered', 'registered']);
    assert.deepEqual(restoreIngredient(db, removed), original);
    assert.deepEqual(restoreIngredient(db, removed), original);
  }
});

const homeExports = {};
const homeSource = readFileSync(new URL('../src/features/home/selectHomeIngredients.ts', import.meta.url), 'utf8');
new Function('exports', ts.transpileModule(homeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(homeExports);
test('home chooses expiry priority including expired, today and D-3; missing dates are not urgent', () => {
  const today = new Date(2026, 9, 17, 23, 59);
  const make = (id, date) => ({ ...draft, id, date, createdAt: '2026-10-15T00:00:00Z' });
  const items = [make('missing', ''), make('later', '2026-10-21'), make('three', '2026-10-20'), make('today', '2026-10-17'), make('expired', '2026-10-16'), make('one', '2026-10-18')];
  const result = homeExports.selectHomeIngredients(items, today);
  assert.equal(result.mode, 'urgent');
  assert.deepEqual(result.entries.map(value => [value.item.id, value.days]), [['expired', -1], ['today', 0], ['one', 1], ['three', 3]]);
  assert.equal(items[0].id, 'missing');
  assert.equal(homeExports.selectHomeIngredients([make('three', '2026-10-20')], new Date(2026, 9, 16)).mode, 'recent');
});
test('home falls back to four latest registrations and handles empty and unknown dates', () => {
  const items = [1,2,3,4,5].map(i => ({ ...draft, id: String(i), date: i === 1 ? '' : '2026-12-31', createdAt: `2026-10-${String(i).padStart(2, '0')}T00:00:00Z`, updatedAt: '2026-10-17T00:00:00Z' }));
  const result = homeExports.selectHomeIngredients(items, new Date(2026, 9, 17));
  assert.equal(result.mode, 'recent');
  assert.deepEqual(result.entries.map(value => value.item.id), ['5','4','3','2']);
  assert.equal(homeExports.selectHomeIngredients([items[0]], new Date(2026, 9, 17)).entries[0].days, null);
  assert.deepEqual(homeExports.selectHomeIngredients([], new Date()).entries, []);
});
test('DB recommendations use 80 percent rounded down and calendar days', () => {
  assert.equal(expiry.calculateRecommendedDate('대파', '냉장', '2026-10-17'), '2026-10-25');
  assert.equal(expiry.calculateRecommendedDate('대파', '냉동', '2026-10-17'), '2027-03-10');
  assert.equal(expiry.calculateRecommendedDate('브로콜리', '냉장', '2026-10-17'), '2026-10-22');
  assert.equal(expiry.calculateRecommendedDate('딸기', '냉장', '2028-02-28'), '2028-03-01');
  assert.equal(expiry.calculateRecommendedDate('닭고기', '냉장', '2026-10-17'), '2026-10-17');
  assert.equal(expiry.calculateRecommendedDate('대파', '냉장', '2026-02-30'), '');
});

test('unknown names, mismatched storage and missing variant conditions remain undated', () => {
  for (const [name, location] of [['없는재료', '냉장'], ['대파', '실온'], ['브로콜리', '냉동'], ['스팸', '냉장'], ['콩', '냉장']]) {
    assert.equal(expiry.calculateRecommendedDate(name, location, '2026-10-17'), '');
  }
  assert.equal(expiry.calculateRecommendedDate('브로콜리', '냉동', '2026-10-17', '데친 후'), '2027-03-10');
  assert.equal(expiry.calculateRecommendedDate('간장', '냉장', '2026-10-17'), expiry.calculateRecommendedDate('간장', '실온', '2026-10-17'));
});

test('manual and recognized registration persist the same date for list/detail/sorting', () => {
  const db = storage();
  const [item] = saveIngredient(db, { ...draft, name: '대파', date: '', storageStartedOn: '2026-10-17' });
  assert.equal(item.date, '2026-10-25');
  assert.equal(item.dateSource, 'automatic');
  assert.equal(loadIngredients(db)[0].date, item.date);
  assert.equal(expiry.deadlineLabel(expiry.deadlineDays(item.date, '2026-10-17')), 'D-8');
  const batch = saveRecognizedIngredients(db, [{ ...draft, name: '대파', date: '', storageStartedOn: '2026-10-17', source: 'ocr' }]);
  assert.equal(batch[0].date, item.date);
  const sorted = [{ date: '' }, { date: '2026-10-25' }, { date: '2026-10-19' }].sort(expiry.compareExpiry);
  assert.deepEqual(sorted.map(item => item.date), ['2026-10-19', '2026-10-25', '']);
});

test('explicit dates override DB and survive storage and name changes', () => {
  const db = storage();
  const [item] = saveIngredient(db, { ...draft, name: '대파', date: '2026-10-30', storageStartedOn: '2026-10-17' });
  assert.equal(item.dateSource, 'manual');
  assert.equal(updateIngredientDetails(db, item.id, { storage: '냉동', date: item.date, remainingPercent: 100 })[0].date, item.date);
  assert.equal(exports.updateIngredientInfo(db, item.id, { name: '상추' })[0].date, item.date);
  const changed = updateIngredientDetails(db, item.id, { storage: '냉장', date: '', remainingPercent: 100 })[0];
  assert.equal(changed.date, '2026-10-21');
  assert.equal(changed.dateSource, 'automatic');
  const manual = updateIngredientDetails(db, item.id, { storage: '냉장', date: changed.date, dateSource: 'manual', remainingPercent: 100 })[0];
  assert.equal(manual.dateSource, 'manual');
  const manuallyChanged = updateIngredientDetails(db, item.id, { storage: '냉장', date: '2026-12-01', remainingPercent: 100 })[0];
  assert.equal(manuallyChanged.date, '2026-12-01');
});

test('automatic date follows storage/name changes without restarting the clock', () => {
  const db = storage();
  const [item] = saveIngredient(db, { ...draft, name: '대파', date: '', storageStartedOn: '2026-10-17' });
  const frozen = updateIngredientDetails(db, item.id, { storage: '냉동', date: item.date, remainingPercent: 100 })[0];
  assert.equal(frozen.date, '2027-03-10');
  assert.equal(frozen.storageStartedOn, '2026-10-17');
  assert.equal(exports.updateIngredientInfo(db, item.id, { name: '알수없는이름' })[0].date, '');
});

test('legacy missing dates are anchored to original creation; explicit dates stay unchanged', () => {
  const db = storage();
  db.setItem(INGREDIENTS_KEY, JSON.stringify([{ ...draft, name: '대파', date: '', id: 'old', createdAt: '2026-10-17T03:00:00Z', updatedAt: '2026-10-20T03:00:00Z' }]));
  assert.equal(loadIngredients(db)[0].date, '2026-10-25');
  assert.equal(loadIngredients(db)[0].date, '2026-10-25');
  saveIngredient(db, { ...draft, name: '대파', date: '', storageStartedOn: '2026-10-17' }, 'old');
  assert.equal(JSON.parse(db.getItem(INGREDIENTS_KEY))[0].date, '2026-10-25');
});

test('food recommendations use DB rows and the shared repository', () => {
  const db = storage();
  for (const name of ['반찬', '조리 음식', '배달음식', '밀키트']) {
    const [item] = saveIngredient(db, { ...draft, name, category: '기타', date: '', storageStartedOn: '2026-10-17' });
    assert.equal(expiry.isFood(item), true);
    assert.equal(item.date, '2026-10-19');
  }
  assert.equal(expiry.isFood({ name: '대파' }), false);
  const food = loadIngredients(db)[0];
  assert.equal(expiry.isFood(exports.updateIngredientInfo(db, food.id, { name: '나만의 밀키트' }).find(item => item.id === food.id)), true);
  assert.equal(expiry.calculateRecommendedDate('밀키트', '냉장', '2026-10-17', '조리 전'), '2026-10-21');
  assert.equal(expiry.calculateRecommendedDate('배달음식', '냉동', '2026-10-17'), '');
  assert.equal(expiry.calculateRecommendedDate('김치찌개', '냉장', '2026-10-17'), '');
});

test('info modal updates only metadata and rejects quantity changes after consumption', () => {
  const db = storage();
  const [item] = saveIngredient(db, draft);
  const [edited] = exports.updateIngredientInfo(db, item.id, { name: '수정 시금치', quantity: 300, unit: 'g' });
  assert.equal(edited.quantity, 300);
  assert.equal(edited.unit, 'g');
  assert.equal(edited.date, draft.date);
  updateIngredientDetails(db, item.id, { storage: '냉동', date: draft.date, remainingPercent: 75 });
  assert.throws(() => exports.updateIngredientInfo(db, item.id, { name: '다시 수정', quantity: 4, unit: '개' }));
  const [renamed] = exports.updateIngredientInfo(db, item.id, { name: '이름만 수정' });
  assert.equal(renamed.name, '이름만 수정');
  assert.equal(renamed.quantity, 300);
  assert.equal(renamed.remainingPercent, 75);
  assert.equal(renamed.storage, '냉동');
  updateIngredientDetails(db, item.id, { storage: '냉동', date: draft.date, remainingPercent: 100 });
  assert.throws(() => exports.updateIngredientInfo(db, item.id, { name: '복구 후 수정', quantity: 4 }));
  assert.throws(() => exports.updateIngredientInfo(db, item.id, { name: '' }));
});

test('legacy records load as manual and gain defaults without losing data', () => {
  const db = storage();
  const now = new Date().toISOString();
  db.setItem(INGREDIENTS_KEY, JSON.stringify([{ ...draft, id: 'legacy', createdAt: now, updatedAt: now }]));
  assert.equal(loadIngredients(db)[0].id, 'legacy');
  const [item] = saveIngredient(db, draft, 'legacy');
  assert.equal(item.source, 'manual');
  assert.equal(item.remainingPercent, 100);
  assert.deepEqual(item.conditionHistory, []);
});
test('detail updates and chronological condition events survive metadata edits', () => {
  const db = storage();
  const [item] = saveIngredient(db, draft);
  updateIngredientDetails(db, item.id, { storage: '냉동', date: '2026-10-22', remainingPercent: 25 });
  recordIngredientCondition(db, item.id, '싱싱해요');
  const firstEvent = loadIngredients(db)[0].conditionHistory[0];
  recordIngredientCondition(db, item.id, '시들시들해요');
  saveIngredient(db, { ...draft, name: '수정', storage: '냉동', date: '2026-10-22' }, item.id);
  const saved = loadIngredients(db)[0];
  assert.equal(saved.remainingPercent, 25);
  assert.equal(saved.conditionHistory.length, 2);
  assert.equal(saved.conditionHistory[0].status, '시들시들해요');
  assert.equal(saved.conditionHistory[1].id, firstEvent.id);
  assert.ok(Number.isFinite(Date.parse(firstEvent.recordedAt)));
  assert.throws(() => updateIngredientDetails(db, item.id, { storage: '냉동', date: '', remainingPercent: 10 }));
});
test('OCR and camera provenance persist across edits; batch failures are atomic', () => {
  const db = storage();
  saveRecognizedIngredients(db, [{ ...draft, source: 'ocr' }, { ...draft, name: '두부', source: 'camera' }]);
  const loaded = loadIngredients(db);
  assert.deepEqual(loaded.map(item => item.source), ['ocr', 'camera']);
  saveIngredient(db, { ...draft, source: 'manual' }, loaded[0].id);
  assert.equal(loadIngredients(db)[0].source, 'ocr');
  const before = db.getItem(INGREDIENTS_KEY);
  assert.throws(() => saveRecognizedIngredients(db, [draft, { ...draft, name: '' }]));
  assert.equal(db.getItem(INGREDIENTS_KEY), before);
});
test('condition storage failures leave existing history and details unchanged', () => {
  const db = storage();
  const [item] = saveIngredient(db, draft);
  const before = db.getItem(INGREDIENTS_KEY);
  assert.throws(() => recordIngredientCondition({ getItem: db.getItem, setItem: () => { throw new Error('quota'); } }, item.id, '싱싱해요'));
  assert.equal(db.getItem(INGREDIENTS_KEY), before);
  deleteIngredient(db, item.id);
  assert.throws(() => recordIngredientCondition(db, item.id, '싱싱해요'));
});

test('create, reload, update preserving identity, delete only selected ID', () => {
  const db = storage();
  assert.deepEqual(loadIngredients(db), []);
  const [first] = saveIngredient(db, draft);
  assert.equal(first.name, '시금치');
  saveIngredient(db, { ...draft, name: '두부' });
  assert.equal(loadIngredients(db).length, 2);
  const changed = saveIngredient(db, { ...draft, name: '수정', quantity: 0.5, unit: 'kg' }, first.id).find(item => item.id === first.id);
  assert.equal(changed.createdAt, first.createdAt);
  assert.equal(changed.quantity, 0.5);
  assert.equal(changed.unit, 'kg');
  assert.equal(deleteIngredient(db, first.id)[0].name, '두부');
  assert.equal(loadIngredients(db).length, 1);
});
test('reject invalid form values and invalid calendar dates', () => {
  for (const change of [{ name: ' ' }, { category: '' }, { storage: '' }, { quantity: 0 }, { quantity: Infinity }, { unit: '' }, { date: '2026-02-30' }, { date: 'invalid' }]) assert.ok(validateDraft({ ...draft, ...change }));
  assert.equal(validateDraft({ ...draft, date: '' }), null);
});
test('corrupted storage is not silently overwritten', () => {
  const db = storage();
  db.setItem(INGREDIENTS_KEY, '{broken');
  assert.throws(() => saveIngredient(db, draft));
  assert.equal(db.getItem(INGREDIENTS_KEY), '{broken');
});
test('quota failures propagate, leaving stored records unchanged', () => {
  const db = storage();
  saveIngredient(db, draft);
  const before = db.getItem(INGREDIENTS_KEY);
  assert.throws(() => saveIngredient({ getItem: db.getItem, setItem: () => { throw new Error('QuotaExceededError'); } }, draft));
  assert.equal(db.getItem(INGREDIENTS_KEY), before);
});
test('reads latest persisted records before writes; deleted edits do not recreate items', () => {
  const db = storage();
  const [first] = saveIngredient(db, draft);
  saveIngredient(db, { ...draft, name: '다른 탭' });
  assert.equal(saveIngredient(db, draft).length, 3);
  deleteIngredient(db, first.id);
  assert.throws(() => saveIngredient(db, draft, first.id), /삭제된 항목/);
  assert.equal(loadIngredients(db).length, 2);
});

test('fridge filter starts unselected and keeps the stored order', () => {
  const items = [{ id: 'new', date: '2026-10-20', createdAt: '2026-10-13T00:00:00Z' }, { id: 'old', date: '2026-10-14', createdAt: '2026-10-01T00:00:00Z' }];
  assert.deepEqual(sorting.sortIngredients(items, { sort: null, direction: 'asc' }).map(item => item.id), ['new', 'old']);
  assert.deepEqual(sorting.nextSort({ sort: null, direction: 'asc' }, '소비기한'), { sort: '소비기한', direction: 'desc' });
  assert.deepEqual(sorting.nextSort({ sort: null, direction: 'asc' }, '등록순'), { sort: '등록순', direction: 'desc' });
});
