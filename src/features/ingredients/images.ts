// 카테고리별 썸네일 (Figma Thumnails 5038:7314). 냉장고 목록과 인식 결과 화면이 같이 쓴다.
const categoryImages: Record<string, string> = {
  '육류': 'thumb-meat.png',
  '과일': 'thumb-fruit.png',
  '채소': 'thumb-vegetable.png',
  '두부·콩류': 'thumb-bean.png',
  '곡물·두부': 'thumb-bean.png',
  '유제품': 'thumb-dairy.png',
  '수산물': 'thumb-fish.png',
  '조미료': 'thumb-sauce.png',
  '조미료·소스': 'thumb-sauce.png',
  '기타식재료': 'thumb-ingredients-etc.png',
  '기타 식재료': 'thumb-ingredients-etc.png',
  '밀키트': 'food-category-mealkit.png',
  '반찬': 'food-category-side-dish.png',
  '국·찌개': 'food-category-soup.png',
  '국·탕': 'food-category-soup.png',
  '배달음식': 'food-category-delivery.png',
  '기타음식': 'food-category-etc.png',
  '기타 음식': 'food-category-etc.png',
  '가공식품': 'thumb-processed.png',
};

export const categoryImage = (category: string) => categoryImages[category.trim().replace(/\s*·\s*/g, '·')] ?? 'thumb-ingredients-etc.png';

// 인식 결과와 저장된 식재료 모두 현재 카테고리에서 이미지를 계산한다.
export const ingredientImage = (item: { category: string }) => categoryImage(item.category);
