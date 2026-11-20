import { asset } from '../../lib/assets';
import { ingredientImage } from './images';

export function IngredientThumbnail({ item, className }: { item: { category: string }; className?: string }) {
  const image = ingredientImage(item);
  return <img key={image} className={className} src={asset(image)} alt="" onError={event => {
    // 대체 이미지마저 실패해도 재요청을 반복하지 않는다.
    event.currentTarget.onerror = null;
    const fallback = asset('thumb-ingredients-etc.png');
    if (event.currentTarget.getAttribute('src') !== fallback) event.currentTarget.src = fallback;
  }} />;
}
