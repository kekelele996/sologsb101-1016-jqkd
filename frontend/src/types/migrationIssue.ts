/**
 * 升级补班次问题（MigrationIssue）
 * 旧数据没写班次，升级时按池号补上；对不上的单列到这里，供人工核对。
 */

/** 问题记录类型：观测 / 走水编排 */
export type MigrationIssueKind = 'observation' | 'schedule'

export interface MigrationIssue {
  id: string
  /** 记录类型 */
  kind: MigrationIssueKind
  /** 原记录 id */
  rowId: string
  /** 池号（用于人工核对） */
  pondCode: string
  /** 班次日期（原记录上的日期） */
  date: string
  /** 对不上的原因 */
  reason: string
  createdAt: string
}
