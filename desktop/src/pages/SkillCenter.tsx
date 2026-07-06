import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  ListFilter,
  Lock,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { SkillList } from '../components/skills/SkillList'
import { SkillDetail } from '../components/skills/SkillDetail'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { CodeViewer } from '../components/chat/CodeViewer'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { useTranslation } from '../i18n'
import { formatBytes } from '../lib/formatBytes'
import { useSessionStore } from '../stores/sessionStore'
import { skillMarketDetailKey, useSkillMarketStore } from '../stores/skillMarketStore'
import { useSkillStore } from '../stores/skillStore'
import type {
  SkillMarketDetail,
  SkillMarketFilePreview,
  SkillMarketInstallEligibility,
  SkillMarketItem,
  SkillMarketListSource,
  SkillMarketSort,
  SkillMarketSource,
  SkillMarketTrustState,
} from '../types/skillMarket'

type SkillCenterTab = 'marketplace' | 'mine'
type MarketFilter = 'all' | 'safe' | 'installed' | 'apiKey' | 'popular'
type TFunction = ReturnType<typeof useTranslation>

const SOURCE_OPTIONS: SkillMarketListSource[] = ['auto', 'clawhub', 'skillhub']
const SORT_OPTIONS: SkillMarketSort[] = ['downloads', 'installs', 'stars', 'updated', 'trending']
const FILTER_OPTIONS: MarketFilter[] = ['all', 'safe', 'popular', 'installed', 'apiKey']
const TRUST_SAFE: SkillMarketTrustState[] = ['clean', 'benign', 'signed', 'official']
const VISIBLE_DETAIL_PREFETCH_LIMIT = 3

