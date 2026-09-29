export const taskTypes = ['执行', '复盘', '固定维护', '硬截止'] as const
export const taskStatuses = ['待处理', '完成', '已改期'] as const
export const strategies = ['推进', '观察', '低频维护', '暂停', '归档'] as const

export type TaskType = (typeof taskTypes)[number]
export type TaskStatus = (typeof taskStatuses)[number]

export type Site = {
  id: string
  name: string
  phase: string
  strategy: string
  current_goal: string
  last_decision: string
  next_action: string
  asset_links: string
  next_checkpoint: string | null
  strategy_condition: string | null
  strategy_condition_due_on: string | null
  archive_reason: string | null
  updated_at: string
  version: number
}

export type Task = {
  id: string
  site_id: string
  title: string
  type: TaskType
  due_on: string
  status: TaskStatus
  source: string
  capture_id: string | null
  version: number
}

export type Capture = {
  id: string
  text: string
  status: '待整理' | '已处理'
  created_at: string
  processed_at: string | null
  destination_log_id: string | null
  destination_task_id: string | null
  destination_opportunity_id: string | null
  version: number
}

export type Opportunity = {
  id: string
  problem: string
  evidence: string
  validation: string
  scope: string
  budget: string
  pass_condition: string
  stop_condition: string
  status: '想法' | '验证中' | '通过' | '停止'
  site_id: string | null
  capture_id: string | null
  version: number
}

export type Log = {
  id: string
  site_id: string
  text: string
  source_type: string
  source_url: string | null
  observed_through: string | null
  finalized_through: string | null
  collected_at: string
  confirmed: boolean
  capture_id: string | null
}

export type ReportDraft = {
  id: string
  siteId: string
  siteVersion: number
  rawText: string
  completed: string
  evidence: string
  openItems: string
  nextStep: string
  nextActionDate: string
  reviewDate: string
  sourceUrl: string
  observedThrough: string
  finalizedThrough: string
}

export type Report = {
  id: string
  site_id: string
  open_items: string
  confirmed_at: string | null
  source_url: string | null
}

export type TimelineDraft = {
  siteId: string
  siteVersion: number
  text: string
  sourceUrl: string
  nextAction: string
  nextActionDate: string
  observedThrough: string
  finalizedThrough: string
}
