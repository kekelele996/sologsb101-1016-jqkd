/**
 * 巡测班 × 提锂车间 交接逻辑（纯函数，便于单测与复用）
 * - 当班指标判定：巡测单上还没到指标的池先挂着不排
 * - 池系串级走向：沿闸门从源头池一路推导到末端
 * - 按「池号 + 班次」对账：两边日期/班次一致且巡测到指标才排入
 * - 成品卤罐容量：满则排队到下一班；罐位空出由提锂车间本侧接着排
 */
import type { Gate } from '../types/gate';
import type { Pond } from '../types/pond';
import type { PatrolSheet, PatrolStatus } from '../types/patrol';
import type { BrineTank, FlowOrder } from '../types/flow';
import { SHIFT_ORDER, isShiftName, nextShift, type ShiftName } from '../types/shift';

/**
 * 各蒸发阶段当班放卤（走水）密度指标（g/cm³）。
 * 密度达到本阶段指标才认为这口池当班「晒成了」，可排入走水。
 */
export const DISCHARGE_DENSITY_TARGET: Record<Pond['stage'], number> = {
  钠盐: 1.1,
  钾盐: 1.18,
  锂盐: 1.24,
};

/** 最低安全水位（cm）：低于该水位不具备走水条件 */
export const MIN_FLOW_LEVEL_CM = 10;

/** 巡测单当班是否到指标：密度达到阶段指标且水位不低于安全水位 */
export function patrolStatusOf(
  sheet: Pick<PatrolSheet, 'densityGcm3' | 'levelCm'>,
  stage: Pond['stage'],
): PatrolStatus {
  if (sheet.densityGcm3 >= DISCHARGE_DENSITY_TARGET[stage] && sheet.levelCm >= MIN_FLOW_LEVEL_CM) {
    return '到指标';
  }
  return '未到指标';
}

/** 找某口池作为上游的出流闸门 */
export function outboundGates(gates: Gate[], pondId: string): Gate[] {
  return gates
    .filter((gate) => gate.fromPondId === pondId && gate.state !== '关闭' && gate.openingPct > 0)
    .sort((a, b) => b.openingPct - a.openingPct);
}

/**
 * 沿闸门串级推导从源头池出发的走向链（池 id 序列）。
 * 取开度最大的出流闸作为主走向；遇到已访问的池即停止，防止备用闸成环时死循环。
 */
export function cascadeChainOf(gates: Gate[], sourcePondId: string, maxDepth = 12): string[] {
  const chain: string[] = [sourcePondId];
  const visited = new Set<string>([sourcePondId]);
  let current = sourcePondId;
  for (let i = 0; i < maxDepth; i += 1) {
    const next = outboundGates(gates, current)[0];
    if (next === undefined || visited.has(next.toPondId)) break;
    chain.push(next.toPondId);
    visited.add(next.toPondId);
    current = next.toPondId;
  }
  return chain;
}

/** 串级走向的池号文本，如「北-01 → 北-02 → 北-03」；查不到池号时回退 id */
export function cascadePathText(gates: Gate[], ponds: Pick<Pond, 'id' | 'code'>[], sourcePondId: string): string {
  const codeOf = new Map(ponds.map((pond) => [pond.id, pond.code]));
  return cascadeChainOf(gates, sourcePondId).map((id) => codeOf.get(id) ?? id).join(' → ');
}

/** 同池同班次对账键：池号 + 日期 + 班次 */
export function patrolKey(pondId: string, date: string, shift: ShiftName): string {
  return `${pondId}|${date}|${shift}`;
}

/** 某班某池「当班」巡测单（同池同班次只有一条；无则 undefined） */
export function findPatrolSheet(
  sheets: PatrolSheet[],
  pondId: string,
  date: string,
  shift: ShiftName,
): PatrolSheet | undefined {
  return sheets.find((sheet) => sheet.pondId === pondId && sheet.date === date && sheet.shift === shift);
}

export interface ReconcileItem {
  pondId: string;
  date: string;
  shift: ShiftName;
  /** 对账结果：ok 可排；pending 巡测未到指标先挂着；missing 本班没有巡测单 */
  result: 'ok' | 'pending' | 'missing';
  message: string;
}

/**
 * 排下一段走水前两边对账：按池号 + 班次核对巡测单。
 * - 本班没有巡测单：missing（不排）
 * - 巡测单未到指标：pending（先挂着不排）
 * - 到指标：ok
 */