export function SkillCenter() {
  const t = useTranslation()
  const selectedInstalledSkill = useSkillStore((s) => s.selectedSkill)
  const installedSkills = useSkillStore((s) => s.skills)
  const fetchInstalledSkillDetail = useSkillStore((s) => s.fetchSkillDetail)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined
  const [activeTab, setActiveTab] = useState<SkillCenterTab>(() =>
    selectedInstalledSkill ? 'mine' : 'marketplace'
  )
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all')
  const [pendingInstallDetail, setPendingInstallDetail] = useState<SkillMarketDetail | null>(null)
  const {
    items,
    nextCursor,
    selectedDetail,
    loadingDetailKey,
    source,
    resolvedSource,
    sourceStatus,
    statusMessage,
    sort,
    query,
    isLoading,
    isLoadingMore,
    isDetailLoading,
    isInstalling,
    error,
    setSource,
    setSort,
    setQuery,
    fetchItems,
    fetchMore,
    fetchDetail,
    prefetchDetail,
    installSelected,
    clearDetail,
  } = useSkillMarketStore()

  useEffect(() => {
    if (activeTab !== 'marketplace') return
    void fetchItems()
  }, [activeTab, fetchItems, source, sort])

  useEffect(() => {
    if (selectedInstalledSkill) {
      setActiveTab('mine')
    }
  }, [selectedInstalledSkill])

  const installedCount = useMemo(
    () => items.filter((item) => item.installed).length,
    [items],
  )
  const safeCount = useMemo(
    () => items.filter((item) => TRUST_SAFE.includes(item.trustState)).length,
    [items],
  )
  const filteredItems = useMemo(
    () => items.filter((item) => matchesMarketFilter(item, marketFilter)),
    [items, marketFilter],
  )
  const activeMarketDetailKey = selectedDetail
    ? skillMarketDetailKey(selectedDetail.source, selectedDetail.slug)
    : loadingDetailKey

  useEffect(() => {
    if (activeTab !== 'marketplace' || isLoading || filteredItems.length === 0) return

    for (const item of filteredItems.slice(0, VISIBLE_DETAIL_PREFETCH_LIMIT)) {
      void prefetchDetail(item.source, item.slug)
    }
  }, [activeTab, filteredItems, isLoading, prefetchDetail])

  const handleSearch = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    void fetchItems()
  }

  const handleClearSearch = () => {
    setQuery('')
    void fetchItems({ query: '' })
  }

  const handleOpenInstalled = (detail: SkillMarketDetail) => {
    const eligibility = detail.installEligibility
    const skillName = eligibility.status === 'installed'
      ? eligibility.installedSkillName
      : detail.slug
    setActiveTab('mine')
    void fetchInstalledSkillDetail('user', skillName, currentWorkDir, 'skills')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-surface-container-lowest)]">
      <header className="flex flex-none items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-7 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <h2 className="shrink-0 text-xl font-semibold tracking-normal text-[var(--color-text-primary)]">
            {t('skillCenter.title')}
          </h2>
          <div
            role="tablist"
            aria-label={t('skillCenter.title')}
            className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'marketplace'}
              className={tabClass(activeTab === 'marketplace')}
              onClick={() => setActiveTab('marketplace')}
              data-testid="skill-market-tab-button"
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>{t('skillCenter.tab.marketplace')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'mine'}
              className={tabClass(activeTab === 'mine')}
              onClick={() => setActiveTab('mine')}
              data-testid="skill-mine-tab-button"
            >
              <Package size={14} aria-hidden="true" />
              <span>{t('skillCenter.tab.mine')}</span>
              {installedSkills.length > 0 ? (
                <span
                  aria-hidden="true"
                  className="ml-1 rounded-md bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]"
                >
                  {installedSkills.length}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {activeTab === 'marketplace' ? (
          <button
            type="button"
            onClick={() => void fetchItems()}
            disabled={isLoading}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
            {t('skillCenter.marketplace.refresh')}
          </button>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-7 py-4">
        {activeTab === 'marketplace' ? (
          <section
            role="tabpanel"
            data-testid="skill-marketplace-tab"
            className="mx-auto flex min-h-full max-w-[1720px] min-w-0 flex-col gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {FILTER_OPTIONS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setMarketFilter(filter)}
                    className={marketFilterClass(marketFilter === filter)}
                  >
                    {t(`skillCenter.marketplace.filter.${filter}`)}
                  </button>
                ))}
              </div>

              <form
                onSubmit={handleSearch}
                className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2"
              >
                <div className="min-w-[260px] max-w-[420px] flex-1">
                  <label className="sr-only" htmlFor="skill-market-search">
                    {t('skillCenter.marketplace.searchLabel')}
                  </label>
                  <div className="relative">
                    <Search
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                      aria-hidden="true"
                    />
                    <input
                      id="skill-market-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t('skillCenter.marketplace.searchPlaceholder')}
                      className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-20 text-sm text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
                    />
                    {query ? (
                      <button
                        type="button"
                        aria-label={t('skillCenter.marketplace.clearSearch')}
                        onClick={handleClearSearch}
                        className="absolute right-11 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      aria-label={t('skillCenter.marketplace.runSearch')}
                      className="absolute right-1.5 top-1/2 flex h-7 w-8 -translate-y-1/2 items-center justify-center rounded-md bg-[var(--color-brand)] text-[var(--color-on-primary)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                    >
                      <Search size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <SourceSwitch
                  value={source}
                  onChange={(value) => setSource(value)}
                />
                <SelectField
                  label={t('skillCenter.marketplace.sortLabel')}
                  value={sort}
                  onChange={(value) => setSort(value as SkillMarketSort)}
                  options={SORT_OPTIONS.map((value) => ({
                    value,
                    label: t(`skillCenter.marketplace.sort.${value}`),
                  }))}
                  compact
                />
              </form>
            </div>

            <MarketplaceStatusLine
              t={t}
              source={source}
              resolvedSource={resolvedSource}
              sourceStatus={sourceStatus}
              statusMessage={statusMessage}
              total={items.length}
              safeCount={safeCount}
              installedCount={installedCount}
              loading={isLoading}
            />

            {error ? (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning-container)] px-3 py-2 text-sm text-[var(--color-warning)]">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="font-medium">{t('skillCenter.marketplace.errorTitle')}</div>
                  <div className="mt-0.5 break-words text-xs leading-5">
                    {formatMarketError(t, error)}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="min-h-0">
              <div className="min-w-0">
                {isLoading ? (
                  <MarketplaceSkeletonGrid />
                ) : items.length === 0 ? (
                  <EmptyState
                    icon={<Search size={22} aria-hidden="true" />}
                    label={t('skillCenter.marketplace.empty')}
                    hint={t('skillCenter.marketplace.emptyHint')}
                  />
                ) : filteredItems.length === 0 ? (
                  <EmptyState
                    icon={<ListFilter size={22} aria-hidden="true" />}
                    label={t('skillCenter.marketplace.filterEmpty')}
                    hint={t('skillCenter.marketplace.filterEmptyHint')}
                  />
                ) : (
                  <>
                    <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                      {filteredItems.map((item) => (
                        <SkillMarketCard
                          key={`${item.source}-${item.slug}`}
                          item={item}
                          active={activeMarketDetailKey === skillMarketDetailKey(item.source, item.slug)}
                          onSelect={() => void fetchDetail(item.source, item.slug)}
                          onPrefetch={() => void prefetchDetail(item.source, item.slug)}
                        />
                      ))}
                    </div>
                    {nextCursor ? (
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          onClick={() => void fetchMore()}
                          disabled={isLoadingMore}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RefreshCw size={14} className={isLoadingMore ? 'animate-spin' : ''} aria-hidden="true" />
                          {isLoadingMore
                            ? t('skillCenter.marketplace.loadingMore')
                            : t('skillCenter.marketplace.loadMore')}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            {selectedDetail || isDetailLoading ? (
              <SkillMarketDetailPanel
                detail={selectedDetail}
                loading={isDetailLoading}
                installing={isInstalling}
                onInstall={() => selectedDetail && setPendingInstallDetail(selectedDetail)}
                onOpenInstalled={handleOpenInstalled}
                onClose={clearDetail}
              />
            ) : null}
            <ConfirmDialog
              open={!!pendingInstallDetail}
              onClose={() => setPendingInstallDetail(null)}
              title={t('skillCenter.marketplace.confirmTitle')}
              body={pendingInstallDetail ? <InstallConfirmBody detail={pendingInstallDetail} /> : null}
              confirmLabel={t('skillCenter.marketplace.confirmInstall')}
              cancelLabel={t('common.cancel')}
              confirmVariant="primary"
              loading={isInstalling}
              onConfirm={async () => {
                await installSelected()
                setPendingInstallDetail(null)
              }}
            />
          </section>
        ) : (
          <section
            role="tabpanel"
            data-testid="skill-mine-tab"
            className="mx-auto flex min-h-full max-w-[1680px] min-w-0 flex-col gap-4"
          >
            <InstalledLibraryHeader
              t={t}
              selected={!!selectedInstalledSkill}
              installedCount={installedSkills.length}
            />
            {selectedInstalledSkill ? <SkillDetail /> : <SkillList />}
          </section>
        )}
      </main>
    </div>
  )
}

function MarketplaceStatusLine({
  t,
  source,
  resolvedSource,
  sourceStatus,
  statusMessage,
  total,
  safeCount,
  installedCount,
  loading,
}: {
  t: TFunction
  source: SkillMarketListSource
  resolvedSource: SkillMarketSource | null
  sourceStatus: 'ok' | 'fallback' | 'cached' | null
  statusMessage: string | null
  total: number
  safeCount: number
  installedCount: number
  loading: boolean
}) {
  const sourceName = resolvedSource
    ? t(`skillCenter.marketplace.source.${resolvedSource}`)
    : t(`skillCenter.marketplace.source.${source}`)
  const statusLabel = sourceStatus
    ? t(`skillCenter.marketplace.sourceStatus.${sourceStatus}`)
    : t('skillCenter.marketplace.sourceStatus.pending')

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-[var(--color-text-tertiary)]">
      <span className="inline-flex items-center gap-1.5 font-medium text-[var(--color-text-secondary)]">
        <Globe2 size={13} aria-hidden="true" />
        {sourceName}
        <span className="text-[var(--color-text-tertiary)]">{statusLabel}</span>
      </span>
      <StatusDot label={t('skillCenter.marketplace.status.loaded', { count: String(total) })} />
      <StatusDot label={t('skillCenter.marketplace.status.safe', { safe: String(safeCount), total: String(total) })} />
      <StatusDot label={t('skillCenter.marketplace.status.installed', { count: String(installedCount) })} />
      {loading ? (
        <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
          {t('skillCenter.marketplace.loading')}
        </span>
      ) : null}
      {statusMessage ? (
        <span className="min-w-0 truncate text-[var(--color-text-tertiary)]">{statusMessage}</span>
      ) : (
        <span className="min-w-0 truncate text-[var(--color-text-tertiary)]">
          {t('skillCenter.marketplace.sourcePolicy')} · {t('skillCenter.marketplace.safetyPolicy')}
        </span>
      )}
    </div>
  )
}

function StatusDot({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1 w-1 rounded-full bg-[var(--color-border-strong)]" aria-hidden="true" />
      {label}
    </span>
  )
}

function StateBadge({
  tone,
  icon,
  label,
}: {
  tone: 'neutral' | 'info' | 'success' | 'warning'
  icon: ReactNode
  label: string
}) {
  const className = tone === 'success'
    ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    : tone === 'warning'
      ? 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
      : tone === 'info'
        ? 'bg-[var(--color-info-container)] text-[var(--color-info)]'
        : 'border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]'

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${className}`}>
      {icon}
      {label}
    </span>
  )
}

function SourceSwitch({
  value,
  onChange,
}: {
  value: SkillMarketListSource
  onChange: (value: SkillMarketListSource) => void
}) {
  const t = useTranslation()

  return (
    <div
      aria-label={t('skillCenter.marketplace.sourceLabel')}
      className="inline-flex h-9 shrink-0 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
    >
      {SOURCE_OPTIONS.map((sourceOption) => (
        <button
          key={sourceOption}
          type="button"
          aria-pressed={value === sourceOption}
          onClick={() => onChange(sourceOption)}
          className={[
            'h-7 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
            value === sourceOption
              ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] shadow-sm'
              : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
          ].join(' ')}
        >
          {t(`skillCenter.marketplace.source.${sourceOption}`)}
        </button>
      ))}
    </div>
  )
}

function InstalledLibraryHeader({
  t,
  selected,
  installedCount,
}: {
  t: TFunction
  selected: boolean
  installedCount: number
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-primary-fixed)] text-[var(--color-brand)]">
          <Package size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">
            {selected ? t('skillCenter.mine.detailTitle') : t('skillCenter.mine.libraryTitle')}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
            {t('skillCenter.mine.libraryMeta', { count: String(installedCount) })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-tertiary)]">
        <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2 py-1">
          {t('skillCenter.mine.localDirectory')}
        </span>
        <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2 py-1">
          {t('skillCenter.mine.sources')}
        </span>
      </div>
    </section>
  )
}

function InstallConfirmBody({ detail }: { detail: SkillMarketDetail }) {
  const t = useTranslation()
  const target = `~/.claude/skills/${detail.slug}`
  const riskLabel = detail.riskLabels.length > 0
    ? detail.riskLabels.map((label) => t(`skillCenter.marketplace.risk.${label}`)).join(', ')
    : t('skillCenter.marketplace.noRiskLabels')

  return (
    <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
      <p className="leading-6">{t('skillCenter.marketplace.confirmBody')}</p>
      <dl className="grid gap-2 rounded-md bg-[var(--color-surface-container-low)] p-3 text-xs">
        <ConfirmRow label={t('skillCenter.marketplace.confirmSkill')} value={detail.displayName} />
        <ConfirmRow label={t('skillCenter.marketplace.sourceLabel')} value={t(`skillCenter.marketplace.source.${detail.source}`)} />
        <ConfirmRow label={t('skillCenter.marketplace.confirmTarget')} value={target} />
        <ConfirmRow label={t('skillCenter.marketplace.riskLabels')} value={riskLabel} />
      </dl>
    </div>
  )
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="break-all text-[var(--color-text-primary)]">{value}</dd>
    </div>
  )
}

function SkillMarketCard({
  item,
  active,
  onSelect,
  onPrefetch,
}: {
  item: SkillMarketItem
  active: boolean
  onSelect: () => void
  onPrefetch: () => void
}) {
  const t = useTranslation()
  const stats = formatStats(item, t)
  const sourceLabel = t(`skillCenter.marketplace.source.${item.source}`)
  const summary = item.summaryZh || item.summary

  return (
    <button
      type="button"
      aria-label={item.displayName}
      onClick={onSelect}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      className={[
        'group flex min-h-[124px] flex-col rounded-lg border bg-[var(--color-surface)] p-3 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out active:translate-y-px',
        'hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
        active ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-selected)] shadow-sm' : 'border-[var(--color-border)]',
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <span className={sourceIconClass(item.source, item.trustState)}>
          {item.source === 'clawhub' ? <Globe2 size={14} aria-hidden="true" /> : <Package size={14} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                {item.displayName}
              </h3>
              {item.owner || item.category ? (
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                  {item.owner ? <span className="truncate">@{item.owner}</span> : null}
                  {item.category ? <span className="truncate">{item.category}</span> : null}
                </div>
              ) : null}
            </div>
            <ChevronRight
              size={16}
              className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)] opacity-50 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-[var(--color-text-secondary)]">
        {summary}
      </p>

      <div className="mt-2 flex min-h-7 flex-wrap gap-1.5">
        <TrustBadge state={item.trustState} />
        {item.installed ? (
          <StateBadge
            tone="info"
            icon={<Check size={12} aria-hidden="true" />}
            label={t('skillCenter.marketplace.installedBadge')}
          />
        ) : null}
        <StateBadge
          tone="neutral"
          icon={<FileText size={12} aria-hidden="true" />}
          label={t('skillCenter.marketplace.detailsBadge')}
        />
        {item.requiresApiKey ? (
          <StateBadge
            tone="neutral"
            icon={<Lock size={12} aria-hidden="true" />}
            label={t('skillCenter.marketplace.requiresApiKey')}
          />
        ) : null}
      </div>

      <div className="mt-auto flex min-w-0 items-center justify-between gap-3 pt-2 text-xs text-[var(--color-text-tertiary)]">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          <BadgeCheck size={13} aria-hidden="true" />
          <span className="truncate">{sourceLabel}</span>
        </span>
        {stats ? <span className="shrink-0">{stats}</span> : null}
      </div>
    </button>
  )
}

function SkillMarketDetailPanel({
  detail,
  loading,
  installing,
  onInstall,
  onOpenInstalled,
  onClose,
}: {
  detail: SkillMarketDetail | null
  loading: boolean
  installing: boolean
  onInstall: () => void
  onOpenInstalled: (detail: SkillMarketDetail) => void
  onClose: () => void
}) {
  const t = useTranslation()

  if (loading && !detail) {
    return createPortal(
      <div data-testid="skill-market-detail-layer" className="fixed inset-0 z-50">
        <button
          type="button"
          aria-label={t('skillCenter.marketplace.closeDetail')}
          onClick={onClose}
          className="skill-market-detail-scrim absolute inset-0 cursor-default border-0 p-0"
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t('skillCenter.marketplace.selectionTitle')}
          className="absolute right-0 top-0 flex h-full w-[min(520px,calc(100vw-24px))] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-dropdown)]"
        >
          <DetailDrawerSkeleton />
        </aside>
      </div>,
      document.body,
    )
  }

  if (!detail) {
    return createPortal(
      <div data-testid="skill-market-detail-layer" className="fixed inset-0 z-50">
        <button
          type="button"
          aria-label={t('skillCenter.marketplace.closeDetail')}
          onClick={onClose}
          className="skill-market-detail-scrim absolute inset-0 cursor-default border-0 p-0"
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t('skillCenter.marketplace.selectionTitle')}
          className="absolute right-0 top-0 flex h-full w-[min(520px,calc(100vw-24px))] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-dropdown)]"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
            <ShieldCheck size={17} aria-hidden="true" />
            {t('skillCenter.marketplace.selectionTitle')}
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            {t('skillCenter.marketplace.noSelection')}
          </p>
          <div className="mt-4 grid gap-2">
            <DecisionHint
              icon={<Globe2 size={15} aria-hidden="true" />}
              title={t('skillCenter.marketplace.hint.sourceTitle')}
              body={t('skillCenter.marketplace.hint.sourceBody')}
            />
            <DecisionHint
              icon={<ShieldCheck size={15} aria-hidden="true" />}
              title={t('skillCenter.marketplace.hint.safetyTitle')}
              body={t('skillCenter.marketplace.hint.safetyBody')}
            />
            <DecisionHint
              icon={<FileText size={15} aria-hidden="true" />}
              title={t('skillCenter.marketplace.hint.previewTitle')}
              body={t('skillCenter.marketplace.hint.previewBody')}
            />
          </div>
        </aside>
      </div>,
      document.body,
    )
  }

  const eligibility = detail.installEligibility
  const installable = eligibility.status === 'installable'
  const canOpenInstalled = eligibility.status === 'installed'
  const summary = detail.summaryZh || detail.summary

  return createPortal(
    <div data-testid="skill-market-detail-layer" className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t('skillCenter.marketplace.closeDetail')}
        onClick={onClose}
        className="skill-market-detail-scrim absolute inset-0 cursor-default border-0 p-0"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={detail.displayName}
        className="absolute right-0 top-0 flex h-full w-[min(520px,calc(100vw-24px))] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-dropdown)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <TrustBadge state={detail.trustState} />
              <EligibilityBadge eligibility={eligibility} />
            </div>
            <h3 className="line-clamp-2 text-lg font-semibold leading-6 text-[var(--color-text-primary)]">
              {detail.displayName}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
              <span>{t(`skillCenter.marketplace.source.${detail.source}`)}</span>
              {detail.owner ? <span>@{detail.owner}</span> : null}
              {detail.version ? <span>{detail.version}</span> : null}
            </div>
          </div>
          <button
            type="button"
            aria-label={t('skillCenter.marketplace.closeDetail')}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div
          aria-labelledby="skill-market-detail-decision-title"
          className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-5"
        >
          <h4 id="skill-market-detail-decision-title" className="sr-only">
            {t('skillCenter.marketplace.drawer.decision')}
          </h4>
          <button
            type="button"
            onClick={() => (canOpenInstalled ? onOpenInstalled(detail) : onInstall())}
            disabled={(!installable && !canOpenInstalled) || installing}
            className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-container-high)] disabled:text-[var(--color-text-tertiary)] ${
              canOpenInstalled
                ? 'border border-[var(--color-success)]/25 bg-[var(--color-success-container)] text-[var(--color-success)] hover:border-[var(--color-success)]/35 hover:bg-[var(--color-success-container)]'
                : 'bg-[var(--color-brand)] text-[var(--color-on-primary)] hover:bg-[var(--color-brand-hover)]'
            }`}
          >
            {canOpenInstalled ? <Check size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {installing
              ? t('skillCenter.marketplace.installing')
              : canOpenInstalled
                ? t('skillCenter.marketplace.viewInstalled')
                : installLabel(t, eligibility)}
          </button>
          {eligibility.status === 'blocked' || eligibility.status === 'conflict' ? (
            <div className="mt-3 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning-container)] px-3 py-2 text-xs leading-5 text-[var(--color-warning)]">
              {eligibilityMessage(t, eligibility)}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <DrawerSection title={t('skillCenter.marketplace.drawer.summary')}>
            <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
              {summary}
            </p>
          </DrawerSection>

          <DrawerSection title={t('skillCenter.marketplace.drawer.safety')}>
            <div className="space-y-3">
              {detail.trustSummary ? (
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                  {detail.trustSummary}
                </div>
              ) : null}

              {detail.riskLabels.length > 0 ? (
                <div>
                  <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
                    {t('skillCenter.marketplace.riskLabels')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.riskLabels.map((label) => (
                      <span
                        key={label}
                        className="rounded-md bg-[var(--color-warning-container)] px-2 py-1 text-xs text-[var(--color-warning)]"
                      >
                        {t(`skillCenter.marketplace.risk.${label}`)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md bg-[var(--color-success-container)] px-3 py-2 text-xs text-[var(--color-success)]">
                  <ShieldCheck size={14} aria-hidden="true" />
                  {t('skillCenter.marketplace.noRiskLabels')}
                </div>
              )}

              {detail.requiresApiKey ? (
                <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                  <Lock size={14} aria-hidden="true" />
                  {t('skillCenter.marketplace.requiresApiKey')}
                </div>
              ) : null}
            </div>
          </DrawerSection>

          <DrawerSection title={t('skillCenter.marketplace.filePreview')}>
            <FilePreviewSection detail={detail} />
          </DrawerSection>

          <DrawerSection title={t('skillCenter.marketplace.drawer.metadata')}>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <MetaItem icon={<FileText size={13} aria-hidden="true" />} label={t('skillCenter.marketplace.files')} value={String(detail.files.length)} />
              <MetaItem icon={<Download size={13} aria-hidden="true" />} label={t('skillCenter.marketplace.downloads')} value={formatNumber(detail.downloads)} />
              <MetaItem icon={<Star size={13} aria-hidden="true" />} label={t('skillCenter.marketplace.stars')} value={formatNumber(detail.stars)} />
              <MetaItem icon={<Clock3 size={13} aria-hidden="true" />} label={t('skillCenter.marketplace.license')} value={detail.license || '-'} />
            </dl>
          </DrawerSection>

          <DrawerSection title={t('skillCenter.marketplace.drawer.links')}>
            <div className="flex flex-wrap gap-3 text-xs">
              <a
                href={detail.canonicalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[var(--color-brand)] hover:underline"
              >
                {t('skillCenter.marketplace.openSource')}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
              {detail.upstreamUrl ? (
                <a
                  href={detail.upstreamUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--color-brand)] hover:underline"
                >
                  {t('skillCenter.marketplace.openUpstream')}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </DrawerSection>
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function FilePreviewSection({ detail }: { detail: SkillMarketDetail }) {
  const t = useTranslation()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const previews = detail.filePreviews?.length
    ? detail.filePreviews
    : detail.entryPreview
      ? [{
          path: 'SKILL.md',
          content: detail.entryPreview,
          language: 'markdown',
        }]
      : []
  const activePreview = previews.find((preview) => preview.path === selectedPath) ?? previews[0]

  if (previews.length === 0) {
    if (!detail.previewUnavailableReason) {
      return null
    }
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)]">
          <FileText size={13} aria-hidden="true" />
          {t('skillCenter.marketplace.previewUnavailable')}
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
          {formatPreviewUnavailable(t, detail.previewUnavailableReason)}
        </p>
      </div>
    )
  }

  if (!activePreview) {
    return null
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
      <div className="flex min-h-10 gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-1.5">
        {previews.map((preview) => {
          const active = preview.path === activePreview.path
          return (
            <button
              key={preview.path}
              type="button"
              onClick={() => setSelectedPath(preview.path)}
              className={[
                'max-w-[220px] shrink-0 truncate rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
                active
                  ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
              ].join(' ')}
            >
              {preview.path}
            </button>
          )
        })}
      </div>
      <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text-primary)]">
          {activePreview.path}
        </span>
        {activePreview.language ? (
          <span className="shrink-0 rounded bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">
            {normalizePreviewLanguage(activePreview.language)}
          </span>
        ) : null}
        {typeof activePreview.size === 'number' ? (
          <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
            {formatBytes(activePreview.size)}
          </span>
        ) : null}
        {activePreview.truncated ? (
          <span className="shrink-0 rounded bg-[var(--color-warning-container)] px-1.5 py-0.5 text-[11px] text-[var(--color-warning)]">
            {t('skillCenter.marketplace.previewTruncated')}
          </span>
        ) : null}
      </div>
      <div className="max-h-[460px] overflow-auto bg-[var(--color-surface-container-lowest)]">
        {isMarkdownPreview(activePreview) ? (
          <MarkdownRenderer
            content={activePreview.content}
            variant="compact"
            className="max-w-none px-4 py-3"
          />
        ) : (
          <div className="p-3">
            <CodeViewer
              code={activePreview.content}
              language={normalizePreviewLanguage(activePreview.language)}
              maxLines={9999}
              showLineNumbers
              wrapLongLines
            />
          </div>
        )}
      </div>
    </div>
  )
}

function isMarkdownPreview(preview: SkillMarketFilePreview): boolean {
  const language = normalizePreviewLanguage(preview.language)
  const path = preview.path.toLowerCase()
  return language === 'markdown' || path.endsWith('.md') || path.endsWith('.mdx')
}

function normalizePreviewLanguage(language: string | undefined): string | undefined {
  if (language === 'shell') return 'bash'
  return language
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--color-border)] pt-4 first:border-t-0 first:pt-0">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-normal text-[var(--color-text-tertiary)]">
        {title}
      </h4>
      {children}
    </section>
  )
}

function DecisionHint({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-primary)]">
        <span className="text-[var(--color-text-secondary)]">{icon}</span>
        {title}
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{body}</p>
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  compact?: boolean
}) {
  return (
    <label className={compact ? 'min-w-[132px]' : 'min-w-0'}>
      <span className={compact ? 'sr-only' : 'mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]'}>
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={compact ? label : undefined}
        className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-md bg-[var(--color-surface-container-low)] px-3 py-2">
      <dt className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 truncate text-[var(--color-text-primary)]">{value}</dd>
    </div>
  )
}

function TrustBadge({ state }: { state: SkillMarketTrustState }) {
  const t = useTranslation()
  const safe = TRUST_SAFE.includes(state)
  const blocked = state === 'blocked' || state === 'unknown'
  const className = safe
    ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    : blocked
      ? 'bg-[var(--color-error-container)] text-[var(--color-error)]'
      : 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
  const Icon = safe ? ShieldCheck : AlertTriangle

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${className}`}>
      <Icon size={12} aria-hidden="true" />
      {t(`skillCenter.marketplace.trust.${state}`)}
    </span>
  )
}

function EligibilityBadge({ eligibility }: { eligibility: SkillMarketInstallEligibility }) {
  const t = useTranslation()
  const status = eligibility.status
  const className = status === 'installable'
    ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    : status === 'installed'
      ? 'bg-[var(--color-info-container)] text-[var(--color-info)]'
      : 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${className}`}>
      {status === 'installable' ? <Download size={12} aria-hidden="true" /> : <Lock size={12} aria-hidden="true" />}
      {installLabel(t, eligibility)}
    </span>
  )
}

function MarketplaceSkeletonGrid() {
  const t = useTranslation()

  return (
    <div
      data-testid="skill-marketplace-loading"
      role="status"
      aria-busy="true"
      aria-label={t('skillCenter.marketplace.loadingCard')}
      className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
    >
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          data-testid="skill-card-skeleton"
          className="min-h-[124px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
        >
          <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
          <div className="mt-3 h-3 w-full animate-pulse rounded bg-[var(--color-surface-container-high)]" />
          <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
          <div className="mt-4 flex gap-2">
            <div className="h-5 w-16 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
            <div className="h-5 w-20 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
          </div>
        </div>
      ))}
    </div>
  )
}

