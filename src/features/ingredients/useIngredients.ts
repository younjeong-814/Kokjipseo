import { useAppStorage } from '../cloud/StorageContext';
import { CloudStorage } from '../cloud/storage';
import { syncActivities } from '../mypage/activityLog';
import { loadHistory } from '../report/weeklyReport';
import { consumeIngredient } from './consumeIngredient';
import { useEffect, useState } from 'react';
import { updateIngredientInfo } from './repository';
import type { IngredientInfoPatch } from './IngredientEditModal';
import { recordDisposal } from '../report/weeklyReport';
import { takeIngredient, restoreIngredient, type RemovedIngredient } from './repository';
import { deleteIngredient, INGREDIENTS_KEY, loadIngredients, saveIngredient, updateIngredientDetails, recordIngredientCondition, saveRecognizedIngredients, type IngredientCondition, type Ingredient, type IngredientDraft } from './repository';

export function useIngredients() {
  const storage=useAppStorage();
  const [state, setState] = useState<{ items: Ingredient[]; error: string }>(() => {
    try { return { items: loadIngredients(storage), error: '' }; }
    catch { return { items: [], error: '저장된 데이터를 읽을 수 없습니다. 브라우저 저장 설정을 확인해 주세요.' }; }
  });
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== INGREDIENTS_KEY && event.key !== null) return;
      try { setState({ items: loadIngredients(storage), error: '' }); }
      catch { setState(previous => ({ ...previous, error: '저장된 데이터를 읽을 수 없습니다. 기존 데이터는 덮어쓰지 않습니다.' })); }
    };
    const refresh=()=>sync({key:INGREDIENTS_KEY} as StorageEvent);
    if(storage instanceof CloudStorage)storage.changed.addEventListener('change',refresh);
    window.addEventListener('storage', sync);
    return () => {window.removeEventListener('storage', sync);if(storage instanceof CloudStorage)storage.changed.removeEventListener('change',refresh);};
  }, [storage]);
  const commit = (items: Ingredient[]) => {
    let warning = '';
    try { syncActivities(storage, items, loadHistory(storage), state.items); }
    catch { warning = '식재료 변경은 저장했지만 리포트 이력을 저장하지 못했어요. 저장 공간을 확인해 주세요.'; }
    setState({ items, error: warning });
  };
  return {
    ...state,
    updateInfo: (id: string, patch: IngredientInfoPatch) => {
      try { commit(updateIngredientInfo(storage, id, patch)); }
      catch (error) { throw new Error(error instanceof Error ? error.message : '저장하지 못했어요.'); }
    },
    updateDetails: (id: string, patch: { storage: string; date: string; dateSource?: 'manual' | 'automatic'; remainingPercent: number; remainingAdjusted?: boolean }) => {
      try { commit(updateIngredientDetails(storage, id, patch)); }
      catch { throw new Error('저장하지 못했어요. 저장 공간과 항목 상태를 확인해 주세요.'); }
    },
    recordCondition: (id: string, status: IngredientCondition) => {
      try { commit(recordIngredientCondition(storage, id, status)); }
      catch { throw new Error('상태를 저장하지 못했어요. 다시 시도해 주세요.'); }
    },
    saveRecognized: (drafts: IngredientDraft[]) => {
      try { commit(saveRecognizedIngredients(storage, drafts)); }
      catch { throw new Error('인식한 재료를 저장하지 못했어요. 다시 시도해 주세요.'); }
    },
    save: (draft: IngredientDraft, id?: string) => {
      try { commit(saveIngredient(storage, draft, id)); }
      catch (error) { throw new Error(error instanceof Error && error.message.includes('항목') ? error.message : '저장하지 못했어요. 브라우저 저장 공간과 설정을 확인해 주세요.'); }
    },
    consume: (id: string) => {
      try { commit(consumeIngredient(storage, id)); }
      catch (failure) { throw new Error(failure instanceof Error ? failure.message : '소비 완료를 저장하지 못했어요.'); }
    },
    removeFromList: (id: string) => {
      const { items, removed } = takeIngredient(storage, id);
      setState({ items, error: '' });
      return removed;
    },
    restoreToList: (removed: RemovedIngredient) => {
      setState({ items: restoreIngredient(storage, removed), error: '' });
    },
    remove: (id: string) => {
      const removed = state.items.find(item => item.id === id);
      let next: Ingredient[];
      try { next = deleteIngredient(storage, id); }
      catch { throw new Error('삭제하지 못했어요. 브라우저 저장 공간과 설정을 확인해 주세요.'); }
      // 리포트 기록은 실패해도 삭제 자체는 유지한다.
      if (removed) try { recordDisposal(storage, removed); } catch { /* 기존 삭제 동작 유지 */ }
      commit(next);
    },
  };
}
