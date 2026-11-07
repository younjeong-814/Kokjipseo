// Screen keys are readable names; `figma` keeps the original node ID from read-only Figma reaction inspection.
export const screens = {
  'settings': { title: '설정', menu: 4, figma: '6224:19350' },
  'recipe-results': { title: '추천 레시피', menu: 3, figma: '3061:13305' },
  'recipe-detail': { title: '레시피 상세', menu: 3, figma: '3061:13432' },
  'ingredient-detail': { title: '식재료 상세', menu: 1, figma: '5833:19874' },
  'home': { title: '오늘의 냉장고', menu: 0, figma: '5558:18818' },
  'fridge': { title: '냉장고', menu: 1, figma: '5558:19292' },
  'fridge-food': { title: '냉장고', menu: 1, figma: '5760:5875' },
  'fridge-search': { title: '냉장고', menu: 1, figma: '5760:6413' },
  'fridge-registered': { title: '냉장고', menu: 1, figma: '5572:19852' },
  'registration': { title: '식재료 등록', menu: 2, figma: '5558:19197' },
  'guide-fridge': { title: '촬영 가이드', menu: 2, figma: '3061:13614' },
  'guide-product': { title: '촬영 가이드', menu: 2, figma: '3372:3710' },
  'guide-receipt': { title: '촬영 가이드', menu: 2, figma: '5572:19475' },
  'manual-entry': { title: '직접 입력', menu: 2, figma: '5733:5582' },
  'camera': { title: '영수증 촬영', menu: 2, figma: '5579:702' },
  'recognition-result': { title: '인식 결과 확인', menu: 2, figma: '5572:19525' },
  'recognition-failed': { title: '인식 실패', menu: 2, figma: '' },
  'recipe': { title: '레시피', menu: 3, figma: '5770:18522' },
  'recipe-no-result': { title: '추천 레시피', menu: 3, figma: '3061:13500' },
  'mypage': { title: '마이페이지', menu: 4, figma: '3061:13127' },
  'weekly-report': { title: '냉장고 리포트', menu: 4, figma: '3196:12098' },
} as const;
export type ScreenId = keyof typeof screens;
export type Navigate = (destination: ScreenId) => void;
export function isScreenId(value: string): value is ScreenId {
  return Object.hasOwn(screens, value);
}
// Bottom navigation targets per screen: [홈, 냉장고, 등록, 레시피, 마이]. null = current tab.
export const navigationDestinations: Record<ScreenId, readonly (string | null)[]> = {
  'settings': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'recipe-results': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'recipe-detail': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'ingredient-detail': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'home': [null, 'fridge', 'registration', 'recipe', 'mypage'],
  'fridge': ['home', null, 'registration', 'recipe', 'mypage'],
  'fridge-food': ['home', null, 'registration', 'recipe', 'mypage'],
  'fridge-search': ['home', null, 'registration', 'recipe', 'mypage'],
  'fridge-registered': ['home', null, 'registration', 'recipe', 'mypage'],
  'registration': ['home', 'fridge', null, 'recipe', 'mypage'],
  'guide-fridge': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'guide-product': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'guide-receipt': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'manual-entry': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'camera': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'recognition-result': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'recognition-failed': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'recipe': ['home', 'fridge', 'registration', null, 'mypage'],
  'recipe-no-result': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
  'mypage': ['home', 'fridge', 'registration', 'recipe', null],
  'weekly-report': ['home', 'fridge', 'registration', 'recipe', 'mypage'],
};
// `source` is the Figma node of the trigger; destinations outside the screen scope stay as Figma node IDs.
export const additionalConnections = {
  recognition: { source: '5580:758', destination: 'recognition-result' },
  recognitionAlbum: { source: '5580:752', destination: 'recognition-result' },
  recognitionRetake: { source: '5572:19564', destination: 'camera' },
  recognitionRegister: { source: '5572:19565', destination: 'fridge-registered' },
  receipt: { source: '5558:19209', destination: '5558:19377' },
  search: { source: 'I5558:19294;5021:6884', destination: 'fridge-search' },
} as const;
