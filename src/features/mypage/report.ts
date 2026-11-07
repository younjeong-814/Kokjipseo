export type ReportPeriod = '주간' | '월간' | '연간';
export type MyPageReport = {
  completedItemCount?: number;
  scoreLabel: string;
  score: number | null;
  grade: string;
  // 점수 아래 안내 문구. 점수 계산 전·실패 시에도 갱신 시각 안내를 기본으로 보여 준다.
  scoreChange: string | null;
  // 이전 기간과 비교할 기록이 없으면 null이며 피드백 카드를 숨긴다.
  feedbackTitle: string | null;
  feedbackDescription: string | null;
  previousLabel: string;
  currentLabel: string;
  consumed: { previous: number | null; current: number | null };
  discarded: { previous: number | null; current: number | null };
  managedLabel: string;
  managedCount: number;
  consumptionRate: number | null;
  consumptionLabel: string;
  managementRate?: number | null;
  scoreUpdatedAt?: string;
};
export type MyPageReports = Record<ReportPeriod, MyPageReport>;

export function pendingReports(registeredCount: number): MyPageReports {
  return Object.fromEntries((['주간','월간','연간'] as const).map(period => [period, {
    completedItemCount: 0, scoreLabel: period === '주간' ? '이번 주 냉장고 관리 점수' : period === '월간' ? '이번 달 냉장고 관리 점수' : '올해 냉장고 관리 점수', score: null, grade: '관리 기록을 모으고 있어요', scoreChange: '점수는 매일 오전 6시에 업데이트돼요',
    feedbackTitle: null, feedbackDescription: null,
    previousLabel: period === '주간' ? '지난주' : period === '월간' ? '지난달' : '지난해', currentLabel: period === '주간' ? '이번 주' : period === '월간' ? '이번 달' : '올해',
    consumed: { previous: null, current: null }, discarded: { previous: null, current: null },
    managedLabel: period === '주간' ? '이번주 관리 현황' : period === '월간' ? '이번달 관리 현황' : '이번년도 관리 현황', managedCount: registeredCount, consumptionRate: null, consumptionLabel: `${period} 소비율`,
  }])) as MyPageReports;
}

// 지난달 → 지난달과, 지난주·지난해 → 지난주와·지난해와 (받침 유무로 조사 선택)
export function withAnd(label: string): string {
  const code = label.charCodeAt(label.length - 1) - 0xac00;
  return label + (code >= 0 && code % 28 !== 0 ? '과' : '와');
}

// 폐기율 변화는 이전 기간 폐기 건수가 있어야 계산할 수 있다. 없으면 카드를 숨긴다.
export function discardFeedback(previousLabel: string, currentLabel: string, previous: number, current: number): Pick<MyPageReport,'feedbackTitle'|'feedbackDescription'> {
  if (previous <= 0) return { feedbackTitle: null, feedbackDescription: null };
  const change = Math.round(Math.abs(previous - current) / previous * 100);
  if (change === 0) return { feedbackTitle: `${withAnd(previousLabel)} 폐기율이 같아요`, feedbackDescription: `${currentLabel}도 꾸준히 관리하고 있어요` };
  return current < previous
    ? { feedbackTitle: `${previousLabel}보다 폐기율이 ${change}% 줄었어요!`, feedbackDescription: `${currentLabel}도 알뜰하게 관리하고 있어요` }
    : { feedbackTitle: `${previousLabel}보다 폐기율이 ${change}% 늘었어요`, feedbackDescription: `${currentLabel}은 폐기를 조금 줄여 볼까요?` };
}

// 소비/폐기를 완료한 식재료 개수. 단위가 다른 수량을 합산하거나 등록 개수로 대신하지 않는다.
export function hasEnoughReportData(report: MyPageReport): boolean {
  return report.completedItemCount === undefined ? report.score !== null : report.completedItemCount >= 3;
}
