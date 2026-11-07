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
const load = path => loadTs(new URL(path, import.meta.url));
const { classifyIngredient, isExcludedItem, recipeSearchKeyword } = load('../src/features/ingredients/classify.ts');
const { validateDraft } = load('../src/features/ingredients/repository.ts');
const expiry = load('../src/features/ingredients/expiry.ts');

// 상품명 → 기대 카테고리. 틀리는 사례를 찾으면 여기에 한 줄 추가하고 classify.ts 사전을 고친다.
const cases = [
  // 기본
  ['대파', '채소'], ['양파', '채소'], ['국산 깐마늘', '채소'], ['특등급 국산콩 콩나물', '채소'],
  ['햇사과 홍로', '과일'], ['단감', '과일'], ['배', '과일'], ['샤인머스캣', '과일'],
  ['한돈 삼겹살', '육류'], ['저온숙성 무항생제 한돈삼겹살', '육류'], ['생닭', '육류'], ['달걀', '육류'], ['계란', '육류'], ['메추리알', '육류'], ['유정란', '육류'],
  ['손질 생고등어', '수산물'], ['생굴', '수산물'], ['꽃게', '수산물'], ['광어회', '수산물'],
  ['CJ 행복한콩 두부', '두부·콩류'], ['완두콩', '두부·콩류'],
  ['서울우유', '유제품'], ['크림치즈', '유제품'],
  ['샘표 조선국간장', '조미료·소스'], ['새우젓', '조미료·소스'], ['딸기잼', '조미료·소스'], ['롯데 미림', '조미료·소스'],
  ['존쿡 델리미트 킬바사 소시지', '가공식품'], ['조미김', '반찬'],
  // 기타 식재료: 조리 재료로 쓰는 곡류·견과·음료 원료·가루
  ['이천쌀 10kg', '기타 식재료'], ['구운아몬드', '기타 식재료'], ['콜롬비아 원두', '기타 식재료'], ['백설 부침가루', '기타 식재료'], ['튀김가루', '기타 식재료'], ['드라이 이스트', '기타 식재료'],
  // 기타 음식: 간식·디저트·음료·샐러드
  // 가공식품: 육가공·면·냉동·즉석식품
  ['군만두', '가공식품'], ['비비고 군만두', '가공식품'], ['스팸 클래식', '가공식품'], ['오뚜기 3분카레', '가공식품'], ['햇반', '가공식품'], ['동원참치캔', '가공식품'], ['소면', '가공식품'],
  ['코카콜라', '기타 음식'], ['오렌지주스', '기타 음식'], ['콜드브루 커피', '기타 음식'], ['리코타 샐러드', '기타 음식'], ['햄치즈 샌드위치', '기타 음식'], ['신라면', '가공식품'], ['찹쌀떡', '기타 음식'], ['츄파춥스 사탕', '기타 음식'],
  // 반찬·국·찌개·밀키트
  ['종가 포기김치', '반찬'], ['멸치볶음', '반찬'], ['오이피클', '반찬'], ['부대찌개', '국·찌개'], ['돼지고기 짜글이', '국·찌개'], ['참치짜글이', '국·찌개'], ['순대국밥', '국·찌개'], ['감자수제비', '국·찌개'], ['마이셰프 밀키트', '밀키트'],
  // 밀키트 표현·전문 브랜드는 뒤 명사보다 우선한다
  ['프레시지 부대찌개', '밀키트'], ['밀키트 부대찌개', '밀키트'], ['MyChef 감바스', '밀키트'], ['가정간편식 김치찌개', '밀키트'],
  ['비비고 왕교자', '가공식품'],
  // 배달음식. 마트 냉동 제품은 더 긴 키워드로 가공식품
  ['후라이드 치킨', '배달음식'], ['페퍼로니 피자', '배달음식'], ['왕족발', '배달음식'], ['안동찜닭', '배달음식'], ['간장게장', '배달음식'], ['마라탕', '배달음식'], ['국물떡볶이', '배달음식'],
  ['오뚜기 냉동피자', '가공식품'], ['치킨너겟', '가공식품'], ['유부초밥', '기타 음식'], ['모짜렐라 치즈스틱', '가공식품'], ['짜장라면', '가공식품'],
  // 조리 표현: 날것 육류·수산물만 기타 음식으로 바꾼다. 계란류는 조리해도 육류다
  ['훈제오리', '기타 음식'], ['훈제연어', '기타 음식'],
  ['삶은계란', '육류'], ['삶은달걀', '육류'], ['구운계란', '육류'], ['구운란 구운계란', '육류'], ['삶은메추리알', '육류'],
  ['구운아몬드', '기타 식재료'], ['양념된 돼지갈비', '육류'], ['슬라이스 치즈', '유제품'], ['크래미', '가공식품'],
  // 규칙 2: 뒤에 오는 명사가 이긴다
  ['딸기우유', '유제품'], ['바나나우유', '유제품'], ['고추장', '조미료·소스'], ['사과식초', '조미료·소스'],
  ['닭가슴살 소시지', '가공식품'], ['우유식빵', '기타 음식'], ['피자치즈', '유제품'], ['참치캔', '가공식품'],
  ['샐러드 드레싱', '조미료·소스'], ['갈비양념', '조미료·소스'], ['전복죽', '가공식품'], ['새우깡', '기타 음식'], ['고기만두', '가공식품'], ['녹차라떼', '기타 음식'], ['샐러드채소', '채소'],
  // 규칙 3: 끝 위치가 같으면 긴 키워드
  ['아이스크림', '기타 음식'], ['고춧가루', '조미료·소스'], ['김치찌개', '국·찌개'], ['된장국', '국·찌개'], ['갈비탕', '국·찌개'], ['김밥', '기타 음식'], ['볶음밥', '가공식품'],
  // 규칙 4: 한 글자 키워드는 단어 끝에서만
  ['파프리카', '채소'], ['배추', '채소'], ['감자', '채소'], ['단무지', '반찬'], ['굴소스', '조미료·소스'], ['젓갈', '반찬'], ['게맛살', '가공식품'],
  // 규칙 5: 모르면 기타 음식
  ['키친타월', '기타 음식'], ['', '기타 음식'], ['잡채', '기타 음식'],
];

