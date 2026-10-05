/**
 * 班次（Shift）
 * 巡测班与提锂车间共同按班次对账：每口池在某个班次内有巡测单与走水编排单。
 */

/** 班次类型：白班 / 夜班 */
export type ShiftType = '白班' | '夜班'

export const SHIFT_TYPE_OPTIONS: ShiftType[] = ['白班', '夜班']

export interface Shift {
  id: string
  /** 班次日期 YYYY-MM-DD */
  date: string
  /** 班次类型 */
  shiftType: ShiftType
  /** 带班负责人 */
  leader: string
  /** 备注 */
  note: string
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑班次的表单草稿 */
export interface ShiftDraft {
  date: string
  shiftType: ShiftType
  leader: string
  note: string
}

/** 班次展示标签，如「2026-09-28 白班」 */
export function shiftLabel(shift: Pick<Shift, 'date' | 'shiftType'>): string {
  return `${shift.date} ${shift.shiftType}`
}
