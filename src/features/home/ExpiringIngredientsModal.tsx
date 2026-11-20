import { useState } from 'react';
import { OverlayDialog } from '../../components/OverlayDialog';
import { ActionButton } from '../../components/ActionButton';
import { asset } from '../../lib/assets';
import { IngredientThumbnail } from '../ingredients/IngredientThumbnail';
import { deadlineLabel } from '../ingredients/expiry';
import type { Ingredient } from '../ingredients/repository';

type Entry = { item: Ingredient; days: number };
const dismissedKey = 'kokjipseo:expiry-modal-dismissed';

export function ExpiringIngredientsModal({ entries, onOpenFridge }: { entries: Entry[]; onOpenFridge: () => void }) {
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem(dismissedKey) !== new Date().toISOString().slice(0, 10); }
    catch { return true; }
  });
  const close = () => {
    setOpen(false);
    try { sessionStorage.setItem(dismissedKey, new Date().toISOString().slice(0, 10)); } catch { /* 저장이 불가해도 모달은 닫는다 */ }
  };
  if (!open) return null;
  return <OverlayDialog label="확인이 필요한 식재료가 있어요" className="expiring-modal" onClose={close} dismissOutside>
    <section className="expiring-modal-content" data-figma-node="3068:8825">
      <header className="expiring-modal-heading">
        <div><h2>확인이 필요한 식재료가 있어요</h2><p>소비기한이 얼마 남지 않은 재료가 있어요</p></div>
        <button type="button" className="expiring-modal-close" aria-label="닫기" onClick={close}><img src={asset('manual-close.svg')} alt="" /></button>
      </header>
      <ul className="expiring-modal-list">{entries.map(({ item, days }) => <li key={item.id}>
        <IngredientThumbnail className="expiring-modal-thumb" item={item} />
        <span className="expiring-modal-name"><strong title={item.name}>{item.name}</strong><span>{item.storage}</span></span>
        <span className={`expiring-modal-dday${days <= 0 ? ' expired' : ''}`}>{days < 0 ? '기한경과' : deadlineLabel(days)}</span>
      </li>)}</ul>
      <footer><ActionButton className="action-button-large" onClick={() => { close(); onOpenFridge(); }}>지금 확인하기</ActionButton></footer>
      <button type="button" className="expiring-modal-today" onClick={close}>오늘 하루 보지 않기</button>
    </section>
  </OverlayDialog>;
}