for (const [name, expected] of cases) {
  test(`${name || '(빈 이름)'} → ${expected}`, () => assert.equal(classifyIngredient(name), expected));
}

// 비식품·주류는 인식 결과에서 뺀다. 요리용 술과 이름이 비슷한 식품은 남긴다.
const excluded = [
  ['크리넥스 화장지 30롤', true], ['피죤 섬유유연제', true], ['건전지 AA', true], ['담배', true], ['종량제봉투', true], ['키친타월', true], ['센트룸 멀티비타민', true], ['신신 파스', true], ['샴푸', true], ['위생장갑', true],
  ['참이슬 후레쉬', true], ['카스 프레시', true], ['장수막걸리', true], ['레드와인', true], ['하이트 제로', true],
  ['롯데 미림', false], ['맛술', false], ['와인식초', false], ['카스테라', false], ['토마토 파스타', false], ['크랩 샐러드', false], ['서울우유', false], ['대파', false],
];
for (const [name, expected] of excluded) {
  test(`${name}: ${expected ? '제외' : '식품'}`, () => assert.equal(isExcludedItem(name), expected));
}

// 레시피 검색어: 묶음 명사(고기·버섯·나물·면)는 앞 단어로, 형태 명사(가루·소스·젓)는 붙은 이름 그대로 찾는다. 분류는 그대로다.
for (const [name, expected] of [
  ['오리고기', '오리'], ['훈제오리고기', '오리'], ['돼지고기', '돼지'], ['닭고기', '닭'],
  ['소고기', '소고기'], ['양고기', '양고기'], ['고기', '고기'], ['고기 500g', '고기'],
  ['표고버섯', '표고'], ['국내산 건표고버섯', '표고'], ['새송이버섯', '새송이'], ['목이버섯', '목이버섯'], ['버섯', '버섯'],
  ['숙주나물', '숙주'], ['참나물', '참나물'], ['콩나물', '콩나물'],
  ['파스타면', '파스타'], ['우동면', '우동'], ['두부면', '두부면'], ['라면', '라면'], ['소면', '소면'],
  ['카레가루', '카레가루'], ['고추가루', '고추가루'], ['밀가루', '밀가루'], ['토마토소스', '토마토소스'], ['굴소스', '굴소스'], ['새우젓', '새우젓'], ['멸치액젓', '액젓'],
  ['단감', '단감'], ['곶감', '곶감'],
  ['한돈 삼겹살', '삼겹살'], ['대파', '대파'], ['처음 보는 재료', '처음 보는 재료'],
]) {
  test(`레시피 검색어 ${name} → ${expected}`, () => assert.equal(recipeSearchKeyword(name), expected));
}
test('오리고기는 육류로 분류된다', () => assert.equal(classifyIngredient('오리고기'), '육류'));

