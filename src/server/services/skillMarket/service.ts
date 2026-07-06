import { normalizeClawHubDetail, normalizeClawHubList, normalizeClawHubVersionFiles } from './clawhubAdapter.js'
import { analyzeSkillRisk } from './risk.js'
import { normalizeSkillHubList } from './skillhubAdapter.js'
import type {
  SkillMarketDetail,
  SkillMarketFile,
  SkillMarketFilePreview,
  SkillMarketItem,
  SkillMarketListResult,
  SkillMarketSource,
} from './types.js'

export type SkillMarketListSource = 'auto' | 'clawhub' | 'skillhub'

export type SkillMarketListParams = {
  source?: SkillMarketListSource
  limit?: number
  query?: string
  cursor?: string
  sort?: 'downloads' | 'installs' | 'stars' | 'updated' | 'trending'
}

export type SkillMarketDetailParams = {
  source: SkillMarketSource
  slug: string
}

type FetchImpl = typeof fetch
type InstalledSkillNamesProvider = Set<string> | (() => Set<string> | Promise<Set<string>>)

export type SkillMarketServiceOptions = {
  fetchImpl?: FetchImpl
  installedSkillNames?: InstalledSkillNamesProvider
  now?: () => number
}

export type SkillMarketService = {
  listSkills: (params?: SkillMarketListParams) => Promise<SkillMarketListResult>
  list: (params?: SkillMarketListParams) => Promise<SkillMarketListResult>
  getDetail: (params: SkillMarketDetailParams) => Promise<SkillMarketDetail | null>
}

const CLAWHUB_SKILLS_URL = 'https://clawhub.ai/api/v1/skills'
const SKILLHUB_SKILLS_URL = 'https://api.skillhub.cn/api/skills'
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 100
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1_000
const DETAIL_CACHE_TTL_MS = 10 * 60 * 1_000
const FAILURE_CACHE_TTL_MS = 60 * 1_000
const FILE_PREVIEW_LIMIT = 5
const FILE_PREVIEW_MAX_BYTES = 96 * 1024
const FILE_PREVIEW_MAX_CHARS = 24_000
const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.py',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.css',
  '.html',
])
type CatalogCacheEntry = {
  expiresAt: number
  result: SkillMarketListResult
}

type DetailCacheEntry = {
  expiresAt: number
  detail: SkillMarketDetail | null
}

type FailureCacheEntry = {
  expiresAt: number
  message: string
}

class SkillMarketRequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'SkillMarketRequestError'
    this.cause = options?.cause
  }
}