export function reconcileOrder(
  order: Pick<FlowOrder, 'pondId' | 'planDate' | 'shift'>,
  sheets: PatrolSheet[],
  stageOf: (pondId: string) => Pond['stage'] | undefined,
): ReconcileItem {
  const sheet = findPatrolSheet(sheets, order.pondId, order.planDate, order.shift);
  if (sheet === undefined) {
    return { pondId: order.pondId, date: order.planDate, shift: order.shift, result: 'missing', message: '本班缺巡测单，暂不排' };
  }
  const stage = stageOf(order.pondId);
  if (stage === undefined) {
    return { pondId: order.pondId, date: order.planDate, shift: order.shift, result: 'missing', message: '找不到蒸发池台账，暂不排' };
  }
  const status = patrolStatusOf(sheet, stage);
  if (status === '未到指标') {
    return { pondId: order.pondId, date: order.planDate, shift: order.shift, result: 'pending', message: `巡测未到${stage}阶段指标，先挂着不排` };
  }
  return { pondId: order.pondId, date: order.planDate, shift: order.shift, result: 'ok', message: '对账通过，可排入走水' };
}

/** 罐内剩余可容存量（m³） */
export function tankFreeM3(tank: Pick<BrineTank, 'capacityM3' | 'occupiedM3'>): number {
  return Math.max(0, round1(tank.capacityM3 - tank.occupiedM3));
}

/** 罐是否已满（容差 0.05 m³，避免浮点误差） */
export function tankIsFull(tank: Pick<BrineTank, 'capacityM3' | 'occupiedM3'>): boolean {
  return tankFreeM3(tank) <= 0.05;
}

/** 当前罐位是否装得下指定走水量 */
export function tankCanAccept(tank: Pick<BrineTank, 'capacityM3' | 'occupiedM3'>, volumeM3: number): boolean {
  return tankFreeM3(tank) + 0.05 >= volumeM3;
}

/** 占用后罐内存量（封顶到总容量） */
export function tankAfterOccupy(tank: BrineTank, volumeM3: number): BrineTank {
  return { ...tank, occupiedM3: Math.min(tank.capacityM3, round1(tank.occupiedM3 + volumeM3)) };
}

/** 罐位空出（出罐外运 / 倒罐）后的存量，不允许为负 */
export function tankAfterRelease(tank: BrineTank, volumeM3: number): BrineTank {
  return { ...tank, occupiedM3: Math.max(0, round1(tank.occupiedM3 - volumeM3)) };
}

/**
 * 排队到下一班：白班→中班、中班→夜班；夜班顺延到次日白班。
 * 返回排队后的日期与班次。
 */
export function rollToNextShift(date: string, shift: ShiftName): { date: string; shift: ShiftName } {
  const following = nextShift(shift);
  if (following !== null) return { date, shift: following };
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    date: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`,
    shift: '白班',
  };
}

/** 班次先后比较：a 早于 b（按日期与班次序号） */
export function isShiftEarlier(aDate: string, aShift: ShiftName, bDate: string, bShift: ShiftName): boolean {
  if (aDate !== bDate) return aDate < bDate;
  return SHIFT_ORDER[aShift] < SHIFT_ORDER[bShift];
}

/**
 * 罐位空出后，由提锂车间本侧接着排：
 * 在排队中的编排单里，按「日期 + 班次 + orderIndex」取最早、且当前罐位装得下的单子。
 */
export function pickNextQueuedOrder(
  orders: FlowOrder[],
  tank: Pick<BrineTank, 'capacityM3' | 'occupiedM3'>,
): FlowOrder | null {
  const candidates = orders
    .filter((order) => order.state === '排队中' && tankCanAccept(tank, order.volumeM3))
    .sort(
      (a, b) =>
        a.planDate.localeCompare(b.planDate) ||
        SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift] ||
        a.orderIndex - b.orderIndex,
    );
  return candidates[0] ?? null;
}

/**
 * 升级迁移用：旧数据没写班次，按池号补默认班次。
 * 映射缺省为白班；值不是合法班次的也按白班兜底，调用方据此把「对不上的单列」。
 * 返回 { value, matched }：matched=false 表示原值对不上、被单列。
 */
export function resolveShift(rawShift: unknown, fallback: ShiftName = '白班'): { value: ShiftName; matched: boolean } {
  if (isShiftName(rawShift)) return { value: rawShift, matched: true };
  if (rawShift === undefined || rawShift === null || rawShift === '') return { value: fallback, matched: true };
  return { value: fallback, matched: false };
}

/** 保留 1 位小数 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