test('every dictionary category is a registrable category', () => {
  const source = readFileSync(new URL('../src/features/ingredients/classify.ts', import.meta.url), 'utf8');
  const used = [...source.matchAll(/^\s+'([^']+)': \[/gm)].map(match => match[1]);
  assert.ok(used.length > 0);
  // OCR still emits legacy labels; they remain valid storage values even though
  // the manual picker exposes the new 13-category design.
  for (const category of [...used, '기타']) assert.equal(validateDraft({ name: '검증', category, storage: '냉장', quantity: 1, unit: '개', date: '' }), null, category);
});

test('shared thumbnails cover the five food categories and legacy ingredient labels', () => {
  const { categoryImage } = load('../src/features/ingredients/images.ts');
  for (const [category, expected] of [['밀키트','food-category-mealkit.png'], ['반찬','food-category-side-dish.png'], ['국·찌개','food-category-soup.png'], ['국·탕','food-category-soup.png'], ['배달음식','food-category-delivery.png'], ['기타음식','food-category-etc.png'], ['조미료·소스','thumb-sauce.png'], ['유제품','thumb-dairy.png']]) {
    assert.equal(categoryImage(category), expected);
    assert.ok(readFileSync(new URL(`../public/assets/${expected}`, import.meta.url)).length > 0);
  }
});

// 브랜드·수식어가 붙어도 분류 규칙의 키워드가 DB에 있으면 그 행을 쓴다. 없으면 추측하지 않는다.
test('recommendation lookup falls back to the classification keyword', () => {
  for (const [name, expected] of [['두부', '두부'], ['풀무원 국산콩 두부', '두부'], ['서울우유', '우유'], ['딸기우유', '우유'], ['김치찌개', null], ['한돈 삼겹살', null], ['키친타월', null]]) {
    assert.equal(expiry.recommendationName(name), expected, name);
  }
  assert.equal(expiry.calculateRecommendedDate('풀무원 국산콩 두부', '냉장', '2026-10-13'), expiry.calculateRecommendedDate('두부', '냉장', '2026-10-13'));
  assert.notEqual(expiry.calculateRecommendedDate('서울우유', '냉장', '2026-10-13'), '');
});

test('food without its own DB row uses the category record', () => {
  const at = (name, category, storage = '냉장') => expiry.resolveExpiry({ name, category, storage, date: '', storageStartedOn: '2026-10-13' }).date;
  assert.equal(at('후라이드 치킨', '배달음식'), '2026-10-15'); // 배달음식 3일 × 80% = 2일
  assert.equal(at('프레시지 부대찌개', '밀키트'), '2026-10-15');
  assert.equal(at('엄마표 멸치볶음', '반찬'), '2026-10-15');
  assert.equal(at('우리집 된장찌개', '국·찌개'), '2026-10-15');
  assert.equal(at('두부', '두부·콩류'), expiry.calculateRecommendedDate('두부', '냉장', '2026-10-13')); // 이름으로 찾으면 그대로
  assert.equal(at('처음보는음식', '기타 음식'), '');                 // 기준 행이 없는 카테고리는 비워 둔다
});

test('default storage: single record, then 냉장 → 실온 → 냉동, skipping 비권장 rows', () => {
  for (const [name, expected] of [
    ['마늘', '실온'],         // 기록 하나
    ['냉동만두', '냉동'],     // 기록 하나
    ['두부', '냉장'],         // 냉장 있음
    ['대파', '냉장'],         // 냉장·냉동 → 냉장
    ['양파', '실온'],         // 실온 + 냉동(비권장)
    ['감자', '실온'],         // 실온·냉동 → 실온
    ['귤', '냉장'],           // 냉장 + 냉동(비권장) → 냉장
    ['크림치즈', '냉장'],     // "냉동 비권장" 메모는 냉장 행을 막지 않음
    ['풀무원 국산콩 두부', '냉장'], // 브랜드명 → 두부
    ['키친타월', '냉장'],     // DB에 없음 → 기본값
  ]) assert.equal(expiry.defaultStorage(name), expected, name);
});