export function createSkillMarketService(options: SkillMarketServiceOptions = {}): SkillMarketService {
  const fetchImpl = options.fetchImpl ?? fetch
  const installedSkillNames = options.installedSkillNames
  const now = options.now ?? Date.now
  const catalogCache = new Map<string, CatalogCacheEntry>()
  const detailCache = new Map<string, DetailCacheEntry>()
  const pendingDetailRequests = new Map<string, Promise<SkillMarketDetail | null>>()
  const failureCache = new Map<string, FailureCacheEntry>()

  async function listSkills(params: SkillMarketListParams = {}): Promise<SkillMarketListResult> {
    const source = params.source ?? 'auto'

    if (source === 'clawhub') {
      return withInstalled(await listClawHub(params))
    }

    if (source === 'skillhub') {
      return withInstalled(await listSkillHub(params))
    }

    if (source !== 'auto') {
      throw new Error(`Unsupported skill market source: ${source}`)
    }

    const clawHubFailure = recentFailure(clawHubCatalogCacheKey(params))
    if (clawHubFailure) {
      const fallback = await listSkillHub(params)
      return withInstalled({
        ...fallback,
        sourceStatus: 'fallback',
        message: `ClawHub unavailable: recent request failure (${clawHubFailure.message})`,
      })
    }

    let clawHub: SkillMarketListResult
    try {
      clawHub = await listClawHub(params)
    } catch (error) {
      if (!(error instanceof SkillMarketRequestError)) {
        throw error
      }
      const fallback = await listSkillHub(params)
      return withInstalled({
        ...fallback,
        sourceStatus: 'fallback',
        message: `ClawHub unavailable: ${errorMessage(error)}`,
      })
    }
    return withInstalled(clawHub)
  }

  async function listClawHub(params: SkillMarketListParams): Promise<SkillMarketListResult> {
    const url = clawHubUrlFor(params)
    const cacheKey = catalogCacheKey('clawhub', url)
    try {
      const result = await cachedCatalog(cacheKey, async () => {
        const payload = await requestJson(fetchImpl, url, 'ClawHub')
        return filterCatalogByQuery(normalizeClawHubList(payload), params.query)
      })
      failureCache.delete(cacheKey)
      return result
    } catch (error) {
      if (error instanceof SkillMarketRequestError) {
        failureCache.set(cacheKey, {
          expiresAt: now() + FAILURE_CACHE_TTL_MS,
          message: errorMessage(error),
        })
      }
      throw error
    }
  }

  async function listSkillHub(params: SkillMarketListParams): Promise<SkillMarketListResult> {
    const url = skillHubUrlFor(params)
    return cachedCatalog(catalogCacheKey('skillhub', url), async () => {
      const payload = await requestJson(fetchImpl, url, 'SkillHub')
      return {
        ...filterCatalogByQuery(normalizeSkillHubList(payload), params.query),
        sourceStatus: 'ok',
      }
    })
  }

  async function cachedCatalog(
    cacheKey: string,
    loader: () => Promise<SkillMarketListResult>,
  ): Promise<SkillMarketListResult> {
    const cached = catalogCache.get(cacheKey)
    const currentTime = now()
    if (cached && cached.expiresAt > currentTime) {
      return {
        ...cached.result,
        sourceStatus: 'cached',
      }
    }
    if (cached) {
      catalogCache.delete(cacheKey)
    }

    const result = await loader()
    catalogCache.set(cacheKey, {
      expiresAt: now() + CATALOG_CACHE_TTL_MS,
      result,
    })
    return result
  }

  function recentFailure(cacheKey: string): FailureCacheEntry | undefined {
    const cached = failureCache.get(cacheKey)
    if (!cached) {
      return undefined
    }
    if (cached.expiresAt > now()) {
      return cached
    }
    failureCache.delete(cacheKey)
    return undefined
  }

  async function withInstalled(result: SkillMarketListResult): Promise<SkillMarketListResult> {
    const installed = await resolveInstalledSkillNames(installedSkillNames)
    return {
      ...result,
      items: result.items.map((item): SkillMarketItem => ({
        ...item,
        installed: installed.has(item.slug),
      })),
    }
  }

  async function getDetail(params: SkillMarketDetailParams): Promise<SkillMarketDetail | null> {
    if (params.source !== 'clawhub' && params.source !== 'skillhub') {
      throw new Error(`Unsupported skill market source: ${params.source}`)
    }

    const slug = params.slug.trim()
    if (!slug) {
      return null
    }

    const installed = await resolveInstalledSkillNames(installedSkillNames)
    const baseDetail = await cachedDetail(detailCacheKey(params.source, slug), () => fetchBaseDetail(params.source, slug))
    return baseDetail ? applyInstalledState(baseDetail, installed.has(slug)) : null
  }

  async function cachedDetail(
    cacheKey: string,
    loader: () => Promise<SkillMarketDetail | null>,
  ): Promise<SkillMarketDetail | null> {
    const cached = detailCache.get(cacheKey)
    const currentTime = now()
    if (cached && cached.expiresAt > currentTime) {
      return cached.detail
    }
    if (cached) {
      detailCache.delete(cacheKey)
    }

    const pending = pendingDetailRequests.get(cacheKey)
    if (pending) {
      return pending
    }

    const request = loader()
      .then((detail) => {
        detailCache.set(cacheKey, {
          expiresAt: now() + (detail ? DETAIL_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
          detail,
        })
        return detail
      })
      .finally(() => {
        pendingDetailRequests.delete(cacheKey)
      })

    pendingDetailRequests.set(cacheKey, request)
    return request
  }

  async function fetchBaseDetail(source: SkillMarketSource, slug: string): Promise<SkillMarketDetail | null> {
    if (source === 'clawhub') {
      try {
        return await fetchClawHubDetail(slug)
      } catch (error) {
        if (!(error instanceof SkillMarketRequestError)) {
          throw error
        }
      }

      const list = await listClawHub({
        source: 'clawhub',
        query: slug,
        limit: MAX_LIMIT,
      })
      const item = list.items.find((candidate) => candidate.source === source && candidate.slug === slug)
      return item ? detailFromListItem(item) : null
    }

    const list = await listSkillHub({
      source: 'skillhub',
      query: slug,
      limit: MAX_LIMIT,
    })
    const item = list.items.find((candidate) => candidate.source === source && candidate.slug === slug)
    return item ? detailFromListItem(item) : null
  }

  async function fetchClawHubDetail(slug: string): Promise<SkillMarketDetail | null> {
    const [detailPayload, scanPayload] = await Promise.all([
      requestJson(fetchImpl, clawHubDetailUrl(slug), 'ClawHub detail'),
      requestJson(fetchImpl, clawHubScanUrl(slug), 'ClawHub scan'),
    ])
    const detail = normalizeClawHubDetail(detailPayload, scanPayload, { installed: false })
    if (!detail) {
      return null
    }

    const versionFiles = detail.version
      ? await fetchClawHubVersionFiles(slug, detail.version)
      : []
    const files = versionFiles.length > 0 ? versionFiles : detail.files
    const filePreviews = await fetchClawHubFilePreviews(slug, detail.version, files)
    const entryPreview = filePreviews.find((preview) => preview.path === 'SKILL.md')?.content ?? detail.entryPreview

    return {
      ...detail,
      files,
      filePreviews,
      entryPreview,
      previewUnavailableReason: previewUnavailableReason(filePreviews, files, detail.entryPreview),
      riskLabels: analyzeSkillRisk({
        entryContent: entryPreview,
        files,
        requiresApiKey: detail.requiresApiKey,
      }),
    }
  }

  async function fetchClawHubVersionFiles(slug: string, version: string): Promise<SkillMarketFile[]> {
    try {
      const payload = await requestJson(fetchImpl, clawHubVersionUrl(slug, version), 'ClawHub version')
      return normalizeClawHubVersionFiles(payload)
    } catch (error) {
      if (error instanceof SkillMarketRequestError) {
        return []
      }
      throw error
    }
  }

  async function fetchClawHubFilePreviews(
    slug: string,
    version: string | undefined,
    files: SkillMarketFile[],
  ): Promise<SkillMarketFilePreview[]> {
    const previews = await Promise.all(previewCandidateFiles(files).map(async (file) => {
      try {
        const content = await requestText(fetchImpl, clawHubFileUrl(slug, file.path, version), 'ClawHub file')
        return buildTextPreview(file, content)
      } catch (error) {
        if (!(error instanceof SkillMarketRequestError)) {
          throw error
        }
        return null
      }
    }))
    return previews.filter((preview): preview is SkillMarketFilePreview => preview !== null)
  }

  return {
    listSkills,
    list: listSkills,
    getDetail,
  }
}

function detailFromListItem(item: SkillMarketItem): SkillMarketDetail {
  return {
    ...item,
    files: [],
    previewUnavailableReason: item.source === 'skillhub'
      ? 'SkillHub does not expose a safe raw file preview endpoint yet.'
      : 'Marketplace detail did not include enough package metadata for file preview.',
    riskLabels: [],
    installEligibility: installEligibilityFromListItem(item),
  }
}

function applyInstalledState(detail: SkillMarketDetail, installed: boolean): SkillMarketDetail {
  if (installed) {
    return {
      ...detail,
      installed: true,
      installEligibility: {
        status: 'installed',
        installedSkillName: detail.slug,
      },
    }
  }

  if (!detail.installed) {
    return detail
  }

  return {
    ...detail,
    installed: false,
    installEligibility: installEligibilityFromListItem({
      ...detail,
      installed: false,
    }),
  }
}

function installEligibilityFromListItem(item: SkillMarketItem): SkillMarketDetail['installEligibility'] {
  if (item.installed) {
    return {
      status: 'installed',
      installedSkillName: item.slug,
    }
  }
  if (
    item.trustState === 'clean' ||
    item.trustState === 'benign' ||
    item.trustState === 'signed' ||
    item.trustState === 'official'
  ) {
    return { status: 'blocked', reason: 'Full package safety scan is required before install.' }
  }
  if (item.trustState === 'warning') {
    return { status: 'blocked', reason: 'Skill market trust metadata contains warnings.' }
  }
  if (item.trustState === 'unknown') {
    return { status: 'blocked', reason: 'Skill market trust metadata is missing or inconclusive.' }
  }
  return { status: 'blocked', reason: 'Skill market trust metadata blocked this skill.' }
}

function clawHubUrlFor(params: SkillMarketListParams): URL {
  const url = new URL(CLAWHUB_SKILLS_URL)
  url.searchParams.set('sort', clawHubSort(params.sort))
  url.searchParams.set('nonSuspiciousOnly', 'true')
  url.searchParams.set('limit', String(limitFor(params.limit)))
  addOptionalParam(url, 'query', params.query)
  addOptionalParam(url, 'cursor', params.cursor)
  return url
}

function clawHubDetailUrl(slug: string): URL {
  return new URL(`${CLAWHUB_SKILLS_URL}/${encodeURIComponent(slug)}`)
}

function clawHubScanUrl(slug: string): URL {
  return new URL(`${CLAWHUB_SKILLS_URL}/${encodeURIComponent(slug)}/scan`)
}

function clawHubVersionUrl(slug: string, version: string): URL {
  return new URL(`${CLAWHUB_SKILLS_URL}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`)
}

function clawHubFileUrl(slug: string, filePath: string, version?: string): URL {
  const url = new URL(`${CLAWHUB_SKILLS_URL}/${encodeURIComponent(slug)}/file`)
  url.searchParams.set('path', filePath)
  if (version) {
    url.searchParams.set('version', version)
  }
  return url
}

function skillHubUrlFor(params: SkillMarketListParams): URL {
  const url = new URL(SKILLHUB_SKILLS_URL)
  url.searchParams.set('sortBy', skillHubSort(params.sort))
  url.searchParams.set('order', 'desc')
  url.searchParams.set('limit', String(limitFor(params.limit)))
  addOptionalParam(url, 'query', params.query)
  addOptionalParam(url, 'cursor', params.cursor)
  return url
}

function clawHubCatalogCacheKey(params: SkillMarketListParams): string {
  return catalogCacheKey('clawhub', clawHubUrlFor(params))
}

function catalogCacheKey(source: 'clawhub' | 'skillhub', url: URL): string {
  return `${source}:${url.toString()}`
}

function detailCacheKey(source: SkillMarketSource, slug: string): string {
  return `${source}:${slug}`
}

function filterCatalogByQuery(result: SkillMarketListResult, query?: string): SkillMarketListResult {
  const terms = normalizeSearchTerms(query)
  if (terms.length === 0) {
    return result
  }

  return {
    ...result,
    items: result.items.filter((item) => {
      const haystack = [
        item.slug,
        item.displayName,
        item.summary,
        item.summaryZh,
        item.owner,
        item.category,
        item.license,
        ...(item.tags ?? []),
      ].filter(Boolean).join(' ').toLocaleLowerCase()
      return terms.every((term) => haystack.includes(term))
    }),
  }
}

function normalizeSearchTerms(query?: string): string[] {
  return (query ?? '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

async function requestJson(fetchImpl: FetchImpl, url: URL, sourceName: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    throw new SkillMarketRequestError(`${sourceName} request failed: ${errorMessage(error)}`, { cause: error })
  }

  if (!response.ok) {
    throw new SkillMarketRequestError(`${sourceName} request failed with status ${response.status}`)
  }

  return response.json()
}

async function requestText(fetchImpl: FetchImpl, url: URL, sourceName: string): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'text/plain, text/markdown;q=0.9, */*;q=0.1',
      },
    })
  } catch (error) {
    throw new SkillMarketRequestError(`${sourceName} request failed: ${errorMessage(error)}`, { cause: error })
  }

  if (!response.ok) {
    throw new SkillMarketRequestError(`${sourceName} request failed with status ${response.status}`)
  }

  return response.text()
}

