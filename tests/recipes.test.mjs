import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path, replacements = []) {
  const url = new URL(path, import.meta.url);
  let source = readFileSync(url, 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
  const exports = {};
  new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports, name => load(new URL(`${name}.ts`, url)));
  return exports;
}
const api = load('../server/recipes.ts');
const enrichment = load('../server/recipeEnrichment.ts');
const { searchRecipes } = load('../src/features/recipe/api.ts', [["import.meta.env.VITE_RECIPE_ENDPOINT || '/api/recipes'", "'/api/recipes'"]]);
const row = (id, name = `레시피${id}`) => ({ RCP_SEQ: String(id), RCP_NM: name, RCP_WAY2: '볶기', RCP_PAT2: '반찬', RCP_PARTS_DTLS: '대파 10g, 두부 100g', INFO_ENG: '150', INFO_PRO: '10', ATT_FILE_NO_MAIN: 'http://www.foodsafetykorea.go.kr/uploadimg/test.jpg', MANUAL01: '썬다.', MANUAL03: '볶는다.', MANUAL_IMG03: 'http://www.foodsafetykorea.go.kr/uploadimg/step.jpg' });
const basic = (id, name = `레시피${id}`, time = '30분', level = '초보환영') => ({ RECIPE_ID: id, RECIPE_NM_KO: name, COOKING_TIME: time, LEVEL_NM: level });
const foodPayload = (rows, total = rows.length) => ({ COOKRCP01: { RESULT: { CODE: 'INFO-000' }, total_count: String(total), row: rows } });
const basicPayload = rows => ({ [api.BASIC_GRID]: { result: { code: 'INFO-000' }, totalCnt: rows.length, row: rows } });
const response = value => new Response(JSON.stringify(value));
const recipe = id => api.normalizeFoodRecipe(row(id));

