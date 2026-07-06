import { create } from 'zustand'
import { skillMarketApi } from '../api/skillMarket'
import type {
  SkillMarketDetail,
  SkillMarketItem,
  SkillMarketListResponse,
  SkillMarketListSource,
  SkillMarketSort,
  SkillMarketSource,
} from '../types/skillMarket'

type SkillMarketStore = {
  items: SkillMarketItem[]
  nextCursor: string | null
  selectedDetail: SkillMarketDetail | null
  detailCache: Record<string, SkillMarketDetail>
  source: SkillMarketListSource
  resolvedSource: SkillMarketSource | null
  sourceStatus: SkillMarketListResponse['sourceStatus'] | null
  statusMessage: string | null
  sort: SkillMarketSort
  query: string
  isLoading: boolean
  isLoadingMore: boolean
  isDetailLoading: boolean
  loadingDetailKey: string | null
  isInstalling: boolean
  error: string | null
  setSource: (source: SkillMarketListSource) => void
  setSort: (sort: SkillMarketSort) => void
  setQuery: (query: string) => void
  fetchItems: (options?: { query?: string }) => Promise<void>
  fetchMore: () => Promise<void>
  fetchDetail: (source: SkillMarketSource, slug: string, options?: { force?: boolean }) => Promise<void>
  prefetchDetail: (source: SkillMarketSource, slug: string) => Promise<void>
  installSelected: () => Promise<void>
  clearDetail: () => void
  clearDetailCache: () => void
}

let detailRequestSeq = 0
const detailInFlightRequests = new Map<string, Promise<SkillMarketDetail>>()
const MARKET_PAGE_LIMIT = 100
const DETAIL_CACHE_MAX_ENTRIES = 50

export function skillMarketDetailKey(source: SkillMarketSource, slug: string): string {
  return `${source}:${slug}`
}

