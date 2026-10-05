/**
 * 排队工具（Queuing）
 * 成品卤罐容量满时走水排队到下一班；罐位空出来由提锂车间本侧接着排。
 */
import type { FinishedBrineTank } from '../types/tank';
import type { Schedule } from '../types/schedule';
import type { Shift } from '../types/shift';
import { nextShift } from './reconcile';

/** 排队结果 */
export interface QueueResult {
  /** 是否需要排队（罐满） */
  queued: boolean
  /** 排队到的班次（queued 为 true 时有值） */
  targetShift: Shift | null
  /** 排队原因 */
  reason: string
}

/**
 * 判断走水是否需要排队：成品卤罐容量满时排队到下一班。
 * - 罐满 → 排队到下一班
 * - 罐未满 → 不排队，本班排
 */
export function checkQueue(
  tank: FinishedBrineTank | undefined,
  currentShift: Shift,
  shifts: Shift[],
): QueueResult {
  if (tank === undefined) {
    return { queued: false, targetShift: null, reason: '无成品卤罐' };
  }
  if (tank.status !== '满') {
    return { queued: false, targetShift: null, reason: '罐位未满' };
  }
  const next = nextShift(currentShift, shifts);
  if (next === null) {
    return { queued: true, targetShift: null, reason: '罐满且无下一班可排' };
  }
  return { queued: true, targetShift: next, reason: '成品卤罐已满，排队到下一班' };
}

/**
 * 罐位空出来后，由提锂车间本侧接着排：
 * 把排队中的走水编排单状态从「待排」推进到「已排」。
 */
export function continueQueuedSchedules(
  schedules: Schedule[],
  tank: FinishedBrineTank,
): Schedule[] {
  if (tank.status === '满') return schedules;
  return schedules.map((row) => {
    if (row.state === '待排') {
      return { ...row, state: '已排' as const };
    }
    return row;
  });
}
