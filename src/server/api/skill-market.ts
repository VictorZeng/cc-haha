import {
  createSkillMarketService,
  type SkillMarketListParams,
  type SkillMarketService,
  type SkillMarketServiceOptions,
} from '../services/skillMarket/service.js'
import { installUserSkillFromZipBytes } from '../services/skillMarket/installer.js'
import type { SkillMarketDetail, SkillMarketSource } from '../services/skillMarket/types.js'
import { collectUserSkillNames } from './skills.js'

type SkillMarketServiceFactory = (options: SkillMarketServiceOptions) => SkillMarketService
type SkillMarketInstallRequest = {
  source: SkillMarketSource
  slug: string
  version?: string
}

const SUPPORTED_SOURCES = new Set(['auto', 'clawhub', 'skillhub'])
const SUPPORTED_DETAIL_SOURCES = new Set(['clawhub', 'skillhub'])
const SUPPORTED_SORTS = new Set(['downloads', 'installs', 'stars', 'updated', 'trending'])
const MAX_LIMIT = 100
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024
const INSTALL_REQUEST_KEYS = new Set(['source', 'slug', 'version'])
const PACKAGE_URL_FIELDS = [
  'downloadUrl',
  'downloadURL',
  'download_url',
  'packageUrl',
  'package_url',
  'archiveUrl',
  'archive_url',
  'zipUrl',
  'zip_url',
] as const

let skillMarketServiceFactory: SkillMarketServiceFactory = createSkillMarketService
let defaultSkillMarketService: SkillMarketService | null = null

export function setSkillMarketServiceFactoryForTests(factory: SkillMarketServiceFactory): void {
  skillMarketServiceFactory = factory
  defaultSkillMarketService = null
}

export function resetSkillMarketServiceFactoryForTests(): void {
  skillMarketServiceFactory = createSkillMarketService
  defaultSkillMarketService = null
}

export async function handleSkillMarketApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  const action = segments[2]

  if (req.method === 'GET' && action === undefined) {
    const params = parseListParams(url)
    if (params instanceof Response) {
      return params
    }

    const service = getSkillMarketService()
    const result = await service.list(params)
    return Response.json(result)
  }

  if (action === 'install') {
    if (req.method !== 'POST') {
      return jsonError('method_not_allowed', 'Method not allowed for skill market install.', 405)
    }
    return handleInstall(req)
  }

  if (action !== undefined) {
    return handleDetail(req, segments, action)
  }

  return jsonError('method_not_allowed', 'Method not allowed for skill market.', 405)
}

async function handleDetail(req: Request, segments: string[], sourceSegment: string): Promise<Response> {
  if (!SUPPORTED_DETAIL_SOURCES.has(sourceSegment)) {
    return jsonError('unsupported_source', `Unsupported skill market source: ${sourceSegment}`, 400)
  }

  if (req.method !== 'GET') {
    return jsonError('method_not_allowed', 'Method not allowed for skill market detail.', 405)
  }

  const slug = decodeSkillSlug(segments[3])
  if (!slug || segments.length !== 4) {
    return jsonError('not_found', 'Skill market skill not found.', 404)
  }

  const service = getSkillMarketService()
  const detail = await service.getDetail({
    source: sourceSegment as SkillMarketSource,
    slug,
  })

  if (!detail) {
    return jsonError('not_found', 'Skill market skill not found.', 404)
  }

  return Response.json({ detail })
}

function parseListParams(url: URL): SkillMarketListParams | Response {
  const params: SkillMarketListParams = {}
  const source = url.searchParams.get('source')
  const sort = url.searchParams.get('sort')
  const limit = url.searchParams.get('limit')
  const query = url.searchParams.get('query') ?? url.searchParams.get('q')
  const cursor = url.searchParams.get('cursor')

  if (source !== null) {
    if (!SUPPORTED_SOURCES.has(source)) {
      return jsonError('unsupported_source', `Unsupported skill market source: ${source}`, 400)
    }
    params.source = source as SkillMarketListParams['source']
  }

  if (sort !== null) {
    if (!SUPPORTED_SORTS.has(sort)) {
      return jsonError('unsupported_sort', `Unsupported skill market sort: ${sort}`, 400)
    }
    params.sort = sort as SkillMarketListParams['sort']
  }

  if (limit !== null) {
    const parsedLimit = Number(limit)
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      return jsonError('invalid_limit', 'Skill market limit must be an integer from 1 to 100.', 400)
    }
    params.limit = parsedLimit
  }

  if (query !== null) {
    params.query = query
  }

  if (cursor !== null) {
    params.cursor = cursor
  }

  return params
}

function decodeSkillSlug(segment: string | undefined): string | null {
  if (segment === undefined) {
    return null
  }

  try {
    const decoded = decodeURIComponent(segment).trim()
    return decoded || null
  } catch {
    return null
  }
}

