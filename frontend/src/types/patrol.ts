/**
 * 巡测单（PatrolSheet）——巡测班记账
 * 巡测班在池边把每口池当班测到的密度、水位和风力逐池记成巡测单。
 * 同池同班次仅保留一条；是否到指标由 utils/handoff 的当班指标判定。
 */
import type { ShiftName } from './shift';

/** 当班指标状态：未到指标的池先挂着不排，到指标才可排入走水 */
export type PatrolStatus = '未到指标' | '到指标';

export const PATROL_STATUS_OPTIONS: PatrolStatus[] = ['未到指标', '到指标'];

export interface PatrolSheet {
  id: string
  /** 所属蒸发池 */
  pondId: string
  /** 巡测日期 YYYY-MM-DD */
  date: string
  /** 班次 */
  shift: ShiftName
  /** 当班密度（g/cm³） */
  densityGcm3: number
  /** 当班水位（cm） */
  levelCm: number
  /** 当班风力等级（0–8） */
  windLevel: number
  /** 记录人（巡测工） */
  recorder: string
  /** 备注 */
  note: string
  /** v3 升级迁移补齐：旧巡测数据原本没写班次，按池号补班次；补不上的单列 */
  shiftBackfilled: boolean
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑巡测单的表单草稿 */
export interface PatrolDraft {
  pondId: string
  date: string
  shift: ShiftName
  densityGcm3: number
  levelCm: number
  windLevel: number
  recorder: string
  note: string
}
