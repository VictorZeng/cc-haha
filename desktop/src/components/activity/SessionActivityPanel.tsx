import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import type { ActivityRow, ActivitySectionId, SessionActivityModel } from './sessionActivityModel'
import { useTranslation } from '../../i18n'
import type { BackgroundAgentTask } from '../../types/chat'
import type { TeamMember } from '../../types/team'
import { formatTokenCount } from '../../lib/formatTokenCount'

export type OpenSubagentPayload = {
  sessionId: string
  toolUseId: string
  title: string
}

type SessionActivityPanelPlacement = 'overlay' | 'rail'

const SECTION_ORDER = ['tasks', 'team', 'backgroundTasks', 'subagents', 'sources'] as const

type TranslationFn = ReturnType<typeof useTranslation>

function fallbackStatusLabel(status: ActivityRow['status']): string {
  const label = String(status).replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!label) return ''
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function getActivityStatusLabel(status: ActivityRow['status'], t: TranslationFn): string {
  switch (status) {
    case 'pending':
      return t('session.activity.status.pending')
    case 'in_progress':
      return t('session.activity.status.inProgress')
    case 'completed':
      return t('session.activity.status.completed')
    case 'running':
      return t('session.activity.status.running')
    case 'failed':
      return t('session.activity.status.failed')
    case 'stopped':
      return t('session.activity.status.stopped')
    case 'idle':
      return t('session.activity.status.idle')
    case 'error':
      return t('session.activity.status.error')
    default:
      return fallbackStatusLabel(status)
  }
}

function getSectionTitle(sectionId: ActivitySectionId, t: TranslationFn): string {
  switch (sectionId) {
    case 'tasks':
      return t('session.activity.section.tasks')
    case 'team':
      return t('session.activity.section.team')
    case 'backgroundTasks':
      return t('session.activity.section.backgroundTasks')
    case 'subagents':
      return t('session.activity.section.subagents')
    case 'sources':
      return t('session.activity.section.sources')
    case 'output':
      return t('subagentRun.output')
  }
}

function getSectionEmptyLabel(sectionId: ActivitySectionId, t: TranslationFn): string {
  switch (sectionId) {
    case 'tasks':
      return t('session.activity.empty.tasks')
    case 'team':
      return t('session.activity.empty.team')
    case 'backgroundTasks':
      return t('session.activity.empty.backgroundTasks')
    case 'subagents':
      return t('session.activity.empty.subagents')
    case 'sources':
      return t('session.activity.empty.sources')
    case 'output':
      return ''
  }
}

function getSectionRowsClassName(sectionId: ActivitySectionId, rowCount: number): string {
  const base = 'space-y-0.5'
  if (rowCount === 0) return base

  switch (sectionId) {
    case 'tasks':
      return `${base} max-h-40 overflow-y-auto overscroll-contain pr-1`
    case 'team':
      return `${base} max-h-32 overflow-y-auto overscroll-contain pr-1`
    case 'backgroundTasks':
      return `${base} max-h-36 overflow-y-auto overscroll-contain pr-1`
    case 'subagents':
      return `${base} max-h-36 overflow-y-auto overscroll-contain pr-1`
    case 'sources':
      return `${base} max-h-24 overflow-y-auto overscroll-contain pr-1`
    case 'output':
      return `${base} max-h-24 overflow-y-auto overscroll-contain pr-1`
  }
}

function getTaskTypeLabel(taskType: BackgroundAgentTask['taskType'] | undefined, t: TranslationFn): string {
  if (taskType?.includes('agent')) return t('chat.backgroundTasks.type.agent')
  if (taskType === 'local_bash') return t('chat.backgroundTasks.type.bash')
  if (taskType === 'local_workflow') return t('chat.backgroundTasks.type.workflow')
  return t('chat.backgroundTasks.type.task')
}

function formatBackgroundDuration(ms: number | undefined, t: TranslationFn): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) return t('chat.duration.seconds', { seconds: totalSeconds })
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return t('chat.duration.minutesSeconds', { minutes, seconds })
}

function hasBackgroundTaskDetails(row: ActivityRow): boolean {
  return Boolean(
    row.description ||
      row.summary ||
      row.outputFile ||
      row.taskType ||
      row.workflowName ||
      row.usage?.totalTokens ||
      row.usage?.durationMs,
  )
}

function isActivityTriggerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-session-activity-trigger="true"]') !== null
}

function isBackgroundTaskStatus(status: ActivityRow['status']): status is BackgroundAgentTask['status'] {
  return status === 'running' || status === 'completed' || status === 'failed' || status === 'stopped'
}

