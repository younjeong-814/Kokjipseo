import { IngredientEditModal, type IngredientInfoPatch } from './IngredientEditModal';
import { Snackbar } from '../../components/Snackbar';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SubHeader } from '../../components/SubHeader';
import { CardShell } from '../../components/CardShell';
import { ActionButton } from '../../components/ActionButton';
import { OverlayDialog } from '../../components/OverlayDialog';
import { DateOverlay, HelpOverlay } from '../recognition/RecognitionOverlays';
import { asset } from '../../lib/assets';
import { formatMonthDay, toDateKey } from '../../lib/date';
import { particle } from '../../lib/korean';
import { conditionLabels, storageLocations, type Ingredient, type IngredientCondition } from './repository';
import { ingredientImage } from './IngredientCard';
import { deadlineDays, resolveExpiry, isFood } from './expiry';

function ConditionSheet({ item, onClose, onUpdate }: { item: Ingredient; onClose: () => void; onUpdate: (status: IngredientCondition) => void }) {
  const food = isFood(item);
  const noun = food ? '음식' : '식재료';
  const stateLabel = (value: IngredientCondition) => food ? value === conditionLabels[0] ? '아직 괜찮아요' : value === conditionLabels[1] ? '먹을 수 있어요' : value : value;
  const [status, setStatus] = useState<IngredientCondition | null>(item.conditionHistory?.[0]?.status ?? null);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const days = item.date ? Math.round((Date.parse(`${toDateKey(new Date())}T12:00:00Z`) - Date.parse(`${item.date}T12:00:00Z`)) / 86400000) : 0;
  return <OverlayDialog label={`${noun} 상태 설정`} sheet className="condition-sheet" onClose={onClose}>
    <div className="condition-handle"><span /></div><header><h2>현재 상태가 어떤가요?</h2><p>{days > 0 ? `소비기한이 ${days}일 지났어요. ` : ''}냄새, 색상, 포장 상태 등을 확인한 뒤 현재 상태를 선택해 주세요.</p></header>
    <fieldset><legend className="detail-sr-only">현재 {noun} 상태</legend>{conditionLabels.map(label => <label key={label} className={status === label ? 'selected' : ''}><input type="radio" name="ingredient-condition" value={label} checked={status === label} onChange={() => setStatus(label)} /><img src={asset(status === label ? 'state-selected.svg' : 'state-unselected.svg')} alt="" /><span>{stateLabel(label)}</span></label>)}</fieldset>
    {error && <p className="ingredient-error" role="alert">{error}</p>}<footer><ActionButton className="action-button-large" disabled={!status} onClick={() => { if (!status || saving.current) return; try { saving.current = true; onUpdate(status); } catch (failure) { saving.current = false; setError(failure instanceof Error ? failure.message : '저장하지 못했어요.'); } }}>상태 업데이트</ActionButton></footer>
  </OverlayDialog>;
}

// '못 먹겠어요'로 상태를 업데이트하면 바로 폐기할지 묻는다. 폐기하면 냉장고에서 지우고 리포트에 폐기로 남는다.
function DiscardConfirm({ item, onClose, onDiscard }: { item: Ingredient; onClose: () => void; onDiscard: () => void }) {
  const [error, setError] = useState('');
  return <OverlayDialog label={`${item.name} 폐기 확인`} className="ingredient-edit-modal discard-confirm" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); try { onDiscard(); } catch (failure) { setError(failure instanceof Error ? failure.message : '폐기하지 못했어요.'); } }}>
      <header><div><h2>이 재료를 정리할까요?</h2><p>{item.name}{particle(item.name, '을', '를')} 냉장고에서 지우고 이번 주 기록에 남겨요.</p></div></header>
      {error && <p role="alert" className="ingredient-error">{error}</p>}
      <footer><ActionButton type="button" className="ingredient-edit-cancel action-button-large" onClick={onClose}>나중에</ActionButton><ActionButton type="submit" className="discard-confirm-submit action-button-large">삭제하기</ActionButton></footer>
    </form>
  </OverlayDialog>;
}

