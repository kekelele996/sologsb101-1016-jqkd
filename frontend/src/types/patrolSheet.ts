/**
 * 巡测单（PatrolSheet）
 * 巡测班在池边把每口池当班测到的密度、水位和风力记成巡测单；
 * 提锂车间排下一段走水时按池号和班次与之对账，还没到指标的池先挂着不排。
 */
export interface PatrolSheet {
  id: string
  /** 所属蒸发池 */
  pondId: string
  /** 所属班次 */
  shiftId: string
  /** 密度（g/cm³） */
  densityGcm3: number
  /** 水位（cm） */
  levelCm: number
  /** 风力等级（0–8） */
  windLevel: number
  /** 测量时间 YYYY-MM-DDTHH:mm */
  measuredAt: string
  /** 备注 */
  note: string
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑巡测单的表单草稿 */
export interface PatrolSheetDraft {
  pondId: string
  shiftId: string
  densityGcm3: number
  levelCm: number
  windLevel: number
  measuredAt: string
  note: string
}