function DetailDrawerSkeleton() {
  const t = useTranslation()

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('skillCenter.marketplace.loadingDetail')}
      className="flex h-full flex-col"
    >
      <span className="sr-only">{t('skillCenter.marketplace.loadingDetail')}</span>
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <div className="h-5 w-28 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
        <div className="mt-3 h-6 w-2/3 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
      </div>
      <div className="border-b border-[var(--color-border)] p-5">
        <div className="h-10 w-full animate-pulse rounded bg-[var(--color-surface-container-high)]" />
        <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
      </div>
      <div className="space-y-3 p-5">
        <div className="h-4 w-full animate-pulse rounded bg-[var(--color-surface-container-high)]" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
        <div className="h-40 w-full animate-pulse rounded bg-[var(--color-surface-container-high)]" />
      </div>
    </div>
  )
}

function EmptyState({
  icon,
  label,
  hint,
}: {
  icon: ReactNode
  label: string
  hint: string
}) {
  return (
    <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]">
          {icon}
        </div>
        <p className="mt-3 text-sm font-medium text-[var(--color-text-secondary)]">
          {label}
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
          {hint}
        </p>
      </div>
    </div>
  )
}

function tabClass(active: boolean) {
  return [
    'inline-flex min-w-[6rem] items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
    active
      ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
  ].join(' ')
}