export const useSkillMarketStore = create<SkillMarketStore>((set, get) => ({
  items: [],
  nextCursor: null,
  selectedDetail: null,
  detailCache: {},
  source: 'auto',
  resolvedSource: null,
  sourceStatus: null,
  statusMessage: null,
  sort: 'downloads',
  query: '',
  isLoading: false,
  isLoadingMore: false,
  isDetailLoading: false,
  loadingDetailKey: null,
  isInstalling: false,
  error: null,

  setSource: (source) => {
    detailRequestSeq += 1
    set({ source, selectedDetail: null, nextCursor: null, isDetailLoading: false, loadingDetailKey: null, statusMessage: null })
  },
  setSort: (sort) => {
    detailRequestSeq += 1
    set({ sort, selectedDetail: null, nextCursor: null, isDetailLoading: false, loadingDetailKey: null, statusMessage: null })
  },
  setQuery: (query) => set({ query }),

  fetchItems: async (options) => {
    const { source, sort, query } = get()
    const requestedQuery = options?.query ?? query
    detailRequestSeq += 1
    set({ isLoading: true, isLoadingMore: false, isDetailLoading: false, loadingDetailKey: null, selectedDetail: null, error: null })
    try {
      const result = await skillMarketApi.list({
        source,
        sort,
        q: requestedQuery.trim() || undefined,
        limit: MARKET_PAGE_LIMIT,
      })
      set({
        items: result.items,
        nextCursor: result.nextCursor,
        resolvedSource: result.source,
        sourceStatus: result.sourceStatus,
        statusMessage: result.message ?? null,
        isLoading: false,
      })
    } catch (err) {
      set({
        isLoading: false,
        nextCursor: null,
        error: getErrorMessage(err),
      })
    }
  },

  fetchMore: async () => {
    const { source, sort, query, nextCursor, isLoading, isLoadingMore } = get()
    if (!nextCursor || isLoading || isLoadingMore) return

    set({ isLoadingMore: true, error: null })
    try {
      const result = await skillMarketApi.list({
        source,
        sort,
        q: query.trim() || undefined,
        cursor: nextCursor,
        limit: MARKET_PAGE_LIMIT,
      })
      set((state) => ({
        items: mergeMarketItems(state.items, result.items),
        nextCursor: result.nextCursor,
        resolvedSource: result.source,
        sourceStatus: result.sourceStatus,
        statusMessage: result.message ?? state.statusMessage,
        isLoadingMore: false,
      }))
    } catch (err) {
      set({
        isLoadingMore: false,
        error: getErrorMessage(err),
      })
    }
  },

  fetchDetail: async (source, slug, options) => {
    const cacheKey = skillMarketDetailKey(source, slug)
    const requestId = detailRequestSeq + 1
    detailRequestSeq = requestId
    const cachedDetail = options?.force ? undefined : get().detailCache[cacheKey]
    if (cachedDetail) {
      set({
        selectedDetail: cachedDetail,
        isDetailLoading: false,
        loadingDetailKey: null,
        error: null,
      })
      return
    }

    set({ isDetailLoading: true, loadingDetailKey: cacheKey, selectedDetail: null, error: null })
    try {
      const detail = await loadDetail(source, slug, options)
      set((state) => ({
        detailCache: cacheDetail(state.detailCache, cacheKey, detail),
      }))
      if (requestId !== detailRequestSeq) return
      set({ selectedDetail: detail, isDetailLoading: false, loadingDetailKey: null })
    } catch (err) {
      if (requestId !== detailRequestSeq) return
      set({
        isDetailLoading: false,
        loadingDetailKey: null,
        error: getErrorMessage(err),
      })
    }
  },

  prefetchDetail: async (source, slug) => {
    const cacheKey = skillMarketDetailKey(source, slug)
    if (get().detailCache[cacheKey]) return

    try {
      const detail = await loadDetail(source, slug)
      set((state) => ({
        detailCache: cacheDetail(state.detailCache, cacheKey, detail),
      }))
    } catch {
      // Prefetch is opportunistic; the explicit detail open will report failures.
    }
  },

  installSelected: async () => {
    const detail = get().selectedDetail
    if (!detail) return

    set({ isInstalling: true, error: null })
    try {
      await skillMarketApi.install(detail.source, detail.slug, detail.version)
      await get().fetchItems()
      await get().fetchDetail(detail.source, detail.slug, { force: true })
      set({ isInstalling: false })
    } catch (err) {
      set({
        isInstalling: false,
        error: getErrorMessage(err),
      })
    }
  },

  clearDetail: () => {
    detailRequestSeq += 1
    set({ selectedDetail: null, isDetailLoading: false, loadingDetailKey: null })
  },

  clearDetailCache: () => {
    detailInFlightRequests.clear()
    set({ detailCache: {} })
  },
}))

function loadDetail(
  source: SkillMarketSource,
  slug: string,
  options?: { force?: boolean },
): Promise<SkillMarketDetail> {
  const cacheKey = skillMarketDetailKey(source, slug)
  if (!options?.force) {
    const pending = detailInFlightRequests.get(cacheKey)
    if (pending) return pending
  }

  const request = skillMarketApi.detail(source, slug)
    .then(({ detail }) => detail)
    .finally(() => {
      if (detailInFlightRequests.get(cacheKey) === request) {
        detailInFlightRequests.delete(cacheKey)
      }
    })

  detailInFlightRequests.set(cacheKey, request)
  return request
}

function cacheDetail(
  current: Record<string, SkillMarketDetail>,
  key: string,
  detail: SkillMarketDetail,
): Record<string, SkillMarketDetail> {
  const next = { ...current, [key]: detail }
  const keys = Object.keys(next)
  while (keys.length > DETAIL_CACHE_MAX_ENTRIES) {
    const oldestKey = keys.shift()
    if (oldestKey) {
      delete next[oldestKey]
    }
  }
  return next
}

function mergeMarketItems(current: SkillMarketItem[], incoming: SkillMarketItem[]): SkillMarketItem[] {
  const seen = new Set(current.map((item) => `${item.source}:${item.slug}`))
  const merged = [...current]
  for (const item of incoming) {
    const key = `${item.source}:${item.slug}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
