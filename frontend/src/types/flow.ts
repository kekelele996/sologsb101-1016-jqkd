/**
 * 走水编排单（FlowOrder）与成品卤罐（BrineTank）——提锂车间记账
 * 提锂车间排池系串级走向和走水编排单，并管着成品卤罐。
 * 与巡测班按「池号 + 班次」对账后才排；成品卤罐满时排队到下一班，罐位空出后由提锂车间本侧接着排。
 */
import type { ShiftName } from './shift';

/**
 * 编排单状态：
 * - 挂起：巡测单上还没到指标，先挂着不排
 * - 排队中：成品卤罐容量满，排队等到下一班
 * - 已排：对账通过、罐位充足，已排入本班走水
 * - 走水中：串级走水进行中
 * - 已入罐：走水完成，卤水进入成品卤罐
 */
export type FlowOrderState = '挂起' | '排队中' | '已排' | '走水中' | '已入罐';

export const FLOW_ORDER_STATE_OPTIONS: FlowOrderState[] = ['挂起', '排队中', '已排', '走水中', '已入罐'];

/** 状态推进顺序（挂起 / 排队中 是旁态，由对账与罐容逻辑自动切换） */
export const FLOW_ORDER_STATE_FLOW: FlowOrderState[] = ['已排', '走水中', '已入罐'];

export interface FlowOrder {
  id: string
  /** 走水源头蒸发池 */
  pondId: string
  /** 串级走向描述：沿闸门从上游到下游的池号链，如「北-01 → 北-02 → 北-03」 */
  cascadePath: string
  /** 计划走水日期 YYYY-MM-DD */
  planDate: string
  /** 班次 */
  shift: ShiftName
  /** 计划量（m³） */
  volumeM3: number
  /** 调度员 */
  operator: string
  /** 编排单状态 */
  state: FlowOrderState
  /** 排队原因：罐满排队到下一班时记录，罐位空出后清空 */
  queueReason: string
  /** 排队时原计划的日期/班次，便于追溯「排队到下一班」 */
  queuedFromDate: string
  queuedFromShift: ShiftName | ''
  /** 实际进入成品卤罐的量（m³），完成入罐时回写 */
  deliveredM3: number
  /** 越小越先走水 */
  orderIndex: number
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑走水编排单的表单草稿 */
export interface FlowOrderDraft {
  pondId: string
  planDate: string
  shift: ShiftName
  volumeM3: number
  operator: string
  state: FlowOrderState
  orderIndex: number
}

/** 成品卤罐：提锂车间侧单例台账（固定 id），记录容量与当前液位折算存量 */
export interface BrineTank {
  id: string
  /** 罐名 */
  name: string
  /** 总容量（m³） */
  capacityM3: number
  /** 当前存量（m³） */
  occupiedM3: number
  updatedAt: string
  revision: number
}