function marketFilterClass(active: boolean) {
  return [
    'h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
    active
      ? 'bg-[var(--color-text-primary)] text-[var(--color-surface)]'
      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
  ].join(' ')
}

function sourceIconClass(source: SkillMarketSource, trustState: SkillMarketTrustState) {
  const safe = TRUST_SAFE.includes(trustState)
  return [
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
    safe
      ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
      : source === 'clawhub'
      ? 'bg-[var(--color-primary-fixed)] text-[var(--color-brand)]'
      : 'bg-[var(--color-info-container)] text-[var(--color-info)]',
  ].join(' ')
}

function matchesMarketFilter(item: SkillMarketItem, filter: MarketFilter) {
  if (filter === 'safe') return TRUST_SAFE.includes(item.trustState)
  if (filter === 'installed') return item.installed
  if (filter === 'apiKey') return !!item.requiresApiKey
  if (filter === 'popular') {
    return (item.downloads ?? item.installs ?? item.stars ?? 0) >= 1000
  }
  return true
}

function formatStats(item: SkillMarketItem, t: TFunction): string {
  if (typeof item.downloads === 'number') {
    return t('skillCenter.marketplace.cardMeta.downloads', { count: formatNumber(item.downloads) })
  }
  if (typeof item.installs === 'number') {
    return `${compactNumber(item.installs)} ${t('skillCenter.marketplace.sort.installs')}`
  }
  if (typeof item.stars === 'number') {
    return t('skillCenter.marketplace.cardMeta.stars', { count: formatNumber(item.stars) })
  }
  return ''
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat().format(value)
}

