import { CardShell } from '../../components/CardShell';
import { asset } from '../../lib/assets';
import type { Ingredient } from './repository';
import { deadlineDays, deadlineLabel } from './expiry';
import { IngredientThumbnail } from './IngredientThumbnail';
import type { SearchMatch } from '../fridge/search';

// 카드·홈·상세 모두 Figma 카테고리 썸네일(images.ts)을 쓴다.
export { ingredientImage } from './images';

// 검색으로 맞은 부분만 강조한다.
function HighlightedName({ name, ranges = [] }: { name: string; ranges?: [number, number][] }) {
  let cursor = 0;
  return <>{ranges.map(([start, end]) => {
    const before = name.slice(cursor, start);
    cursor = end;
    return <span key={start}>{before}<mark>{name.slice(start, end)}</mark></span>;
  })}{name.slice(cursor)}</>;
}

export function IngredientCard({ item, onOpen, match }: { item: Ingredient; onOpen: () => void; match?: SearchMatch }) {
  const percent = item.remainingPercent ?? 100;
  const days = deadlineDays(item.date);
  const bars: Record<number, string> = { 25: 'remaining-quarter.svg', 50: 'remaining-half.svg', 75: 'remaining-threequarter.svg', 100: 'ingredient-card-full.svg' };
  return <article data-figma-node="5820:5981"><button type="button" className="ingredient-card-trigger" aria-label={`${item.name} 상세 보기`} onClick={onOpen}>
    <CardShell className="ingredient-card"><div className="ingredient-card-image"><IngredientThumbnail item={item} /><span className={match?.category ? 'search-matched' : undefined}>{item.category}</span></div>
      <div className="ingredient-card-info"><h2 title={item.name}><HighlightedName name={item.name} ranges={match?.ranges} /></h2><div className="food-badges"><span>{item.storage}</span>{days !== null && days < 0 && <span className="red">기한경과</span>}{days !== null && days <= 3 && <span className={days < 0 ? 'red' : days === 0 ? 'orange' : 'green'}>{deadlineLabel(days)}</span>}</div><div className="ingredient-card-remaining"><p>남은 양</p><div>{percent === 0 ? <span className="ingredient-zero-bar" /> : <img src={asset(bars[percent])} alt="" />}<b>{percent}%</b></div></div></div>
    </CardShell>
  </button></article>;
}
