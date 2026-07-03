import type { SkillMarketDetail, SkillMarketItem, SkillMarketListResult, SkillMarketTrustState } from './types.js'

type SkillHubListResponse = {
  code?: number
  data?: {
    skills?: Array<{
      slug?: string
      name?: string
      description?: string
      description_zh?: string
      downloads?: number
      installs?: number
      stars?: number
      ownerName?: string
      upstream_url?: string
      version?: string
      labels?: { requires_api_key?: string }
      category?: string
      verified?: boolean
    }>
  }
}

type SkillHubDetailResponse = {
  latestVersion?: { version?: string }
  owner?: { handle?: string; displayName?: string }
  securityReports?: Record<string, { status?: string; statusText?: string }>
  skill?: {
    slug?: string
    displayName?: string
    summary?: string
    summary_zh?: string
    sourceUrl?: string
    stats?: { downloads?: number; installs?: number; stars?: number }
    labels?: { requires_api_key?: string }
    category?: string
  }
}

const ALLOWED_EXTERNAL_URL_HOSTS = new Set([
  'clawhub.ai',
  'skillhub.cn',
  'api.skillhub.cn',
  'github.com',
  'raw.githubusercontent.com',
])

function requiresApiKey(labels?: { requires_api_key?: string }) {
  return labels?.requires_api_key === 'true'
}

function skillHubCanonicalUrl(slug: string) {
  return `https://skillhub.cn/skills/${encodeURIComponent(slug)}`
}

function normalizeExternalUrl(value: string | undefined, slug: string) {
  const fallbackUrl = skillHubCanonicalUrl(slug)
  if (!value) {
    return fallbackUrl
  }

  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && ALLOWED_EXTERNAL_URL_HOSTS.has(url.hostname)) {
      return url.toString()
    }
  } catch {
    return fallbackUrl
  }

  return fallbackUrl
}

function trustFromReports(reports?: Record<string, { status?: string; statusText?: string }>): {
  trustState: SkillMarketTrustState
  trustSummary?: string
} {
  const values = Object.values(reports ?? {})
  if (values.some((report) => report.status === 'malicious' || report.status === 'blocked')) {
    return { trustState: 'blocked', trustSummary: values.find((report) => report.statusText)?.statusText }
  }
  if (values.length > 0 && values.every((report) => report.status === 'benign')) {
    return { trustState: 'benign', trustSummary: values.find((report) => report.statusText)?.statusText }
  }
  return { trustState: 'unknown', trustSummary: values.find((report) => report.statusText)?.statusText }
}

export function normalizeSkillHubList(payload: SkillHubListResponse): SkillMarketListResult {
  const items = (payload.data?.skills ?? [])
    .filter((item) => item.slug && item.name)
    .map((item): SkillMarketItem => {
      const slug = item.slug!
      const normalizedUrl = normalizeExternalUrl(item.upstream_url, slug)

      return {
        source: 'skillhub',
        sourceMode: 'fallback',
        slug,
        displayName: item.name!,
        summary: item.description || item.description_zh || '',
        summaryZh: item.description_zh,
        owner: item.ownerName,
        canonicalUrl: normalizedUrl,
        upstreamUrl: normalizedUrl,
        version: item.version,
        downloads: item.downloads,
        installs: item.installs,
        stars: item.stars,
        category: item.category,
        requiresApiKey: requiresApiKey(item.labels),
        trustState: item.verified ? 'signed' : 'unknown',
        installed: false,
      }
    })

  return {
    items,
    nextCursor: null,
    source: 'skillhub',
    sourceStatus: 'fallback',
  }
}

export function normalizeSkillHubDetail(payload: SkillHubDetailResponse): SkillMarketDetail {
  const trust = trustFromReports(payload.securityReports)
  const skill = payload.skill ?? {}
  const slug = skill.slug || 'unknown'
  const normalizedUrl = normalizeExternalUrl(skill.sourceUrl, slug)

  return {
    source: 'skillhub',
    sourceMode: 'fallback',
    slug,
    displayName: skill.displayName || slug,
    summary: skill.summary || skill.summary_zh || '',
    summaryZh: skill.summary_zh,
    owner: payload.owner?.handle || payload.owner?.displayName,
    canonicalUrl: normalizedUrl,
    version: payload.latestVersion?.version,
    downloads: skill.stats?.downloads,
    installs: skill.stats?.installs,
    stars: skill.stats?.stars,
    category: skill.category,
    requiresApiKey: requiresApiKey(skill.labels),
    trustState: trust.trustState,
    trustSummary: trust.trustSummary,
    installed: false,
    files: [],
    riskLabels: requiresApiKey(skill.labels) ? ['requires-api-key'] : [],
    installEligibility: trust.trustState === 'blocked'
      ? { status: 'blocked', reason: 'SkillHub security report blocked this skill.' }
      : { status: 'installable' },
  }
}
