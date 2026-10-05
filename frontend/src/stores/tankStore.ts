/**
 * 成品卤罐状态管理（Solid 原生能力）
 * 用 createStore 维护卤罐列表；通过 Dexie liveQuery 订阅全量数据。
 */
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { liveQuery } from 'dexie';
import type { FinishedBrineTank, TankDraft } from '../types/tank';
import { tankStatusFromLevel } from '../types/tank';
import { db, initDatabase, putTank, removeTank } from '../utils/db';
import { nowIso, uuid } from '../utils/id';

interface TankState {
  rows: FinishedBrineTank[];
  loading: boolean;
  error: string;
  lastMessage: string;
}

function createTankStore() {
  const [state, setState] = createStore<TankState>({
    rows: [],
    loading: true,
    error: '',
    lastMessage: '',
  });
  const [filters, setFilters] = createSignal<{ keyword: string; status: string | 'all' }>({
    keyword: '',
    status: 'all',
  });

  void initDatabase();

  liveQuery(async () => {
    return db.tanks.toArray();
  }).subscribe({
    next: (list) => {
      setState('rows', [...list].sort((a, b) => a.code.localeCompare(b.code)));
      setState('loading', false);
      setState('error', '');
    },
    error: (err: unknown) => {
      setState({ loading: false, error: err instanceof Error ? err.message : '读取成品卤罐数据失败' });
    },
  });

  function patchFilters(patch: Partial<{ keyword: string; status: string | 'all' }>): void {
    setFilters({ ...filters(), ...patch });
  }

  function setMessage(message: string): void {
    setState('lastMessage', message);
  }

  async function createTank(draft: TankDraft): Promise<FinishedBrineTank> {
    const stamp = nowIso();
    const row: FinishedBrineTank = {
      id: uuid('tank'),
      code: draft.code.trim() || '未命名罐',
      capacityM3: draft.capacityM3,
      currentLevelM3: draft.currentLevelM3,
      status: tankStatusFromLevel(draft.capacityM3, draft.currentLevelM3),
      pondId: draft.pondId,
      note: draft.note.trim(),
      createdAt: stamp,
      updatedAt: stamp,
      revision: 2,
    };
    await putTank(row);
    setState('lastMessage', `已新建成品卤罐：${row.code}`);
    return row;
  }

  async function updateTank(tankId: string, draft: TankDraft): Promise<void> {
    const existing = state.rows.find((row) => row.id === tankId);
    if (existing === undefined) return;
    await putTank({
      ...existing,
      code: draft.code.trim() || existing.code,
      capacityM3: draft.capacityM3,
      currentLevelM3: draft.currentLevelM3,
      status: tankStatusFromLevel(draft.capacityM3, draft.currentLevelM3),
      pondId: draft.pondId,
      note: draft.note.trim(),
    });
    setState('lastMessage', '成品卤罐已更新');
  }

  async function deleteTank(tankId: string): Promise<void> {
    await removeTank(tankId);
    setState('lastMessage', '成品卤罐已删除');
  }

  /** 推进液位（走水入罐 / 出卤排空），状态随之派生 */
  async function advanceLevel(tankId: string, nextLevelM3: number): Promise<void> {
    const existing = state.rows.find((row) => row.id === tankId);
    if (existing === undefined) return;
    const clamped = Math.max(0, Math.min(existing.capacityM3, nextLevelM3));
    await putTank({
      ...existing,
      currentLevelM3: clamped,
      status: tankStatusFromLevel(existing.capacityM3, clamped),
    });
    setState(
      'lastMessage',
      clamped >= existing.capacityM3
        ? `成品卤罐 ${existing.code} 已满，走水将排队到下一班`
        : `成品卤罐 ${existing.code} 液位已更新为 ${clamped} m³`,
    );
  }

  return {
    state,
    filters,
    patchFilters,
    setMessage,
    createTank,
    updateTank,
    deleteTank,
    advanceLevel,
  };
}

const store = createRoot(createTankStore);

export function useTankStore() {
  return store;
}