test('primary fields, nutrition, ingredients and step order come only from food safety data', () => {
  const item = recipe(1);
  assert.equal(item.id, '1');
  assert.equal(item.nutrition.protein, '10');
  assert.equal(item.image.startsWith('https:'), true);
  assert.deepEqual(item.ingredients.map(part => part.name), ['대파', '두부']);
  assert.deepEqual(item.steps.map(step => step.text), ['썬다.', '볶는다.']);
  const enriched = enrichment.enrichRecipes([item], api.parseBasicPage(basicPayload([{ ...basic(999, item.name), QNT: '99인분', SUMRY: 'other content' }])).rows)[0];
  assert.equal(enriched.id, '1');
  assert.equal(enriched.servings, '');
  assert.deepEqual(enriched.ingredients, item.ingredients);
  assert.deepEqual(enriched.steps, item.steps);
  assert.equal(enriched.metadata.matchedRecipeId, '999');
  assert.equal(enriched.time, '약 30분');
  assert.equal(enriched.difficulty, '초급');
});
test('ingredient amounts preserve commas inside parentheses and full raw text', () => {
  const raw = '두부 100g(1/2모, 물기 제거), 대파 10g, 소금 약간';
  const item = api.normalizeFoodRecipe({ ...row(1), RCP_PARTS_DTLS: raw });
  assert.equal(item.rawIngredients, raw);
  assert.equal(item.ingredients.length, 3);
  assert.equal(item.ingredients[0].amount, '100g(1/2모, 물기 제거)');
  assert.equal(api.parseFoodPage(foodPayload([{ ...row(2), RCP_PARTS_DTLS: '' }])).recipes[0].ingredients.length, 0);
});
test('quantity wrappers do not strand parentheses on ingredient names', () => {
  const examples = [
    ['황태채(100g)', '황태채', '100g'],
    ['곤약(100g)', '곤약', '100g'],
    ['곤약(약 100g)', '곤약', '약 100g'],
    ['건미역(20g)', '건미역', '20g'],
    ['들깨가루（20g）', '들깨가루', '20g'],
    ['토마토 1개 (약 150~200g)', '토마토', '1개 (약 150~200g)'],
    ['대파 1/2대', '대파', '1/2대'],
    ['소금(약간)', '소금', '약간'],
    ['표고버섯(말린 것) 20g', '표고버섯(말린 것)', '20g'],
    ['닭고기(가슴살, 120g)', '닭고기(가슴살)', '120g'],
    ['새우(대하, 3마리)', '새우(대하)', '3마리'],
    ['파프리카(빨강, 노랑 각 ½개)', '파프리카(빨강, 노랑)', '각 ½개'],
    ['식초(2배 농축) 5ml', '식초(2배 농축)', '5ml'],
    ['3색 파프리카(100g)', '3색 파프리카', '100g'],
    ['두부(100g(1/2모))', '두부', '100g(1/2모)'],
    ['후추()', '후추', ''],
  ];
  for (const [source, name, amount] of examples) assert.deepEqual(api.parseIngredients(source), [{ name, amount, type: '' }], source);
});
test('cached split wrappers are repaired without dropping useful quantity references', () => {
  const { cleanIngredientParts } = load('../src/features/recipe/ingredientText.ts');
  assert.deepEqual(cleanIngredientParts('황태채(', '100g)'), { name: '황태채', amount: '100g' });
  assert.deepEqual(cleanIngredientParts('두부(', '100g(1/2모))'), { name: '두부', amount: '100g(1/2모)' });
  assert.deepEqual(cleanIngredientParts('계란', '(2알)'), { name: '계란', amount: '2알' });
  assert.deepEqual(cleanIngredientParts('키조개관자60', ''), { name: '키조개관자', amount: '60g' });
});
test('unitless trailing quantities default to grams without splitting names that contain numbers', () => {
  const examples = [
    ['키조개관자60', '키조개관자', '60g'],
    ['키조개관자 60', '키조개관자', '60g'],
    ['키조개관자(60)', '키조개관자', '60g'],
    ['참기름1.5', '참기름', '1.5g'],
    ['비타500 1병', '비타500', '1병'],
    ['3색 파프리카 1개', '3색 파프리카', '1개'],
    ['V8', 'V8', ''],
  ];
  for (const [source, name, amount] of examples) assert.deepEqual(api.parseIngredients(source), [{ name, amount, type: '' }], source);
  assert.deepEqual(api.parseIngredients('키조개관자60 마늘10, 대파 10').map(part => [part.name, part.amount]), [['키조개관자', '60g'], ['마늘', '10g'], ['대파', '10g']]);
});
test('spaced or bracketed section labels are stripped from ingredient names', () => {
  const { splitIngredientText } = load('../src/features/recipe/ingredientText.ts');
  const examples = [
    ['필수 재료:표고버섯', '표고버섯', ''],
    ['필수 재료 : 표고버섯 2개', '표고버섯', '2개'],
    ['필수 재료 표고버섯 2개', '표고버섯', '2개'],
    ['[필수 재료] 표고버섯 2개', '표고버섯', '2개'],
    ['선택 재료', '', ''],
    ['[2인분] 토마토', '토마토', ''],
    ['(2~3인분 기준) 토마토 1개', '토마토', '1개'],
    ['2인분: 토마토 1개', '토마토', '1개'],
    ['[2인분 재료] 토마토 1개', '토마토', '1개'],
    ['[2인분]', '', ''],
    ['2인분 기준<br>', '', ''],
    ['2인분 기준<br>토마토 1개', '토마토', '1개'],
    ['닭 육수 큐브 1개', '닭 육수 큐브', '1개'],
    ['토마토 소스 2큰술', '토마토 소스', '2큰술'],
  ];
  for (const [source, name, amount] of examples) assert.deepEqual(splitIngredientText(source), { name, amount }, source);
  assert.deepEqual(api.parseIngredients('애호박 20g [소스소개] 쇠고기양념:설탕 1.4g, 간장 2g').map(part => [part.name, part.amount]), [['애호박', '20g'], ['설탕', '1.4g'], ['간장', '2g']]);
  assert.deepEqual(api.parseIngredients('2인분 기준<br>토마토 1개, 우유 200ml<br/>소금 약간').map(part => part.name), ['토마토', '우유', '소금']);
});
test('malformed duplicated or unclosed quantity parentheses never swallow following ingredients', () => {
  const raw = '배추(100g), 미나리(20g), 두부((30g), 부추(20g)\n표고버섯(20g), 느타리(20g), 소고기(30g), 저염간장(10g)\n대파(10g), 마늘(10g), 참기름(10g), 통깨(3g)\n후춧가루(0.05g)\n- 육수 : 양지육(50g), 무(30g), 마늘(10g), 저염간장(10g)';
  const parts = api.parseIngredients(raw);
  assert.equal(parts.length, 17);
  assert.deepEqual(parts[2], { name: '두부', amount: '30g', type: '' });
  assert.equal(parts[13].name, '양지육');
  assert.ok(parts.every(part => !/[\n,]/.test(part.name)));
  const missing = api.parseIngredients('대파(10g, 마늘(5g), 소금(0.1g');
  assert.deepEqual(missing.map(part => [part.name, part.amount]), [['대파', '10g'], ['마늘', '5g'], ['소금', '0.1g']]);
});
test('source headings are removed with and without colons while real ingredient names remain', () => {
  const parts = api.parseIngredients('재료 느타리버섯(10g), 두부(50g)\n다시마육수 다시마(3g), 대파(20g)\n고기완자양념 생강즙(2g)\n양념장 : 다진쇠고기 30g\n소 다진 쇠고기(15g)\n오렌지소스 오렌지주스(50g)');
  assert.deepEqual(parts.map(part => part.name), ['느타리버섯', '두부', '다시마', '대파', '생강즙', '다진쇠고기', '다진 쇠고기', '오렌지주스']);
  assert.equal(api.parseIngredients('재료\n당근(20g)').length, 1);
  assert.equal(api.parseIngredients('재료 1인분 봄동(10g)')[0].name, '봄동');
  assert.equal(api.parseIngredients('재료(2인분) : 대파(10g)')[0].name, '대파');
  assert.equal(api.parseIngredients('굴소스(10g)')[0].name, '굴소스');
  assert.equal(api.parseIngredients('3가지색 소면(분홍, 초록, 흰색 각 20g), 당근(10g)').length, 2);
  assert.deepEqual(api.parseIngredients('다시마(3g) 대파(10g), 두부 30g 부추 20g').map(part => [part.name, part.amount]), [['다시마', '3g'], ['대파', '10g'], ['두부', '30g'], ['부추', '20g']]);
  assert.deepEqual(api.parseIngredients('소금물(물 100g, 소금 3g) - 양념장 : 까나리액젓(1.5g)').map(part => part.name), ['소금물(물)', '까나리액젓']);
});
test('matching uses normalized unique names and never fuzzy or duplicate matches', () => {
  const [a, b] = enrichment.enrichRecipes([api.normalizeFoodRecipe(row(1, '소고기 계란 볶음')), recipe(2)], [
    { id: 'a', name: '쇠고기 달걀볶음', minutes: 60, difficulty: '고급' },
    { id: 'b', name: '레시피2 변형', minutes: 90, difficulty: '중급' },
  ]);
  assert.equal(a.metadata.timeSource, 'mafra');
  assert.equal(b.metadata.timeSource, 'estimated');
  const duplicate = { id: 'x', name: '레시피1', minutes: 30, difficulty: '초급' };
  assert.equal(enrichment.enrichRecipes([recipe(1)], [duplicate, { ...duplicate, id: 'y' }])[0].metadata.timeSource, 'estimated');
});
test('unmatched times and levels are estimated, times always start with 약', () => {
  const simple = recipe(1), complex = { ...recipe(2), method: '찌기', steps: Array(20).fill({ text: '조리', image: '', tip: '' }) };
  const values = enrichment.enrichRecipes([simple, complex], []);
  assert.ok(Number(values[1].time.match(/\d+/)[0]) > Number(values[0].time.match(/\d+/)[0]));
  assert.equal(values[1].difficulty, '고급');
  for (const item of values) { assert.match(item.time, /^약 \d+분$/); assert.equal(item.metadata.calibrationSamples, 0); assert.equal(item.metadata.timeSource, 'estimated'); }
});
test('at least three real matched times calibrate unmatched estimates using median ratios', () => {
  const recipes = [1, 2, 3, 4].map(recipe);
  const baseMinutes = enrichment.recipeFeatures(recipes[0]).minutes;
  const rows = [1, 2, 3].map(id => ({ id: String(id), name: `레시피${id}`, minutes: baseMinutes * 2, difficulty: '초급' }));
  const target = enrichment.enrichRecipes(recipes, rows)[3];
  assert.equal(target.time, `약 ${Math.round(baseMinutes * 2 / 5) * 5}분`);
  assert.equal(target.metadata.calibrationSamples, 3);
  assert.equal(target.metadata.timeSource, 'estimated');
  assert.equal(enrichment.enrichRecipes(recipes, rows.slice(0, 2))[3].metadata.calibrationSamples, 0);
});
test('difficulty calibration uses ordered real label centers with at least two examples per level', () => {
  const recipes = [1, 2, 3, 4, 5].map(id => ({ ...recipe(id), steps: Array(id < 3 || id === 5 ? 1 : 12).fill({ text: '조리', image: '', tip: '' }) }));
  const basic = [1, 2, 3, 4].map(id => ({ id: String(id), name: `레시피${id}`, minutes: 30, difficulty: id < 3 ? '초급' : '고급' }));
  const target = enrichment.enrichRecipes(recipes, basic)[4];
  assert.equal(target.difficulty, '초급');
  assert.equal(target.metadata.difficultyCalibrationSamples, 4);
});
test('overlapping or single-group difficulty examples calibrate an ordinal offset when enough labels exist', () => {
  const recipes = [1, 2, 3, 4].map(id => ({ ...recipe(id), steps: Array(11).fill({ text: '조리', image: '', tip: '' }) }));
  const labeled = [1, 2, 3].map(id => ({ id: String(id), name: `레시피${id}`, minutes: 30, difficulty: '초급' }));
  const target = enrichment.enrichRecipes(recipes, labeled)[3];
  assert.equal(target.difficulty, '초급');
  assert.equal(target.metadata.difficultyCalibrationSamples, 3);
});
test('time parsing handles hours and rejects ambiguous values; unknown levels use estimation', () => {
  assert.equal(enrichment.parseMinutes('1시간 20분'), 80);
  assert.equal(enrichment.parseMinutes('30분'), 30);
  assert.equal(enrichment.parseMinutes('30~60분'), null);
  assert.equal(enrichment.parseMinutes(''), null);
  assert.equal(enrichment.normalizeDifficulty('보통'), '중급');
  const target = enrichment.enrichRecipes([recipe(1)], [{ id: '1', name: '레시피1', minutes: null, difficulty: '' }])[0];
  assert.equal(target.metadata.timeSource, 'estimated');
  assert.equal(target.metadata.difficultySource, 'estimated');
});
test('search calls only food safety and the optional basic grid, filters all ingredients, caches and pages', async () => {
  const calls = [];
  const search = api.createRecipeSearch('food-test', async (url, options) => {
    calls.push(url); assert.ok(options.signal instanceof AbortSignal);
    return response(url.includes('COOKRCP01') ? foodPayload(Array.from({ length: 35 }, (_, i) => row(i))) : basicPayload([basic(1)]));
  }, 'basic-test');
  assert.equal((await search(['대파', '두부'])).total, 35);
  assert.equal((await search(['대파'], 2)).recipes.length, 5);
  assert.equal((await search(['없는재료'])).total, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => !url.includes('00227') && !url.includes('00228')));
});
test('ingredient search treats spelling variants as the same ingredient in both directions', async () => {
  const rows = [['1', '고춧가루 5g, 케첩 10g'], ['2', '주꾸미 100g, 요거트 50g'], ['3', '달걀 1개, 캔참치 1개'], ['4', '모차렐라치즈 30g, 소시지 2개, 돈가스 1장']]
    .map(([id, parts]) => ({ ...row(id), RCP_PARTS_DTLS: parts }));
  const search = api.createRecipeSearch('food-test', async () => response(foodPayload(rows)));
  const ids = async names => (await search(names)).recipes.map(recipe => recipe.id);
  assert.deepEqual(await ids(['고추가루', '케찹']), ['1']);
  assert.deepEqual(await ids(['쭈꾸미', '요구르트']), ['2']);
  assert.deepEqual(await ids(['유정란', '참치캔']), ['3']);
  assert.deepEqual(await ids(['모짜렐라치즈', '소세지', '돈까스']), ['4']);
  assert.equal(api.canonical('후추가루'), api.canonical('후춧가루'));
});

