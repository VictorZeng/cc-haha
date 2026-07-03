import type { SkillMarketItem, SkillMarketListResult, SkillMarketTrustState } from './types.js'

type ClawHubListResponse = {
  items?: Array<{
    slug?: string
    displayName?: string
    summary?: string
    description?: string | null
    topics?: string[]
    tags?: { latest?: string } | null
    stats?: { downloads?: number; installs?: number; stars?: number }
    latestVersion?: { version?: string; license?: string | null } | null
  }>
  nextCursor?: string | null
}

type ClawHubScanResponse = {
  status?: string
  hasWarnings?: boolean
  sha256?: string
  scanners?: Record<string, { status?: string; summary?: string }>
}

export function normalizeClawHubList(payload: ClawHubListResponse): SkillMarketListResult {
  const items = (payload.items ?? [])
    .filter((item) => item.slug && item.displayName)
    .map((item): SkillMarketItem => ({
      source: 'clawhub',
      sourceMode: 'primary',
      slug: item.slug!,
      displayName: item.displayName!,
      summary: item.summary || item.description || '',
      owner: undefined,
      canonicalUrl: `https://clawhub.ai/${item.slug}`,
      license: item.latestVersion?.license ?? null,
      version: item.latestVersion?.version ?? item.tags?.latest,
      downloads: item.stats?.downloads,
      installs: item.stats?.installs,
      stars: item.stats?.stars,
      tags: item.topics,
      requiresApiKey: false,
      trustState: 'clean',
      installed: false,
    }))

  return {
    items,
    nextCursor: payload.nextCursor ?? null,
    source: 'clawhub',
    sourceStatus: 'ok',
  }
}

export function normalizeClawHubScan(payload: ClawHubScanResponse): {
  trustState: SkillMarketTrustState
  trustSummary?: string
  packageSha256?: string
} {
  const scannerSummary = Object.values(payload.scanners ?? {}).find((entry) => entry.summary)?.summary
  if (payload.status === 'clean' && !payload.hasWarnings) {
    return { trustState: 'clean', trustSummary: scannerSummary, packageSha256: payload.sha256 }
  }
  if (payload.status === 'malicious' || payload.status === 'blocked') {
    return { trustState: 'blocked', trustSummary: scannerSummary, packageSha256: payload.sha256 }
  }
  if (payload.status === 'suspicious' || payload.hasWarnings) {
    return { trustState: 'warning', trustSummary: scannerSummary, packageSha256: payload.sha256 }
  }
  return { trustState: 'unknown', trustSummary: scannerSummary, packageSha256: payload.sha256 }
}
