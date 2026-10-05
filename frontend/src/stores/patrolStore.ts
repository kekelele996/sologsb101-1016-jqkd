/**
 * 巡测班状态管理（Solid 原生能力）
 * 巡测班在池边把每口池当班的密度、水位、风力记成巡测单；同池同班次覆盖写入。
 */
import { createMemo, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { liveQuery } from 'dexie';
import type { PatrolDraft, PatrolSheet } from '../types/patrol';
import { db, initDatabase, removePatrolSheet, upsertPatrolSheet } from '../utils/db';
import { patrolStatusOf } from '../utils/handoff';
import { nowIso, today, uuid } from '../utils/id';
import type { Pond } from '../types/pond';
import type { ShiftName } from '../types/shift';

/** 巡测台筛选条件（关键字 + 班次 + 指标状态 + 日期），同步到 URL query */
export interface PatrolFilters {
  keyword: string;
  shift: ShiftName | 'all';
  status: 'all' | '到指标' | '未到指标';
  date: string;
  /** 只看升级时按池号补班次、待人工核对的单列记录 */
  backfilledOnly: boolean;
}

const EMPTY_FILTERS: PatrolFilters = { keyword: '', shift: 'all', status: 'all', date: '', backfilledOnly: false };

interface PatrolState {
  rows: PatrolSheet[];
  loading: boolean;
  error: string;
  lastMessage: string;
}

function createPatrolStore() {
  const [state, setState] = createStore<PatrolState>({ rows: [], loading: true, error: '', lastMessage: '' });
  const [filters, setFilters] = createSignal<PatrolFilters>({ ...EMPTY_FILTERS });

  void initDatabase();

  liveQuery(async () => db.patrolSheets.toArray()).subscribe({
    next: (list) => {
      setState(
        'rows',
        [...list].sort((a, b) => b.date.localeCompare(a.date) || b.shift.localeCompare(a.shift, 'zh-Hans-CN')),
      );
      setState('loading', false);
      setState('error', '');
    },
    error: (err: unknown) => {
      setState({ loading: false, error: err instanceof Error ? err.message : '读取巡测单失败' });
    },
  });

  function patchFilters(patch: Partial<PatrolFilters>): void {
    setFilters({ ...filters(), ...patch });
  }

  function resetFilters(): void {
    setFilters({ ...EMPTY_FILTERS });
  }

  function setMessage(message: string): void {
    setState('lastMessage', message);
  }

  /** 某池某班是否到指标（供页面徽标与编排台对账复用） */
  function statusOf(sheet: Pick<PatrolSheet, 'densityGcm3' | 'levelCm'>, pond: Pick<Pond, 'stage'> | undefined) {
    return pond === undefined ? '未到指标' : patrolStatusOf(sheet, pond.stage);
  }

  /** 取某池某日某班巡测单（没有则 undefined） */
  function sheetOf(pondId: string, date: string, shift: ShiftName): PatrolSheet | undefined {
    return state.rows.find((sheet) => sheet.pondId === pondId && sheet.date === date && sheet.shift === shift);
  }

  /** 结合池台账做筛选：指标状态依赖池阶段，必须由页面传入 ponds */
  const visibleFor = createMemo(() => {
    return (ponds: Pond[]): Array<PatrolSheet & { statusLabel: '到指标' | '未到指标' }> => {
      const stageOf = new Map(ponds.map((pond) => [pond.id, pond.stage]));
      const current = filters();
      const keyword = current.keyword.trim().toLowerCase();
      return state.rows
        .map((sheet) => {
          const stage = stageOf.get(sheet.pondId);
          const statusLabel = stage === undefined ? '未到指标' : patrolStatusOf(sheet, stage);
          return { ...sheet, statusLabel } as PatrolSheet & { statusLabel: '到指标' | '未到指标' };
        })
        .filter((sheet) => {
          if (current.date !== '' && sheet.date !== current.date) return false;
          if (current.shift !== 'all' && sheet.shift !== current.shift) return false;
          if (current.status !== 'all' && sheet.statusLabel !== current.status) return false;
          if (current.backfilledOnly && !sheet.shiftBackfilled) return false;
          if (keyword === '') return true;
          return (
            sheet.date.includes(keyword) ||
            sheet.shift.includes(keyword) ||
            sheet.recorder.toLowerCase().includes(keyword) ||
            String(sheet.densityGcm3).includes(keyword)
          );
        });
    };
  });

  async function saveOne(draft: PatrolDraft, editingId: string | null): Promise<PatrolSheet> {
    const existing = editingId === null ? undefined : state.rows.find((row) => row.id === editingId);
    const stamp = nowIso();
    const row = await upsertPatrolSheet({
      id: existing?.id ?? uuid('patrol'),
      pondId: draft.pondId,
      date: draft.date === '' ? today() : draft.date,
      shift: draft.shift,
      densityGcm3: draft.densityGcm3,
      levelCm: draft.levelCm,
      windLevel: draft.windLevel,
      recorder: draft.recorder.trim(),
      note: draft.note.trim(),
      shiftBackfilled: existing?.shiftBackfilled ?? false,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
      revision: 3,
    });
    setState('lastMessage', `已保存 ${row.date} ${row.shift} 的巡测单（同池同班自动覆盖）`);
    return row;
  }

  async function remove(id: string): Promise<void> {
    await removePatrolSheet(id);
    setState('lastMessage', '巡测单已删除');
  }

  return {
    state,
    filters,
    patchFilters,
    resetFilters,
    setMessage,
    statusOf,
    sheetOf,
    visibleFor,
    saveOne,
    remove,
  };
}

const store = createRoot(createPatrolStore);

export function usePatrolStore() {
  return store;
}