async function handleInstall(req: Request): Promise<Response> {
  const body = await parseJsonObject(req)
  if (!body) {
    return jsonError('invalid_json', 'Request body must be a JSON object.', 400)
  }

  if ('targetPath' in body || 'target' in body || 'path' in body) {
    return jsonError('target_path_not_allowed', 'Install target is computed by the server.', 400)
  }

  const installRequest = parseInstallRequest(body)
  if (installRequest instanceof Response) {
    return installRequest
  }

  const service = getSkillMarketService()
  const detail = await service.getDetail({
    source: installRequest.source,
    slug: installRequest.slug,
  })

  if (!detail) {
    return jsonError('not_found', 'Skill market skill not found.', 404)
  }

  if (installRequest.version !== undefined && detail.version !== undefined && detail.version !== installRequest.version) {
    return jsonError('version_mismatch', 'Requested skill version does not match marketplace detail.', 409, {
      detail,
    })
  }

  const eligibility = detail.installEligibility
  if (eligibility.status === 'installed') {
    return jsonError('skill_already_installed', 'Skill is already installed.', 409, {
      installEligibility: eligibility,
      detail,
    })
  }
  if (eligibility.status === 'conflict') {
    return jsonError('install_conflict', 'Skill install target already exists.', 409, {
      installEligibility: eligibility,
      detail,
    })
  }
  if (eligibility.status === 'blocked') {
    return jsonError('install_blocked', eligibility.reason, 409, {
      installEligibility: eligibility,
      detail,
    })
  }

  const packageUrl = resolvePackageDownloadUrl(detail, installRequest.version)
  if (!packageUrl) {
    return jsonError(
      'install_not_available',
      'Marketplace detail does not provide a safe downloadable package for this skill.',
      422,
      { detail },
    )
  }

  let zipBytes: Buffer
  try {
    zipBytes = await downloadPackageZip(packageUrl)
  } catch (error) {
    return jsonError('install_download_failed', errorMessage(error), 502, { detail })
  }

  try {
    const result = await installUserSkillFromZipBytes({
      skillName: detail.slug,
      zipBytes,
    })
    return Response.json(result)
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return jsonError('install_conflict', errorMessage(error), 409, { detail })
    }
    return jsonError('install_failed', errorMessage(error), 422, { detail })
  }
}

function getSkillMarketService(): SkillMarketService {
  if (skillMarketServiceFactory !== createSkillMarketService) {
    return skillMarketServiceFactory({
      installedSkillNames: collectUserSkillNames,
    })
  }

  defaultSkillMarketService ??= skillMarketServiceFactory({
    installedSkillNames: collectUserSkillNames,
  })
  return defaultSkillMarketService
}

function parseInstallRequest(body: Record<string, unknown>): SkillMarketInstallRequest | Response {
  for (const key of Object.keys(body)) {
    if (!INSTALL_REQUEST_KEYS.has(key)) {
      return jsonError('unsupported_install_field', `Unsupported install request field: ${key}`, 400)
    }
  }

  const source = body.source
  if (source !== 'clawhub' && source !== 'skillhub') {
    return jsonError('unsupported_source', 'Install source must be clawhub or skillhub.', 400)
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!slug) {
    return jsonError('invalid_slug', 'Install slug must be a non-empty string.', 400)
  }

  const version = body.version
  if (version === undefined) {
    return { source, slug }
  }
  if (typeof version !== 'string' || !version.trim()) {
    return jsonError('invalid_version', 'Install version must be a non-empty string when provided.', 400)
  }

  return { source, slug, version: version.trim() }
}

function resolvePackageDownloadUrl(detail: SkillMarketDetail, requestedVersion?: string): URL | null {
  const record = detail as SkillMarketDetail & Record<string, unknown>
  const sourceHosts = allowedPackageHosts(detail.source)

  for (const field of PACKAGE_URL_FIELDS) {
    const url = parseSafePackageUrl(record[field], sourceHosts)
    if (url) {
      return url
    }
  }

  if (detail.source === 'clawhub') {
    return clawHubDownloadUrl(detail.slug, requestedVersion ?? detail.version)
  }

  return null
}

function clawHubDownloadUrl(slug: string, version?: string): URL {
  const url = new URL('https://clawhub.ai/api/v1/download')
  url.searchParams.set('slug', slug)
  if (version) {
    url.searchParams.set('version', version)
  }
  return url
}

function parseSafePackageUrl(value: unknown, allowedHosts: string[]): URL | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || !isAllowedHost(url.hostname, allowedHosts)
  ) {
    return null
  }

  return url
}

function allowedPackageHosts(source: SkillMarketSource): string[] {
  return source === 'clawhub' ? ['clawhub.ai'] : ['skillhub.cn']
}

function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  const normalized = hostname.toLowerCase()
  return allowedHosts.some((allowedHost) => normalized === allowedHost || normalized.endsWith(`.${allowedHost}`))
}

async function downloadPackageZip(url: URL): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/zip, application/json;q=0.9, */*;q=0.1',
    },
  })
  if (!res.ok) {
    throw new Error(`Package download failed with HTTP ${res.status}`)
  }

  const contentLength = res.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (!Number.isFinite(parsedLength) || parsedLength > MAX_PACKAGE_BYTES) {
      throw new Error('Package download is too large')
    }
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength > MAX_PACKAGE_BYTES) {
    throw new Error('Package download is too large')
  }
  if (!isLikelyZip(buffer)) {
    if (isJsonResponse(res)) {
      throw new Error(nonZipJsonDownloadMessage(buffer))
    }
    throw new Error('Package download did not return a ZIP archive')
  }
  return buffer
}

function isLikelyZip(buffer: Buffer): boolean {
  return buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
    && (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
}

function isJsonResponse(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').toLowerCase().includes('application/json')
}

function nonZipJsonDownloadMessage(buffer: Buffer): string {
  try {
    const payload = JSON.parse(buffer.toString('utf-8')) as { kind?: unknown; type?: unknown; source?: unknown }
    const handoffKind = typeof payload.kind === 'string' ? payload.kind : payload.type
    if (handoffKind === 'public-github' || payload.source === 'github') {
      return 'ClawHub returned a public GitHub handoff instead of ZIP bytes; direct local install is not supported yet.'
    }
  } catch {
    // Fall through to the generic message below.
  }
  return 'Package download did not return a ZIP archive'
}

function isAlreadyExistsError(error: unknown): boolean {
  return errorMessage(error).includes('already exists')
}

async function parseJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null
    }
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

function jsonError(error: string, message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, message, ...extra }, { status })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
