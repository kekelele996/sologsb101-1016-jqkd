/**
 * 提锂车间状态管理（Solid 原生能力）
 * 排池系串级走向和走水编排单，并管着成品卤罐。
 * - 排下一段走水前与巡测班按「池号 + 班次」对账，巡测未到指标的池先挂着不排
 * - 成品卤罐容量满时排队到下一班；罐位空出后由提锂车间本侧接着排
 */
import { createMemo, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { liveQuery } from 'dexie';
import type { Gate } from '../types/gate';
import type { Pond } from '../types/pond';
import type { PatrolSheet } from '../types/patrol';
import type { BrineTank, FlowOrder, FlowOrderDraft, FlowOrderState } from '../types/flow';
import type { ShiftName } from '../types/shift';
import {
  BRINE_TANK_ID,
  db,
  initDatabase,
  putBrineTank,
  putFlowOrder,
  removeFlowOrder,
} from '../utils/db';
import {
  cascadePathText,
  pickNextQueuedOrder,
  reconcileOrder,
  rollToNextShift,
  tankAfterOccupy,
  tankAfterRelease,
  tankCanAccept,
  tankFreeM3,
  tankIsFull,
  type ReconcileItem,
} from '../utils/handoff';
import { nowIso, today, uuid } from '../utils/id';

/** 成品卤罐默认容量（首次打开、台账缺失时兜底） */
const DEFAULT_TANK: BrineTank = {
  id: BRINE_TANK_ID,
  name: '成品卤罐 1#',
  capacityM3: 2000,
  occupiedM3: 0,
  updatedAt: '',
  revision: 3,
};

export interface FlowFilters {
  keyword: string;
  shift: ShiftName | 'all';
  state: FlowOrderState | 'all';
}

const EMPTY_FILTERS: FlowFilters = { keyword: '', shift: 'all', state: 'all' };

interface FlowState {
  rows: FlowOrder[];
  patrolSheets: PatrolSheet[];
  ponds: Pond[];
  gates: Gate[];
  tank: BrineTank;
  tankReady: boolean;
  loading: boolean;
  error: string;
  lastMessage: string;
}

function createFlowStore() {
  const [state, setState] = createStore<FlowState>({
    rows: [],
    patrolSheets: [],
    ponds: [],
    gates: [],
    tank: { ...DEFAULT_TANK },
    tankReady: false,
    loading: true,
    error: '',
    lastMessage: '',
  });
  const [filters, setFilters] = createSignal<FlowFilters>({ ...EMPTY_FILTERS });

  void initDatabase();

  liveQuery(async () => db.flowOrders.toArray()).subscribe({
    next: (list) => {
      setState(
        'rows',
        [...list].sort(
          (a, b) =>
            a.planDate.localeCompare(b.planDate) ||
            a.shift.localeCompare(b.shift, 'zh-Hans-CN') ||
            a.orderIndex - b.orderIndex,
        ),
      );
      setState('loading', false);
    },
    error: (err: unknown) => setState('error', err instanceof Error ? err.message : '读取走水编排单失败'),
  });

  liveQuery(async () => db.patrolSheets.toArray()).subscribe({
    next: (list) => setState('patrolSheets', list),
  });

  liveQuery(async () => db.ponds.toArray()).subscribe({
    next: (list) => setState('ponds', list),
  });

  liveQuery(async () => db.gates.toArray()).subscribe({
    next: (list) => setState('gates', list),
  });

  liveQuery(async () => db.brineTanks.toArray()).subscribe({
    next: (list) => {
      const tank = list.find((item) => item.id === BRINE_TANK_ID);
      setState({ tank: tank ?? { ...DEFAULT_TANK }, tankReady: tank !== undefined });
    },
  });

  function patchFilters(patch: Partial<FlowFilters>): void {
    setFilters({ ...filters(), ...patch });
  }

  function resetFilters(): void {
    setFilters({ ...EMPTY_FILTERS });
  }

  function setMessage(message: string): void {
    setState('lastMessage', message);
  }

  const pondOf = (pondId: string): Pond | undefined => state.ponds.find((pond) => pond.id === pondId);

  const pondLabel = (pondId: string): string => {
    const pond = pondOf(pondId);
    return pond === undefined ? '（池已删除）' : `${pond.code} · ${pond.seriesName}`;
  };

  /** 某源头池当前的串级走向文本（沿闸门推导） */
  function cascadePathOf(pondId: string): string {
    return cascadePathText(state.gates, state.ponds, pondId);
  }

  /** 与巡测班按「池号 + 班次」对账 */
  function reconcile(pondId: string, date: string, shift: ShiftName): ReconcileItem {
    return reconcileOrder(
      { pondId, planDate: date, shift },
      state.patrolSheets,
      (id) => pondOf(id)?.stage,
    );
  }

  const freeM3 = createMemo(() => tankFreeM3(state.tank));
  const isFull = createMemo(() => tankIsFull(state.tank));

  /**
   * 排产决策：先按「池号 + 班次」对账，再看成品卤罐罐容。
   * 罐满排队到下一班时，还要确认下一班同样有到指标的巡测单；
   * 若下一班也对不上账，则不排队、直接挂起（避免把单子滚到一个没有巡测依据的班次）。
   */
  function decidePlacement(
    pondId: string,
    date: string,
    shiftName: ShiftName,
    volumeM3: number,
  ): { state: FlowOrderState; check: ReconcileItem; planDate: string; shift: ShiftName } {
    const check = reconcile(pondId, date, shiftName);
    if (check.result !== 'ok') return { state: '挂起', check, planDate: date, shift: shiftName };
    if (tankCanAccept(state.tank, volumeM3)) return { state: '已排', check, planDate: date, shift: shiftName };
    const rolled = rollToNextShift(date, shiftName);
    const nextCheck = reconcile(pondId, rolled.date, rolled.shift);
    if (nextCheck.result !== 'ok') {
      return {
        state: '挂起',
        check: { ...check, result: 'pending', message: `卤罐已满，且${rolled.date} ${rolled.shift}${nextCheck.result === 'missing' ? '缺巡测单' : '巡测未到指标'}，先挂着` },
        planDate: date,
        shift: shiftName,
      };
    }
    return { state: '排队中', check, planDate: rolled.date, shift: rolled.shift };
  }

  /**
   * 新建下一段走水编排单：
   * - 对账不通过（缺巡测单 / 未到指标）：状态置「挂起」，不占罐位
   * - 对账通过但成品卤罐装不下：置「排队中」，排队到下一班
   * - 对账通过且罐位充足：置「已排」
   */
  async function createOrder(draft: FlowOrderDraft): Promise<{ order: FlowOrder; reconcile: ReconcileItem }> {
    const stamp = nowIso();
    const initialDate = draft.planDate === '' ? today() : draft.planDate;
    const decision = decidePlacement(draft.pondId, initialDate, draft.shift, draft.volumeM3);
    let queueReason = '';
    let queuedFromDate = '';
    let queuedFromShift: ShiftName | '' = '';
    if (decision.state === '排队中') {
      queueReason = '成品卤罐容量满，排队到下一班';
      queuedFromDate = initialDate;
      queuedFromShift = draft.shift;
    }

    const order: FlowOrder = {
      id: uuid('flow'),
      pondId: draft.pondId,
      cascadePath: cascadePathOf(draft.pondId),
      planDate: decision.planDate,
      shift: decision.shift,
      volumeM3: draft.volumeM3,
      operator: draft.operator.trim(),
      state: decision.state,
      queueReason,
      queuedFromDate,
      queuedFromShift,
      deliveredM3: 0,
      orderIndex: draft.orderIndex > 0 ? draft.orderIndex : state.rows.length + 1,
      createdAt: stamp,
      updatedAt: stamp,
      revision: 3,
    };
    await putFlowOrder(order);
    setState(
      'lastMessage',
      decision.state === '挂起'
        ? `${decision.check.message}：${pondLabel(draft.pondId)} 的单子先挂着`
        : decision.state === '排队中'
          ? `成品卤罐已满，${pondLabel(draft.pondId)} 排队到 ${decision.planDate} ${decision.shift}`
          : `对账通过：${pondLabel(draft.pondId)} 已排入 ${decision.planDate} ${decision.shift} 走水`,
    );
    return { order, reconcile: decision.check };
  }

  async function updateOrder(id: string, draft: FlowOrderDraft): Promise<void> {
    const existing = state.rows.find((row) => row.id === id);
    if (existing === undefined) return;
    await putFlowOrder({
      ...existing,
      pondId: draft.pondId,
      cascadePath: cascadePathOf(draft.pondId),
      planDate: draft.planDate,
      shift: draft.shift,
      volumeM3: draft.volumeM3,
      operator: draft.operator.trim(),
      state: draft.state,
      orderIndex: draft.orderIndex,
    });
    setState('lastMessage', '走水编排单已更新');
  }

  async function remove(id: string): Promise<void> {
    await removeFlowOrder(id);
    setState('lastMessage', '走水编排单已删除');
  }

  /**
   * 挂起单重新对账：巡测到指标后再排。
   * 罐满且下一班也有到指标巡测单则排队；否则继续挂着。
   */
  async function retrySuspended(id: string): Promise<'scheduled' | 'queued' | 'still-pending'> {
    const order = state.rows.find((row) => row.id === id);
    if (order === undefined || order.state !== '挂起') return 'still-pending';
    const decision = decidePlacement(order.pondId, order.planDate, order.shift, order.volumeM3);
    if (decision.state === '挂起') {
      setState('lastMessage', decision.check.message);
      return 'still-pending';
    }
    if (decision.state === '排队中') {
      await putFlowOrder({
        ...order,
        state: '排队中',
        queueReason: '成品卤罐容量满，排队到下一班',
        queuedFromDate: order.planDate,
        queuedFromShift: order.shift,
        planDate: decision.planDate,
        shift: decision.shift,
      });
      setState('lastMessage', `巡测已到指标，但卤罐仍满：排队到 ${decision.planDate} ${decision.shift}`);
      return 'queued';
    }
    await putFlowOrder({ ...order, state: '已排', queueReason: '', queuedFromDate: '', queuedFromShift: '' });
    setState('lastMessage', `对账通过：${pondLabel(order.pondId)} 已排入本班走水`);
    return 'scheduled';
  }

  /** 已排 → 走水中 */
  async function startRunning(id: string): Promise<void> {
    const order = state.rows.find((row) => row.id === id);
    if (order === undefined || order.state !== '已排') return;
    await putFlowOrder({ ...order, state: '走水中' });
    setState('lastMessage', `${pondLabel(order.pondId)} 开始走水`);
  }

  /**
   * 走水中 → 已入罐：把走水量计入成品卤罐存量。
   * 罐位不足时拒绝完成（理论上排产时已卡罐容，这里再兜底一次）。
   */
  async function completeToTank(id: string): Promise<boolean> {
    const order = state.rows.find((row) => row.id === id);
    if (order === undefined || order.state !== '走水中') return false;
    if (!tankCanAccept(state.tank, order.volumeM3)) {
      setState('lastMessage', '罐位不足，无法入罐，请先腾出成品卤罐');
      return false;
    }
    const nextTank = tankAfterOccupy(state.tank, order.volumeM3);
    await db.transaction('rw', db.flowOrders, db.brineTanks, async () => {
      await putFlowOrder({ ...order, state: '已入罐', deliveredM3: order.volumeM3 });
      await putBrineTank(nextTank);
    });
    setState('lastMessage', `${pondLabel(order.pondId)} 已入罐 ${order.volumeM3} m³，罐位剩余 ${tankFreeM3(nextTank)} m³`);
    return true;
  }

  /**
   * 罐位空出（成品外运 / 倒罐）：扣减罐存量，随后由提锂车间本侧接着排——
   * 从排队中的编排单里取最早、且当前罐位装得下的单子，恢复为「已排」并回到原班次视角。
   */
  async function releaseTank(volumeM3: number): Promise<FlowOrder | null> {
    const released = tankAfterRelease(state.tank, volumeM3);
    const next = pickNextQueuedOrder(state.rows, released);
    await db.transaction('rw', db.flowOrders, db.brineTanks, async () => {
      await putBrineTank(released);
      if (next !== null) {
        await putFlowOrder({
          ...next,
          state: '已排',
          queueReason: '',
          // 「接着排」：恢复到当初排队时的日期班次，由本班继续执行
          planDate: next.queuedFromDate !== '' ? next.queuedFromDate : next.planDate,
          shift: (next.queuedFromShift !== '' ? next.queuedFromShift : next.shift) as ShiftName,
          queuedFromDate: '',
          queuedFromShift: '',
        });
      }
    });
    if (next === null) {
      setState('lastMessage', `成品卤罐腾出 ${volumeM3} m³，当前没有可接着排的排队单`);
    } else {
      setState('lastMessage', `罐位空出：${pondLabel(next.pondId)} 由本侧接着排入走水`);
    }
    return next;
  }

  /** 直接编辑成品卤罐台账（容量 / 存量） */
  async function saveTank(patch: Pick<BrineTank, 'name' | 'capacityM3' | 'occupiedM3'>): Promise<void> {
    const next: BrineTank = {
      ...state.tank,
      name: patch.name.trim() || DEFAULT_TANK.name,
      capacityM3: Math.max(0, patch.capacityM3),
      occupiedM3: Math.min(Math.max(0, patch.occupiedM3), Math.max(0, patch.capacityM3)),
    };
    await putBrineTank(next);
    setState('lastMessage', '成品卤罐台账已更新');
  }

  const stats = createMemo(() => {
    const list = state.rows;
    return {
      total: list.length,
      suspended: list.filter((row) => row.state === '挂起').length,
      queued: list.filter((row) => row.state === '排队中').length,
      running: list.filter((row) => row.state === '走水中').length,
      delivered: list.filter((row) => row.state === '已入罐').length,
      freeM3: freeM3(),
      capacityM3: state.tank.capacityM3,
      occupiedM3: state.tank.occupiedM3,
      isFull: isFull(),
    };
  });

  return {
    state,
    filters,
    patchFilters,
    resetFilters,
    setMessage,
    pondOf,
    pondLabel,
    cascadePathOf,
    reconcile,
    decidePlacement,
    createOrder,
    updateOrder,
    remove,
    retrySuspended,
    startRunning,
    completeToTank,
    releaseTank,
    saveTank,
    stats,
  };
}

const store = createRoot(createFlowStore);

export function useFlowStore() {
  return store;
}