function previewCandidateFiles(files: SkillMarketFile[]): SkillMarketFile[] {
  return files
    .filter(isPreviewableTextFile)
    .sort((a, b) => previewPriority(a) - previewPriority(b) || a.path.localeCompare(b.path))
    .slice(0, FILE_PREVIEW_LIMIT)
}

function isPreviewableTextFile(file: SkillMarketFile): boolean {
  const normalizedPath = file.path.replace(/\\/g, '/')
  if (!normalizedPath || normalizedPath.includes('\0') || normalizedPath.endsWith('/')) {
    return false
  }
  if (typeof file.size === 'number' && file.size > FILE_PREVIEW_MAX_BYTES) {
    return false
  }
  const contentType = file.contentType?.toLowerCase()
  if (contentType?.startsWith('text/')) {
    return true
  }
  if (contentType === 'application/json' || contentType === 'application/x-sh') {
    return true
  }
  return TEXT_FILE_EXTENSIONS.has(fileExtension(normalizedPath))
}

function previewPriority(file: SkillMarketFile): number {
  const normalizedPath = file.path.replace(/\\/g, '/')
  const lowerPath = normalizedPath.toLowerCase()
  if (lowerPath === 'skill.md') return 0
  if (lowerPath.endsWith('/skill.md')) return 1
  if (lowerPath.endsWith('.md') || lowerPath.endsWith('.mdx')) return 2
  if (lowerPath.startsWith('scripts/')) return 3
  if (lowerPath.endsWith('.py') || lowerPath.endsWith('.ts') || lowerPath.endsWith('.js')) return 4
  return 5
}

