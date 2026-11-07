import { useFridgeSort } from './useFridgeSort';

import { ActionButton } from '../../components/ActionButton';
import { asset } from '../../lib/assets';
import type { Navigate } from '../../prototype/flow';
import { FridgeTabs } from './FridgeTabs';
import { FridgeFilters } from './FridgeFilters';

export function FridgeFoodPage({ navigate }: { navigate: Navigate }) {
  const { sort, direction, onChange } = useFridgeSort();
  return <main className="fridge-page fridge-food-page" data-figma-node="5760:5875">
    <FridgeTabs food navigate={navigate} />
    <FridgeFilters value={sort} direction={direction} onChange={onChange} />
    <section className="fridge-empty-state" aria-label="등록된 음식 없음">
      <img className="empty-illustration" src={asset('fridge-food-empty.png')} alt="음식이 담긴 냄비 일러스트" />
      <div className="fridge-empty-text"><h2>아직 등록된 음식이 없어요</h2><p>직접 만든 음식부터 남은 배달 음식, 밀키트까지<br />등록하고 간편하게 관리해 보세요.</p></div>
      <div className="fridge-empty-action"><ActionButton className="action-button-large" onClick={() => navigate('registration')}>음식 등록하기</ActionButton></div>
    </section>
  </main>;
}