function getFinishedBackgroundTaskKeys(model: SessionActivityModel): string[] {
  const keys = new Set<string>()

  for (const sectionId of ['backgroundTasks', 'subagents'] as const) {
    for (const row of model.sections[sectionId].rows) {
      if (row.dismissKey && isBackgroundTaskStatus(row.status) && row.status !== 'running') {
        keys.add(row.dismissKey)
      }
    }
  }

  return Array.from(keys)
}

function TaskStatusMarker({ status, t }: { status: ActivityRow['status']; t: TranslationFn }) {
  if (status === 'completed') {
    return (
      <span
        aria-label={t('session.activity.task.completed')}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--color-success)] bg-[var(--color-success)] text-white"
      >
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </span>
    )
  }

  if (status === 'in_progress' || status === 'running') {
    return (
      <span
        aria-label={t('session.activity.task.inProgress')}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--color-accent)] text-[var(--color-accent)]"
      >
        <LoaderCircle size={12} strokeWidth={2.4} aria-hidden="true" className="animate-spin" />
      </span>
    )
  }

  return (
    <span
      aria-label={t('session.activity.task.pending')}
      className="inline-flex h-4 w-4 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
    />
  )
}

function ActivityRowView({
  row,
  sessionId,
  onOpenSubagent,
  onOpenMember,
  onOpenBackgroundTask,
  selected,
}: {
  row: ActivityRow
  sessionId: string
  onOpenSubagent: (payload: OpenSubagentPayload) => void
  onOpenMember?: (member: TeamMember) => void
  onOpenBackgroundTask?: (row: ActivityRow) => void
  selected?: boolean
}) {
  const t = useTranslation()
  const isTask = row.section === 'tasks'
  const label = row.taskHistory
    ? t('session.activity.tasks.earlier')
    : row.label
  const detail = row.taskHistory
    ? t('session.activity.tasks.earlierSummary', {
      completed: row.taskHistory.completed,
      total: row.taskHistory.total,
      turns: row.taskHistory.turnCount,
    })
    : isTask && row.description && row.description !== row.label
      ? row.description
      : isTask && row.summary && row.summary !== row.label
        ? row.summary
        : undefined
  const content = (
    <>
      {isTask ? <TaskStatusMarker status={row.status} t={t} /> : null}
      <span className="min-w-0 flex-1 truncate text-left">
        <span
          className={`block truncate text-xs font-medium ${isTask && row.status === 'completed' ? 'text-[var(--color-text-tertiary)] line-through' : 'text-[var(--color-text-primary)]'}`}
          title={label}
        >
          {label}
        </span>
        {detail ? (
          <span
            className="block truncate text-[11px] text-[var(--color-text-tertiary)]"
            title={detail}
          >
            {detail}
          </span>
        ) : null}
      </span>
      {isTask ? null : (
        <span className="shrink-0 rounded bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
          {getActivityStatusLabel(row.status, t)}
        </span>
      )}
    </>
  )

  if (row.section === 'team' && row.member && onOpenMember) {
    return (
      <button
        type="button"
        aria-label={t('session.activity.openTeamMember', { name: row.label })}
        onClick={() => onOpenMember(row.member!)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
      >
        {content}
      </button>
    )
  }

  if (row.section === 'subagents' && row.openable && row.toolUseId) {
    return (
      <button
        type="button"
        aria-label={t('session.activity.openRun', { name: row.label })}
        onClick={() => onOpenSubagent({ sessionId, toolUseId: row.toolUseId!, title: row.label })}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
      >
        {content}
      </button>
    )
  }

  if (row.section === 'backgroundTasks' && onOpenBackgroundTask && hasBackgroundTaskDetails(row)) {
    return (
      <button
        type="button"
        aria-label={t('session.activity.openBackgroundTask', { name: row.label })}
        aria-expanded={selected}
        onClick={() => onOpenBackgroundTask(row)}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${selected ? 'bg-[var(--color-surface-container)]' : ''}`}
      >
        {content}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
      {content}
    </div>
  )
}

function BackgroundTaskDetail({ row }: { row: ActivityRow }) {
  const t = useTranslation()
  const duration = formatBackgroundDuration(row.usage?.durationMs, t)
  const usageParts = [
    typeof row.usage?.totalTokens === 'number'
      ? t('chat.backgroundAgents.tokens', { count: formatTokenCount(row.usage.totalTokens) })
      : '',
    duration,
  ].filter(Boolean)
  const details = [
    row.taskType || row.workflowName
      ? { label: t('session.activity.details.type'), value: getTaskTypeLabel(row.taskType, t) }
      : null,
    row.description
      ? { label: t('session.activity.details.description'), value: row.description }
      : null,
    row.summary
      ? { label: t('session.activity.details.summary'), value: row.summary }
      : null,
    row.outputFile
      ? { label: t('session.activity.details.outputFile'), value: row.outputFile }
      : null,
    usageParts.length > 0
      ? { label: t('session.activity.details.usage'), value: usageParts.join(' · ') }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item?.value))

  if (details.length === 0) return null

  return (
    <div className="mx-2 mb-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-2">
      <div className="mb-1 text-[11px] font-semibold text-[var(--color-text-tertiary)]">
        {t('session.activity.details.title')}
      </div>
      <dl className="space-y-1.5">
        {details.map((detail) => (
          <div key={detail.label} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-normal text-[var(--color-text-tertiary)]">
              {detail.label}
            </dt>
            <dd className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function SessionActivityPanel({
  model,
  open,
  onClose,
  onOpenSubagent,
  onClearFinishedBackgroundTasks,
  onOpenMember,
  placement = 'overlay',
}: {
  model: SessionActivityModel
  open: boolean
  onClose: () => void
  onOpenSubagent: (payload: OpenSubagentPayload) => void
  onClearFinishedBackgroundTasks?: (taskKeys: string[]) => void
  onOpenMember?: (member: TeamMember) => void
  placement?: SessionActivityPanelPlacement
}) {
  const t = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const [selectedBackgroundTaskId, setSelectedBackgroundTaskId] = useState<string | null>(null)
  const finishedBackgroundTaskKeys = useMemo(() => getFinishedBackgroundTaskKeys(model), [model])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  useEffect(() => {
    if (!open || placement === 'rail') return

    const handlePointerDown = (event: PointerEvent) => {
      if (isActivityTriggerTarget(event.target)) return
      if (panelRef.current?.contains(event.target as Node)) return
      onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [onClose, open, placement])

  useEffect(() => {
    if (!open) {
      setSelectedBackgroundTaskId(null)
      return
    }

    if (
      selectedBackgroundTaskId &&
      !model.sections.backgroundTasks.rows.some((row) => row.id === selectedBackgroundTaskId)
    ) {
      setSelectedBackgroundTaskId(null)
    }
  }, [model.sections.backgroundTasks.rows, open, selectedBackgroundTaskId])

  if (!open) return null
  const className = placement === 'rail'
    ? 'my-3 ml-2 mr-3 flex max-h-[min(480px,calc(100vh-88px))] w-[300px] shrink-0 self-start flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_18px_48px_-30px_rgba(15,23,42,0.42),0_8px_20px_-18px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,0.72)]'
    : 'absolute right-3 top-3 z-40 flex max-h-[calc(100%-96px)] w-[min(300px,calc(100%-24px))] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-dropdown)]'

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('session.activity.title')}
      data-testid="session-activity-panel"
      data-placement={placement}
      className={className}
    >
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <h2 className="text-xs font-semibold text-[var(--color-text-primary)]">{t('session.activity.title')}</h2>
        <button
          type="button"
          aria-label={t('session.activity.close')}
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          <X size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {SECTION_ORDER.map((sectionId) => {
          const section = model.sections[sectionId]
          const sectionTitle = getSectionTitle(section.id, t)
          const sectionEmptyLabel = getSectionEmptyLabel(section.id, t)

          return (
            <section key={section.id} aria-label={sectionTitle}>
              <div className="mb-1 flex items-center justify-between gap-2 px-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-normal text-[var(--color-text-tertiary)]">
                    {sectionTitle}
                  </h3>
                  {section.rows.length > 0 ? (
                    <span className="rounded bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-text-tertiary)]">
                      {section.rows.length}
                    </span>
                  ) : null}
                </div>
                {section.id === 'backgroundTasks' && finishedBackgroundTaskKeys.length > 0 && onClearFinishedBackgroundTasks ? (
                  <button
                    type="button"
                    onClick={() => onClearFinishedBackgroundTasks(finishedBackgroundTaskKeys)}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                  >
                    {t('session.activity.clearFinished')}
                  </button>
                ) : null}
              </div>
              {section.rows.length === 0 ? (
                <div className="px-2 py-1 text-xs text-[var(--color-text-tertiary)]">{sectionEmptyLabel}</div>
              ) : (
                <div className={getSectionRowsClassName(section.id, section.rows.length)}>
                  {section.rows.map((row) => (
                    <div key={row.id}>
                      <ActivityRowView
                        row={row}
                        sessionId={model.sessionId}
                        onOpenSubagent={onOpenSubagent}
                        onOpenMember={onOpenMember}
                        onOpenBackgroundTask={(backgroundRow) => {
                          setSelectedBackgroundTaskId((current) => (
                            current === backgroundRow.id ? null : backgroundRow.id
                          ))
                        }}
                        selected={section.id === 'backgroundTasks' && selectedBackgroundTaskId === row.id}
                      />
                      {section.id === 'backgroundTasks' && selectedBackgroundTaskId === row.id ? (
                        <BackgroundTaskDetail row={row} />
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
