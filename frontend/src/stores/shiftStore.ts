/**
 * 班次状态管理（Solid 原生能力）
 * 用 createStore 维护班次列表；通过 Dexie liveQuery 订阅全量数据。
 */
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { liveQuery } from 'dexie';
import type { Shift, ShiftDraft } from '../types/shift';
import { db, initDatabase, putShift, removeShift } from '../utils/db';
import { nowIso, uuid } from '../utils/id';

interface ShiftState {
  rows: Shift[];
  loading: boolean;
  error: string;
  lastMessage: string;
}

function createShiftStore() {
  const [state, setState] = createStore<ShiftState>({
    rows: [],
    loading: true,
    error: '',
    lastMessage: '',
  });
  const [filters, setFilters] = createSignal<{ keyword: string }>({ keyword: '' });

  void initDatabase();

  liveQuery(async () => {
    return db.shifts.toArray();
  }).subscribe({
    next: (list) => {
      setState('rows', [...list].sort((a, b) => a.date.localeCompare(b.date) || a.shiftType.localeCompare(b.shiftType)));
      setState('loading', false);
      setState('error', '');
    },
    error: (err: unknown) => {
      setState({ loading: false, error: err instanceof Error ? err.message : '读取班次数据失败' });
    },
  });

  function patchFilters(patch: Partial<{ keyword: string }>): void {
    setFilters({ ...filters(), ...patch });
  }

  function setMessage(message: string): void {
    setState('lastMessage', message);
  }

  async function createShift(draft: ShiftDraft): Promise<Shift> {
    const stamp = nowIso();
    const row: Shift = {
      id: uuid('shift'),
      date: draft.date,
      shiftType: draft.shiftType,
      leader: draft.leader.trim(),
      note: draft.note.trim(),
      createdAt: stamp,
      updatedAt: stamp,
      revision: 2,
    };
    await putShift(row);
    setState('lastMessage', `已新建班次：${row.date} ${row.shiftType}`);
    return row;
  }

  async function updateShift(shiftId: string, draft: ShiftDraft): Promise<void> {
    const existing = state.rows.find((row) => row.id === shiftId);
    if (existing === undefined) return;
    await putShift({
      ...existing,
      date: draft.date,
      shiftType: draft.shiftType,
      leader: draft.leader.trim(),
      note: draft.note.trim(),
    });
    setState('lastMessage', '班次已更新');
  }

  async function deleteShift(shiftId: string): Promise<void> {
    await removeShift(shiftId);
    setState('lastMessage', '班次已删除');
  }

  return {
    state,
    filters,
    patchFilters,
    setMessage,
    createShift,
    updateShift,
    deleteShift,
  };
}

const store = createRoot(createShiftStore);

export function useShiftStore() {
  return store;
}
