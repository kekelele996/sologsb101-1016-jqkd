/**
 * 班次（Shift）
 * 晒程一天分三班，巡测单与走水编排单都按「池号 + 班次」对账。
 */

/** 班次：白班 / 中班 / 夜班 */
export type ShiftName = '白班' | '中班' | '夜班';

export const SHIFT_OPTIONS: ShiftName[] = ['白班', '中班', '夜班'];

/** 班次序号，越小越早，用于排队到下一班 */
export const SHIFT_ORDER: Record<ShiftName, number> = {
  白班: 0,
  中班: 1,
  夜班: 2,
};

export function isShiftName(value: unknown): value is ShiftName {
  return value === '白班' || value === '中班' || value === '夜班';
}

/** 取当日下一班；夜班的下一班为空（跨日由人工选定日期 + 白班） */
export function nextShift(shift: ShiftName): ShiftName | null {
  if (shift === '白班') return '中班';
  if (shift === '中班') return '夜班';
  return null;
}