test('basic API failures do not block main recipes or return fake matched values', async () => {
  const search = api.createRecipeSearch('food-test', async url => response(url.includes('COOKRCP01') ? foodPayload([row(1)]) : { result: { code: 'INFO-100' } }), 'basic-test');
  const result = await search(['대파']);
  assert.equal(result.total, 1);
  assert.equal(result.recipes[0].metadata.timeSource, 'estimated');
  assert.equal(result.recipes[0].metadata.calibrationSamples, 0);
});
test('primary API authentication is not hidden by optional fallback', async () => {
  const search = api.createRecipeSearch('food-test', async url => response(url.includes('COOKRCP01') ? { RESULT: { CODE: 'INFO-100' } } : basicPayload([basic(1)])), 'basic-test');
  await assert.rejects(search(['대파']), /FOOD_SAFETY_API_KEY/);
  assert.throws(() => api.parseFoodPage({}), /레시피/);
});
test('fetches all primary pages before filtering or calibrating', async () => {
  let calls = 0;
  const search = api.createRecipeSearch('food-test', async url => {
    calls++;
    return response(url.endsWith('/1/1000') ? foodPayload(Array.from({ length: 1000 }, (_, i) => ({ ...row(i), RCP_PARTS_DTLS: '양파 1개' })), 1001) : foodPayload([row(1001)], 1001));
  });
  assert.equal((await search(['대파'])).total, 1);
  assert.equal(calls, 2);
});
test('recipe browsing returns 30 at a time without missing or repeating the final batch', async () => {
  const search = api.createRecipeSearch('food-test', async () => response(foodPayload(Array.from({ length: 65 }, (_, i) => row(i + 1)))));
  const pages = await Promise.all([search(['대파'], 1), search(['대파'], 2), search(['대파'], 3)]);
  assert.deepEqual(pages.map(page => page.recipes.length), [30, 30, 5]);
  assert.ok(pages.every(page => page.total === 65 && page.pageSize === 30));
  assert.equal(new Set(pages.flatMap(page => page.recipes.map(recipe => recipe.id))).size, 65);
  assert.equal((await search(['대파'], 4)).recipes.length, 0);
});