function buildTextPreview(file: SkillMarketFile, rawContent: string): SkillMarketFilePreview | null {
  if (!isLikelyText(rawContent)) {
    return null
  }
  const truncated = rawContent.length > FILE_PREVIEW_MAX_CHARS
  return {
    path: file.path,
    content: truncated ? rawContent.slice(0, FILE_PREVIEW_MAX_CHARS) : rawContent,
    language: languageForPath(file.path),
    size: typeof file.size === 'number' ? file.size : undefined,
    truncated,
  }
}

function isLikelyText(content: string): boolean {
  if (content.includes('\0')) {
    return false
  }
  if (!content.includes('\uFFFD')) {
    return true
  }
  const replacementCount = [...content].filter((char) => char === '\uFFFD').length
  return replacementCount / Math.max(content.length, 1) < 0.01
}

function previewUnavailableReason(
  previews: SkillMarketFilePreview[],
  files: SkillMarketFile[],
  fallbackPreview: string | undefined,
): string | undefined {
  if (previews.length > 0 || fallbackPreview) {
    return undefined
  }
  if (files.length === 0) {
    return 'Marketplace detail did not include a file list for preview.'
  }
  return 'No small text files were available for safe preview.'
}

function languageForPath(filePath: string): string | undefined {
  switch (fileExtension(filePath.replace(/\\/g, '/'))) {
    case '.md':
    case '.mdx':
      return 'markdown'
    case '.json':
    case '.jsonl':
      return 'json'
    case '.yaml':
    case '.yml':
      return 'yaml'
    case '.toml':
      return 'toml'
    case '.py':
      return 'python'
    case '.js':
    case '.jsx':
      return 'javascript'
    case '.ts':
    case '.tsx':
      return 'typescript'
    case '.sh':
    case '.bash':
    case '.zsh':
    case '.fish':
      return 'shell'
    case '.ps1':
      return 'powershell'
    case '.html':
      return 'html'
    case '.css':
      return 'css'
    default:
      return undefined
  }
}

