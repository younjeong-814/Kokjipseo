import { asset } from '../../lib/assets';
import { toDateKey } from '../../lib/date';
import { IngredientThumbnail } from '../ingredients/IngredientThumbnail';
import type { Ingredient } from '../ingredients/repository';
import type { selectHomeIngredients } from './selectHomeIngredients';

export function HomeIngredientList({ selection, onOpen }: { selection: ReturnType<typeof selectHomeIngredients>; onOpen: (item: Ingredient) => void }) {
  const urgent = selection.mode === 'urgent';
  return <section className={`home-ingredient-list${urgent ? ' urgent' : ''}`} aria-labelledby="home-list-title" data-figma-node={urgent ? '3061:12569' : '3139:2363'}>
    <h2 id="home-list-title">{urgent ? '오늘의 소비 권장' : '최근 등록한 재료'}</h2>
    <ul>{selection.entries.map(({ item, days }) => <li key={item.id}><button type="button" aria-label={`${item.name} 상세 보기`} onClick={() => onOpen(item)}>
      <IngredientThumbnail className="home-ingredient-thumbnail" item={item} />
      <span className="home-ingredient-text"><strong title={item.name}>{item.name}</strong><span>{urgent ? `${item.storage} · ${item.quantity}${item.unit}` : `${toDateKey(new Date(item.createdAt)).slice(2).replaceAll('-', '.')} 등록`}</span></span>
      {urgent && days !== null ? <span className={`home-deadline ${days < 0 ? 'expired' : days === 0 ? 'today' : 'soon'}`}>{days < 0 ? '기한경과' : days === 0 ? 'D-DAY' : `D-${days}`}</span> : <img className="home-list-chevron" src={asset('home-list-chevron.svg')} alt="" />}
    </button></li>)}</ul>
  </section>;
}
