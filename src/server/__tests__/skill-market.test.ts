import { describe, expect, it } from 'bun:test'
import { normalizeClawHubList, normalizeClawHubScan } from '../services/skillMarket/clawhubAdapter.js'
import { normalizeSkillHubDetail, normalizeSkillHubList } from '../services/skillMarket/skillhubAdapter.js'
import {
  CLAWHUB_SCAN_RESPONSE,
  CLAWHUB_TOP_SKILLS_RESPONSE,
  SKILLHUB_DETAIL_RESPONSE,
  SKILLHUB_TOP_SKILLS_RESPONSE,
} from './fixtures/skill-market.js'

describe('skill market fixtures', () => {
  it('keeps representative ClawHub fixture shape stable', () => {
    expect(CLAWHUB_TOP_SKILLS_RESPONSE.items[0]).toMatchObject({
      slug: 'skill-vetter',
      displayName: 'Skill Vetter',
      stats: expect.objectContaining({ downloads: expect.any(Number) }),
    })
  })

  it('keeps representative SkillHub fixture shape stable', () => {
    expect(SKILLHUB_TOP_SKILLS_RESPONSE.data.skills[0]).toMatchObject({
      slug: 'skill-vetter',
      source: 'clawhub',
      labels: expect.objectContaining({ requires_api_key: 'false' }),
    })
  })
})

describe('skill market source normalization', () => {
  it('normalizes ClawHub catalog items as primary clean candidates', () => {
    const result = normalizeClawHubList(CLAWHUB_TOP_SKILLS_RESPONSE)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      source: 'clawhub',
      sourceMode: 'primary',
      slug: 'skill-vetter',
      displayName: 'Skill Vetter',
      canonicalUrl: 'https://clawhub.ai/skill-vetter',
      trustState: 'clean',
      installed: false,
      requiresApiKey: false,
    })
  })

  it('normalizes ClawHub scan responses into trust metadata', () => {
    expect(normalizeClawHubScan(CLAWHUB_SCAN_RESPONSE)).toEqual({
      trustState: 'clean',
      trustSummary: 'No dangerous patterns detected.',
      packageSha256: 'a'.repeat(64),
    })
  })

  it('keeps malicious ClawHub scan responses blocked even with warnings', () => {
    expect(normalizeClawHubScan({ status: 'malicious', hasWarnings: true })).toMatchObject({
      trustState: 'blocked',
    })
  })

  it('normalizes SkillHub list items as fallback candidates with Chinese summary', () => {
    const result = normalizeSkillHubList(SKILLHUB_TOP_SKILLS_RESPONSE)

    expect(result.items[0]).toMatchObject({
      source: 'skillhub',
      sourceMode: 'fallback',
      slug: 'skill-vetter',
      summaryZh: 'AI智能体技能安全预审工具。',
      canonicalUrl: 'https://clawhub.ai/spclaudehome/skill-vetter',
      trustState: 'unknown',
      requiresApiKey: false,
    })
  })

  it('normalizes verified SkillHub list items as signed', () => {
    const result = normalizeSkillHubList({
      code: 0,
      data: {
        skills: [
          {
            slug: 'verified-skill',
            name: 'Verified Skill',
            upstream_url: 'https://github.com/example/verified-skill',
            verified: true,
          },
        ],
      },
    })

    expect(result.items[0]).toMatchObject({
      slug: 'verified-skill',
      canonicalUrl: 'https://github.com/example/verified-skill',
      upstreamUrl: 'https://github.com/example/verified-skill',
      trustState: 'signed',
    })
  })

  it('falls back when SkillHub external URLs are invalid', () => {
    const list = normalizeSkillHubList({
      code: 0,
      data: {
        skills: [
          {
            slug: 'unsafe/slug',
            name: 'Unsafe URL Skill',
            upstream_url: 'http://evil.test/unsafe/slug',
          },
        ],
      },
    })

    expect(list.items[0]).toMatchObject({
      canonicalUrl: 'https://skillhub.cn/skills/unsafe%2Fslug',
      upstreamUrl: 'https://skillhub.cn/skills/unsafe%2Fslug',
    })

    const detail = normalizeSkillHubDetail({
      securityReports: {
        keen: { status: 'benign', statusText: 'safe' },
      },
      skill: {
        slug: 'unsafe/slug',
        displayName: 'Unsafe URL Skill',
        sourceUrl: 'https://evil.test/unsafe/slug',
      },
    })

    expect(detail).toMatchObject({
      canonicalUrl: 'https://skillhub.cn/skills/unsafe%2Fslug',
      trustState: 'benign',
    })
  })

  it('normalizes SkillHub detail security reports', () => {
    const detail = normalizeSkillHubDetail(SKILLHUB_DETAIL_RESPONSE)

    expect(detail).toMatchObject({
      source: 'skillhub',
      sourceMode: 'fallback',
      slug: 'skill-vetter',
      trustState: 'benign',
      trustSummary: '安全，无风险',
    })
  })
})