function fileExtension(filePath: string): string {
  const basename = filePath.split('/').pop() ?? filePath
  const index = basename.lastIndexOf('.')
  return index >= 0 ? basename.slice(index).toLowerCase() : ''
}

async function resolveInstalledSkillNames(provider?: InstalledSkillNamesProvider): Promise<Set<string>> {
  if (!provider) {
    return new Set()
  }
  if (provider instanceof Set) {
    return provider
  }
  return provider()
}

function limitFor(limit: number | undefined): number {
  if (!Number.isInteger(limit) || limit === undefined || limit < 1) {
    return DEFAULT_LIMIT
  }
  return Math.min(limit, MAX_LIMIT)
}

function clawHubSort(sort: SkillMarketListParams['sort']): string {
  if (sort === 'updated') {
    return 'updated'
  }
  if (sort === 'installs' || sort === 'stars' || sort === 'trending') {
    return sort
  }
  return 'downloads'
}

function skillHubSort(sort: SkillMarketListParams['sort']): string {
  if (sort === 'updated') {
    return 'updated_at'
  }
  if (sort === 'installs' || sort === 'stars') {
    return sort
  }
  return 'downloads'
}

function addOptionalParam(url: URL, name: string, value: string | undefined) {
  const trimmed = value?.trim()
  if (trimmed) {
    url.searchParams.set(name, trimmed)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
