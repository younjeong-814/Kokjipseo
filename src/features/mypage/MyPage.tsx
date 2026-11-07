import { useState } from 'react';
import type { Navigate } from '../../prototype/flow';
import type { WeeklyReport } from '../report/weeklyReport';

import { MyPageDashboard } from './MyPageDashboard';
import { ManagementScoreSheet } from './ManagementScoreSheet';

import { hasEnoughReportData, pendingReports, type MyPageReports } from './report';

const periods = ['주간', '월간', '연간'] as const;

export function MyPage({ navigate, onOpenManaged, registeredCount = 0, reports, error, report: weeklyReport, selectedPeriod, onPeriodChange }: { navigate: Navigate; selectedPeriod?: (typeof periods)[number]; onPeriodChange?: (period: (typeof periods)[number]) => void; onOpenManaged?: (period: (typeof periods)[number]) => void; registeredCount?: number; reports?: MyPageReports; error?: string; report?: WeeklyReport }) {
  const [localPeriod, setLocalPeriod] = useState<(typeof periods)[number]>('주간');
  const [scoreGuideOpen, setScoreGuideOpen] = useState(false);
  const period = selectedPeriod ?? localPeriod;
  const setPeriod = onPeriodChange ?? setLocalPeriod;

  const hasReport = Boolean(reports && Object.values(reports).some(value => value.managedCount > 0 || (value.completedItemCount ?? 0) > 0)) || registeredCount > 0 || Boolean(weeklyReport && (weeklyReport.consumed > 0 || weeklyReport.discarded > 0));
  const report = (reports ?? pendingReports(registeredCount))[period];
  // 아직 집계가 연결되지 않은 상태를 '완료 기록 0개'로 단정하지 않는다.
  const insufficient = hasReport && Boolean(reports) && !hasEnoughReportData(report);
  return (
    <main className={`mypage${insufficient ? ' mypage-insufficient' : ''}`} data-figma-node={insufficient ? '3061:13171' : '3061:12938'}>
      <div className="mypage-tabs" role="tablist" aria-label="리포트 기간">
        {periods.map(item => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={period === item}
            className={period === item ? 'selected' : ''}
            onClick={() => setPeriod(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}<button onClick={() => window.location.reload()}>다시 시도</button></p>}
      {/* 주간도 월간·연간처럼 데이터가 없으면 빈 값의 대시보드를 보여준다. */}
      <MyPageDashboard report={report} onOpenScoreGuide={() => setScoreGuideOpen(true)} onOpenManaged={() => onOpenManaged ? onOpenManaged(period) : navigate('weekly-report')} />
      {scoreGuideOpen && <ManagementScoreSheet score={report.score} onClose={() => setScoreGuideOpen(false)} />}
    </main>
  );
}