function ConsumeConfirm({ item, onClose, onConsume }: { item: Ingredient; onClose: () => void; onConsume: () => void }) {
  const [error, setError] = useState('');
  const saving = useRef(false);
  return <OverlayDialog label={`${item.name} 소비 완료 확인`} className="ingredient-edit-modal consume-confirm" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); if (saving.current) return; try { saving.current = true; onConsume(); } catch (failure) { saving.current = false; setError(failure instanceof Error ? failure.message : '소비 완료를 저장하지 못했어요.'); } }}>
      <header><div><h2>모두 소비하셨나요?</h2><p>{item.name}{particle(item.name, '을', '를')} 냉장고에서 지우고 소비 완료로 기록해요.</p></div></header>
      {error && <p role="alert" className="ingredient-error">{error}</p>}
      <footer><ActionButton type="button" className="ingredient-edit-cancel action-button-large" onClick={onClose}>취소</ActionButton><ActionButton type="submit" className="action-button-large">소비 완료</ActionButton></footer>
    </form>
  </OverlayDialog>;
}
export function IngredientDetailPage({ item, onBack, onEdit, onSave, onCondition, onDiscard, onConsume }: { item: Ingredient; onBack: () => void; onEdit: (patch: IngredientInfoPatch) => void; onSave: (patch: { storage: string; date: string; dateSource?: 'manual' | 'automatic'; remainingPercent: number; remainingAdjusted?: boolean }) => void; onCondition: (status: IngredientCondition) => void; onDiscard: () => void; onConsume: () => void }) {
  const food = isFood(item);
  const noun = food ? '음식' : '식재료';
  const stateLabel = (value: IngredientCondition) => food ? value === conditionLabels[0] ? '아직 괜찮아요' : value === conditionLabels[1] ? '먹을 수 있어요' : '상했어요' : value === conditionLabels[2] ? '상했어요' : value;
  const [remainingPercent, setRemaining] = useState(item.remainingPercent ?? 100);
  const [remainingAdjusted, setRemainingAdjusted] = useState(item.remainingAdjusted || (item.remainingPercent ?? 100) < 100);
  const [storage, setStorage] = useState(item.storage);
  const [date, setDate] = useState(item.date);
  const [dateSource, setDateSource] = useState(item.dateSource);
  useEffect(() => { setDate(item.date); setDateSource(item.dateSource); }, [item.date, item.dateSource]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [overlay, setOverlay] = useState<'date' | 'condition' | 'discard' | 'consume' | 'help' | 'edit' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [snackbar, setSnackbar] = useState<{ id: number; message: string } | null>(null);
  const snackbarId = useRef(0);
  const showSaved = (text: string) => { setMessage(''); setError(''); setSnackbar({ id: ++snackbarId.current, message: text }); };
  const automated = item.source === 'camera' || item.source === 'ocr';
  // DB 기준으로 계산한 날짜면 등록 방식과 상관없이 AI 안내를 보여 주고, 사용자가 날짜를 직접 고르면 숨긴다.
  // 촬영·영수증 재료인데 DB에 없어 날짜를 못 정한 경우에는 "확인해 주세요" 안내를 그대로 보여 준다.
  const aiNotice = dateSource === 'automatic' || (automated && dateSource !== 'manual');
  const days = deadlineDays(date);
  return <main className={`ingredient-detail${automated ? ' automated' : ''}`} style={{ '--detail-thumb': `url("${asset('detail-slider-thumb.svg')}")` } as CSSProperties} data-figma-node={automated ? '5842:5091' : '5833:19874'}>
    <SubHeader title={`${noun} 상세`} backIcon="manual-back.svg" onBack={onBack} />
    <div className="ingredient-detail-content">
      <CardShell className="detail-summary"><img src={asset(ingredientImage(item))} alt="" /><div><h2>{item.name}</h2>{days !== null && <span className={`detail-deadline${days <= 0 ? ' expired' : ''}`}>{days === 0 ? 'D-DAY' : days > 0 ? `D-${days}` : `D+${-days}`}</span>}<p>{item.category}</p></div></CardShell>
      <section className="detail-remaining"><h2>남은 양</h2><div className="detail-remaining-headline"><strong>{remainingPercent}%</strong><b>남았어요</b></div><input aria-label="남은 양" type="range" min="0" max="100" step="25" value={remainingPercent} onChange={event => { setRemaining(Number(event.target.value)); setRemainingAdjusted(true); }} style={{ '--remaining': `${remainingPercent}%` } as CSSProperties} /><div className="detail-range-labels">{[0,25,50,75,100].map(value => <span key={value}>{value}%</span>)}</div></section>
      <section className="detail-info"><h2>보관 위치</h2><div className="detail-storage" role="group" aria-label="보관 위치">{storageLocations.map(value => <button type="button" key={value} aria-pressed={storage === value} onClick={() => { setStorage(value); if (dateSource === 'automatic' || !date) { const resolved = resolveExpiry({ ...item, storage: value, date: '' }, item); setDate(resolved.date); setDateSource(resolved.dateSource); } }}>{value}</button>)}</div>
        <div className="detail-info-row"><h2>소비 권장일</h2><button className="detail-date" onClick={() => setOverlay('date')}>{date ? formatMonthDay(date) : '날짜 선택'}<img src={asset('detail-calendar.svg')} alt="" /></button></div>
        {aiNotice && <button type="button" className="detail-ai" aria-haspopup="dialog" aria-label="AI 소비 권장일 안내" onClick={() => setOverlay('help')}><img src={asset('detail-sparkle.svg')} alt="" /><span><span className="detail-ai-message">{date ? `DB의 ${storage} 보관 기준으로 계산했어요` : '소비 권장일을 확인해 주세요'}</span><span className="detail-ai-link">안심 소비 설정 방법이 궁금하신가요?<img src={asset('detail-chevron.svg')} alt="" /></span></span></button>}
        <div className="detail-info-row"><h2>수량</h2><p>{item.quantity}{item.unit}</p></div>
        <div className="detail-history"><button className="detail-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><h2>{noun} 상태</h2><span className={historyOpen ? 'expanded' : ''}><img src={asset('detail-expand.svg')} alt="" /></span></button>{historyOpen && <ul aria-label={`${noun} 상태 이력`}>{item.conditionHistory?.length ? item.conditionHistory.map(record => <li key={record.id}><time dateTime={record.recordedAt}>{toDateKey(new Date(record.recordedAt)).replaceAll('-', '.')}</time><span className={`condition-badge condition-${conditionLabels.indexOf(record.status)}`}>{stateLabel(record.status)}</span></li>) : <li>아직 기록된 상태가 없어요.</li>}</ul>}</div>
      </section>
    </div>
    {error && <p className="ingredient-error" role="alert">{error}</p>}{message && <p className="detail-message" role="status">{message}</p>}
    <footer className="detail-footer"><ActionButton className="detail-outline action-button-large" onClick={() => setOverlay('condition')}>{noun} 상태 기록하기</ActionButton><ActionButton className="detail-edit action-button-large" onClick={() => setOverlay('edit')}>{noun} 정보 수정</ActionButton><ActionButton className="action-button-large" onClick={() => { if (remainingPercent === 0) { setOverlay('consume'); return; } try { onSave({ storage, date, dateSource, remainingPercent, remainingAdjusted }); } catch (failure) { setError(failure instanceof Error ? failure.message : '저장하지 못했어요.'); } }}>저장</ActionButton></footer>
    {snackbar && <Snackbar key={snackbar.id} variant="success" message={snackbar.message} className="detail-snackbar" onDismiss={() => setSnackbar(null)} />}
    {overlay === 'edit' && <IngredientEditModal item={item} quantityLocked={remainingAdjusted || item.remainingAdjusted || remainingPercent < 100 || (item.remainingPercent ?? 100) < 100} onClose={() => setOverlay(null)} onSave={patch => { onEdit(patch); showSaved(`${noun} 정보가 수정되었어요.`); }} />}
    {overlay === 'condition' && <ConditionSheet item={item} onClose={() => setOverlay(null)} onUpdate={status => { onCondition(status); setHistoryOpen(true); setMessage('상태를 업데이트했어요'); setOverlay(status === conditionLabels[2] ? 'discard' : null); }} />}
    {overlay === 'consume' && <ConsumeConfirm item={item} onClose={() => setOverlay(null)} onConsume={onConsume} />}
    {overlay === 'discard' && <DiscardConfirm item={item} onClose={() => setOverlay(null)} onDiscard={onDiscard} />}
    {overlay === 'date' && <DateOverlay label="소비 권장일 선택" value={date} onClose={() => setOverlay(null)} onSave={value => { setDate(value); setDateSource('manual'); setOverlay(null); }} />}
    {overlay === 'help' && <HelpOverlay figmaNode="5893:21525" onClose={() => setOverlay(null)} />}
  </main>;
}
