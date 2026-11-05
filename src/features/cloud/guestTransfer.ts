import { cacheKey } from './storage';
import { mergeSnapshots, snapshotFromStorage, snapshotKeys, validateSnapshot, type AppStorage, type Snapshot } from './snapshot';

// 이미 다른 계정에 연결된 Google 계정으로 로그인하면 user.id가 바뀌어 임시 계정의 기록에 더는 접근할 수 없다.
// 로그인 직전에 임시 계정의 기록을 이 브라우저에 보관해 두었다가, 로그인한 계정의 기록에 합친다.
export const GUEST_TRANSFER_KEY = 'kokjipseo.guest-transfer.v1';
const MAX_AGE_MS = 60 * 60 * 1000;
type Disk = AppStorage & Pick<Storage, 'removeItem'>;
type Transfer = { from: string; createdAt: string; snapshot: Snapshot };
type Loader = () => Promise<unknown>;

const pick = (value: Snapshot): Snapshot => ({ ingredients: value.ingredients, history: value.history, activities: value.activities, recipes: value.recipes });
const isEmpty = (value: Snapshot) => (Object.keys(snapshotKeys) as (keyof Snapshot)[]).every(k => value[k].length === 0);

/** 임시 계정의 최신 기록(서버 기록 + 이 기기의 미전송분)을 보관한다. 보관할 기록을 확인하지 못하면 throw. */
export async function stashGuestRecords(from: string, load: Loader, disk: Disk = localStorage, now = new Date()) {
  const raw = disk.getItem(cacheKey(from));
  const cached = raw ? JSON.parse(raw) as { revision: number; pending: boolean; snapshot: Snapshot } : null;
  let remote: (Snapshot & { revision: number }) | null = null;
  try { remote = validateSnapshot(await load()); } catch (error) { if (!cached) throw error; }
  let snapshot: Snapshot;
  if (!remote) snapshot = pick(cached!.snapshot);
  else if (cached?.pending) snapshot = cached.revision === remote.revision ? pick(cached.snapshot) : mergeSnapshots(cached.snapshot, remote);
  else snapshot = pick(remote);
  validateSnapshot({ ...snapshot, revision: 0 });
  if (isEmpty(snapshot)) { disk.removeItem(GUEST_TRANSFER_KEY); return false; }
  disk.setItem(GUEST_TRANSFER_KEY, JSON.stringify({ from, createdAt: now.toISOString(), snapshot } satisfies Transfer));
  return true;
}

/** 다른 계정으로 로그인했을 때 보관한 임시 기록을 꺼낸다. 같은 계정·만료·손상된 보관분은 버린다. */
export function takeGuestRecords(owner: string, disk: Disk = localStorage, now = new Date()): Snapshot | null {
  try {
    const raw = disk.getItem(GUEST_TRANSFER_KEY);
    if (!raw) return null;
    disk.removeItem(GUEST_TRANSFER_KEY);
    const transfer = JSON.parse(raw) as Transfer;
    const age = now.getTime() - Date.parse(transfer.createdAt);
    if (transfer.from === owner || !(age >= 0 && age <= MAX_AGE_MS)) return null;
    validateSnapshot({ ...transfer.snapshot, revision: 0 });
    return pick(transfer.snapshot);
  } catch { return null; }
}

// 계정 저장으로 바뀌기 전에는 기록이 이 브라우저의 일반 키에 쌓였다. 처음 연결된 계정에 한 번 합치고 원본은 백업 키로 옮긴다.
export const LOCAL_BACKUP_KEY = 'kokjipseo.local-records-backup.v1';

/** 계정 저장 전환 전 이 브라우저에 남은 기록을 읽는다. 없거나 읽지 못하면 null(원본은 그대로 둔다). */
export function takeLocalRecords(disk: Disk = localStorage): Snapshot | null {
  try {
    const snapshot = snapshotFromStorage(disk);
    return isEmpty(snapshot) ? null : snapshot;
  } catch { return null; }
}

/** 계정에 합친 뒤 원본을 백업 키로 옮겨 다음 접속 때 다시 합치지 않게 한다. */
export function archiveLocalRecords(disk: Disk = localStorage, now = new Date()) {
  const raw = Object.fromEntries(Object.values(snapshotKeys).map(key => [key, disk.getItem(key)]).filter(([, value]) => value !== null));
  disk.setItem(`${LOCAL_BACKUP_KEY}.${now.getTime()}`, JSON.stringify(raw));
  for (const key of Object.keys(raw)) disk.removeItem(key);
}

/** 로그인한 계정의 기록을 우선하고, 없는 임시 기록만 더한다. 바뀐 항목 목록을 돌려준다. */
export function mergeGuestRecords(storage: AppStorage & { snapshot(): Snapshot }, guest: Snapshot) {
  const current = storage.snapshot();
  const merged = mergeSnapshots(current, guest);
  const changed = (Object.keys(snapshotKeys) as (keyof Snapshot)[]).filter(k => merged[k].length !== current[k].length);
  for (const k of changed) storage.setItem(snapshotKeys[k], JSON.stringify(merged[k]));
  return changed;
}
