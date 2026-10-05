/**
 * 对账工具（Reconciliation）
 * 排下一段走水时，提锂车间按池号和班次与巡测班对账：
 * 巡测单上还没到指标的池先挂着不排。
 */
import type { PatrolSheet } from '../types/patrolSheet';
import type { Schedule } from '../types/schedule';
import type { Shift } from '../types/shift';

/** 对账结果 */
export interface ReconcileResult {
  /** 是否对得上（巡测单存在且密度达到目标） */
  matched: boolean
  /** 对不上的原因（matched 为 false 时有值） */
  reason: string
  /** 巡测单密度（matched 为 true 时有值） */
  densityGcm3: number
  /** 目标密度（matched 为 true 时有值） */
  targetDensity: number
}

/**
 * 按池号 + 班次对账：判断该池在该班次是否可以排下一段走水。
 * - 没有巡测单 → 对不上（无巡测单）
 * - 巡测密度 < 目标密度 → 对不上（未到指标），先挂着不排
 * - 巡测密度 >= 目标密度 → 对得上，可以排
 */
export function reconcileByPondAndShift(
  pondId: string,
  shiftId: string,
  patrolSheets: PatrolSheet[],
  schedules: Schedule[],
): ReconcileResult {
  const sheet = patrolSheets.find((row) => row.pondId === pondId && row.shiftId === shiftId);
  if (sheet === undefined) {
    return { matched: false, reason: '无巡测单', densityGcm3: 0, targetDensity: 0 };
  }
  // 目标密度：取该池最近一条走水编排单的目标密度（没有则用经验阈值 1.10）
  const pondSchedules = schedules
    .filter((row) => row.pondId === pondId)
    .sort((a, b) => a.planDate.localeCompare(b.planDate));
  const targetDensity = pondSchedules.length > 0 ? pondSchedules[pondSchedules.length - 1].targetDensity : 1.1;
  if (sheet.densityGcm3 < targetDensity) {
    return {
      matched: false,
      reason: `未到指标（${sheet.densityGcm3} < ${targetDensity} g/cm³）`,
      densityGcm3: sheet.densityGcm3,
      targetDensity,
    };
  }
  return { matched: true, reason: '', densityGcm3: sheet.densityGcm3, targetDensity };
}

/** 「挂着」状态：巡测单还没到指标，先不排 */
export function isHeld(result: ReconcileResult): boolean {
  return !result.matched && result.reason.startsWith('未到指标');
}

/** 「缺单」状态：没有巡测单，无法对账 */
export function isMissingSheet(result: ReconcileResult): boolean {
  return !result.matched && result.reason === '无巡测单';
}

/** 找出某班次的下一个班次（罐满时走水排队到下一班） */
export function nextShift(shift: Shift, shifts: Shift[]): Shift | null {
  const sorted = [...shifts].sort((a, b) => a.date.localeCompare(b.date) || a.shiftType.localeCompare(b.shiftType));
  const index = sorted.findIndex((row) => row.id === shift.id);
  if (index < 0 || index >= sorted.length - 1) return null;
  return sorted[index + 1];
}