function compactNumber(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatMarketError(t: TFunction, error: string): string {
  if (/failed to fetch/i.test(error) || /network/i.test(error)) {
    return t('skillCenter.marketplace.networkError')
  }
  return error
}

function formatPreviewUnavailable(t: TFunction, reason: string): string {
  if (/SkillHub does not expose/i.test(reason)) {
    return t('skillCenter.marketplace.previewUnavailable.skillhub')
  }
  if (/file list/i.test(reason)) {
    return t('skillCenter.marketplace.previewUnavailable.fileList')
  }
  if (/package metadata|full detail/i.test(reason)) {
    return t('skillCenter.marketplace.previewUnavailable.metadata')
  }
  if (/No small text files/i.test(reason)) {
    return t('skillCenter.marketplace.previewUnavailable.noText')
  }
  return reason
}

function installLabel(
  t: TFunction,
  eligibility: SkillMarketInstallEligibility,
): string {
  if (eligibility.status === 'installable') return t('skillCenter.marketplace.install')
  if (eligibility.status === 'installed') return t('skillCenter.marketplace.installedAction')
  if (eligibility.status === 'conflict') return t('skillCenter.marketplace.conflictAction')
  return t('skillCenter.marketplace.blockedAction')
}

function eligibilityMessage(
  t: TFunction,
  eligibility: SkillMarketInstallEligibility,
): string {
  if (eligibility.status === 'conflict') {
    return t('skillCenter.marketplace.conflictReason', { path: eligibility.targetPath })
  }
  if (eligibility.status === 'blocked') {
    if (eligibility.reason === 'Full package safety scan is required before install.') {
      return t('skillCenter.marketplace.blockedReason.scanRequired')
    }
    return eligibility.reason
  }
  return ''
}
