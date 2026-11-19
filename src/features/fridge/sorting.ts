export const sortLabels = ['소비기한', '등록순', '남은양순'] as const;
export type FridgeSort = typeof sortLabels[number];
export type SortDirection = 'asc' | 'desc';
// sort가 null이면 아무 필터도 고르지 않은 처음 상태다. 목록은 저장된 순서(최근 등록이 위)를 그대로 쓴다.
export type SortState = { sort: FridgeSort | null; direction: SortDirection };
// 소비기한은 가까운 날짜부터, 등록순과 남은양순은 내림차순부터 표시한다.
export const defaultDirection = (sort: FridgeSort | null): SortDirection => sort === '소비기한' ? 'asc' : 'desc';
export function nextSort(state: SortState, sort: FridgeSort): SortState {
  return { sort, direction: state.sort === sort ? state.direction === 'asc' ? 'desc' : 'asc' : defaultDirection(sort) };
}

export function sortIngredients<T extends { date: string; createdAt: string; remainingPercent?: number }>(items: readonly T[], { sort, direction }: SortState): T[] {
  if (!sort) return [...items];
  const sign = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sort === '소비기한') {
      // Unknown dates stay at the end in either direction.
      if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
      return sign * a.date.localeCompare(b.date);
    }
    return sign * (sort === '등록순' ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : (a.remainingPercent ?? 100) - (b.remainingPercent ?? 100));
  });
}
