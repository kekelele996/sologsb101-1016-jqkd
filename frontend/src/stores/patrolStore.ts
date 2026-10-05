/**
 * 巡测单状态管理（Solid 原生能力）
 * 用 createStore 维护巡测单列表；通过 Dexie liveQuery 订阅全量数据。
 */
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { liveQuery } from 'dexie';
import type { PatrolSheet, PatrolSheetDraft } from '../types/patrolSheet';
import { db, initDatabase, removePatrolSheet, upsertPatrolSheet } from '../utils/db';
import { nowIso, uuid } from '../utils/id';

interface PatrolState {
  rows: PatrolSheet[];
  loading: boolean;
  error: string;
  lastMessage: string;
}

function createPatrolStore() {
  const [state, setState] = createStore<PatrolState>({
    rows: [],
    loading: true,
    error: '',
    lastMessage: '',
  });
  const [filters, setFilters] = createSignal<{ keyword: string; shiftId: string | 'all' }>({
    keyword: '',
    shiftId: 'all',
  });

  void initDatabase();

  liveQuery(async () => {
    return db.patrolSheets.toArray();
  }).subscribe({
    next: (list) => {
      setState('rows', [...list].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)));
      setState('loading', false);
      setState('error', '');
    },
    error: (err: unknown) => {
      setState({ loading: false, error: err instanceof Error ? err.message : '读取巡测单数据失败' });
    },
  });

  function patchFilters(patch: Partial<{ keyword: string; shiftId: string | 'all' }>): void {
    setFilters({ ...filters(), ...patch });
  }

  function setMessage(message: string): void {
    setState('lastMessage', message);
  }

  /** 保存巡测单：同池同班覆盖写入 */
  async function saveOne(draft: PatrolSheetDraft): Promise<PatrolSheet> {
    const stamp = nowIso();
    const row: PatrolSheet = {
      id: uuid('patrol'),
      pondId: draft.pondId,
      shiftId: draft.shiftId,
      densityGcm3: draft.densityGcm3,
      levelCm: draft.levelCm,
      windLevel: draft.windLevel,
      measuredAt: draft.measuredAt,
      note: draft.note.trim(),
      createdAt: stamp,
      updatedAt: stamp,
      revision: 2,
    };
    const saved = await upsertPatrolSheet(row);
    setState('lastMessage', `已保存 ${saved.measuredAt} 的巡测记录（同池同班自动覆盖）`);
    return saved;
  }

  async function deletePatrolSheet(id: string): Promise<void> {
    await removePatrolSheet(id);
    setState('lastMessage', '巡测单已删除');
  }

  return {
    state,
    filters,
    patchFilters,
    setMessage,
    saveOne,
    deletePatrolSheet,
  };
}

const store = createRoot(createPatrolStore);

export function usePatrolStore() {
  return store;
}