test('input validation, empty results, concurrency and failed-cache retries', async () => {
  const missing = api.createRecipeSearch(undefined);
  await assert.rejects(missing(['대파']), /FOOD_SAFETY_API_KEY/);
  await assert.rejects(missing([]), { status: 400 });
  await assert.rejects(missing(['대파'], 0), { status: 400 });
  let calls = 0;
  const search = api.createRecipeSearch('food-test', async () => { calls++; return response({ RESULT: { CODE: 'INFO-200' } }); });
  const values = await Promise.all([search(['대파']), search(['양파'])]);
  assert.equal(calls, 1); assert.equal(values[0].total, 0);
  let attempt = 0;
  const retry = api.createRecipeSearch('food-test', async () => { if (++attempt === 1) throw new Error('network'); return response(foodPayload([row(1)])); });
  await assert.rejects(retry(['대파']));
  assert.equal((await retry(['대파'])).total, 1);
});
test('client sends ingredient names and abort signal, separating empty results from errors', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.deepEqual(new URL(url, 'http://localhost').searchParams.getAll('ingredient'), ['대파', '두부']);
    assert.equal(options.signal, controller.signal);
    return response({ recipes: [], total: 0, page: 1, pageSize: 30 });
  };
  assert.equal((await searchRecipes(['대파', '두부'], 1, controller.signal)).total, 0);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '연결 실패' }), { status: 502 });
  await assert.rejects(searchRecipes(['대파']), /연결 실패/);
});
test('HTTP middleware does not expose keys in missing-key errors', async () => {
  const middleware = api.recipesMiddleware(undefined); let status, body;
  const res = { setHeader() {}, set statusCode(value) { status = value; }, end(value) { body = JSON.parse(value); } };
  await middleware({ method: 'GET', url: '/?ingredient=대파' }, res);
  assert.equal(status, 503); assert.match(body.error, /FOOD_SAFETY_API_KEY/);
  await middleware({ method: 'POST', url: '/' }, res); assert.equal(status, 405);
});
