/**
 * 成品卤罐（FinishedBrineTank）
 * 提锂车间管理的成品卤罐：容量满时走水排队到下一班，罐位空出来由本侧接着排。
 */

/** 卤罐状态：正常 / 满 / 空（由容量与当前液位派生） */
export type TankStatus = '正常' | '满' | '空'

export const TANK_STATUS_OPTIONS: TankStatus[] = ['正常', '满', '空']

export interface FinishedBrineTank {
  id: string
  /** 罐号 */
  code: string
  /** 容量（m³） */
  capacityM3: number
  /** 当前液位（m³） */
  currentLevelM3: number
  /** 状态（由容量与液位派生） */
  status: TankStatus
  /** 所属蒸发池（可空，表示共用罐） */
  pondId: string | null
  /** 备注 */
  note: string
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑成品卤罐的表单草稿 */
export interface TankDraft {
  code: string
  capacityM3: number
  currentLevelM3: number
  pondId: string | null
  note: string
}

/** 由容量与当前液位推导卤罐状态 */
export function tankStatusFromLevel(capacityM3: number, currentLevelM3: number): TankStatus {
  if (currentLevelM3 <= 0) return '空'
  if (currentLevelM3 >= capacityM3) return '满'
  return '正常'
}
