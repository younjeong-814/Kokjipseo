// Read-only audit of recipe search false positives. Never print keys, request URLs or raw ingredient text.
//
// 사전의 식재료 키워드마다 실제 레시피 검색어(recipeSearchKeyword)로 서버와 같은 부분문자열 검색을 하고,
// 검색어를 품은 원문 단어를 센다. 서버 제외 목록(EXCLUDED_WORDS)에 든 단어는 빼고 센다. '배'로 찾을 때 '양배추'가 걸리는 식의 오탐 제외 목록 후보를 고르는 용도다.
//
//   node scripts/audit-recipe-search.mjs            키워드별 후보 단어 (오탐 영향이 큰 순)
//   node scripts/audit-recipe-search.mjs --min 3    해당 단어로만 걸린 레시피가 3건 이상인 후보만
//
// only: 검색어가 그 단어 안에서만 나와서 걸린 레시피 수. 그 단어를 제외하면 결과에서 빠지는 최대치다.
// all: 그 단어가 들어 있는 검색 결과 레시피 수.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { loadEnv } from 'vite';
function load(url) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', source)(exports, name => load(new URL(`${name}.ts`, url)));
  return exports;
}
const api = load(new URL('../server/recipes.ts', import.meta.url));
const { entries, recipeSearchKeyword } = load(new URL('../src/features/ingredients/classify.ts', import.meta.url));
const { ingredientCategories } = load(new URL('../src/features/ingredients/expiry.ts', import.meta.url));
const minIndex = process.argv.indexOf('--min');
const min = minIndex > 0 ? Number(process.argv[minIndex + 1]) : 1;
const env = loadEnv('development', '.', '');
if (!env.FOOD_SAFETY_API_KEY?.trim()) { console.log('Food safety key is not configured.'); process.exitCode = 1; }
else {
  const food = new Map();
  const search = api.createRecipeSearch(env.FOOD_SAFETY_API_KEY, async (url, options) => {
    const response = await fetch(url, options);
    try { for (const recipe of api.parseFoodPage(await response.clone().json()).recipes) food.set(recipe.id, recipe); } catch { /* The search function handles actual upstream errors. */ }
    return response;
  });
  try {
    await search(['물']);
    // 서버 필터와 같은 기준으로 비교하도록 단어도 canonical로 맞춘다.
    const recipes = [...food.values()].filter(recipe => recipe.rawIngredients).map(recipe => recipe.rawIngredients.normalize('NFC').match(/[가-힣]+/g)?.map(api.canonical) ?? []);
    // 돼지·돼지고기처럼 같은 검색어가 되는 키워드는 한 번만 본다.
    const queries = new Map();
    for (const { category, keyword } of entries) {
      if (!ingredientCategories.includes(category)) continue;
      const query = api.canonical(recipeSearchKeyword(keyword));
      queries.set(query, { category, keywords: [...(queries.get(query)?.keywords ?? []), keyword] });
    }
    const report = [];
    for (const [query, { keywords, category }] of queries) {
      const words = new Map();
      let total = 0, exact = 0;
      for (const tokens of recipes) {
        const hits = new Set(tokens.filter(token => api.containsIngredient(token, query)));
        if (!hits.size) continue;
        total++;
        const exactHit = hits.delete(query);
        if (exactHit) exact++;
        for (const word of hits) {
          const count = words.get(word) ?? { all: 0, only: 0 };
          count.all++;
          if (!exactHit && hits.size === 1) count.only++;
          words.set(word, count);
        }
      }
      const candidates = [...words].filter(([, count]) => count.only >= min).sort((a, b) => b[1].only - a[1].only || b[1].all - a[1].all);
      if (candidates.length) report.push({ query, keywords, category, total, exact, candidates });
    }
    report.sort((a, b) => b.candidates.reduce((sum, [, c]) => sum + c.only, 0) / b.total - a.candidates.reduce((sum, [, c]) => sum + c.only, 0) / a.total);
    console.log(`레시피 ${recipes.length}건 · 후보가 있는 검색어 ${report.length}개 (only ${min}건 이상)\n`);
    for (const { query, keywords, category, total, exact, candidates } of report) {
      console.log(`## ${query} [${category}] 결과 ${total}건 · 검색어 단독 포함 ${exact}건 · 사전 키워드 ${keywords.join(', ')}`);
      for (const [word, { all, only }] of candidates) console.log(`- [ ] ${word}  only ${only} · all ${all}`);
      console.log('');
    }
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof api.RecipeApiError ? error.message : 'Network or malformed response', foodRowsReceived: food.size }));
    process.exitCode = 1;
  }
}
