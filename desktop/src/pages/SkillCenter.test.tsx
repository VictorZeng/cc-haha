import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { skillMarketApi } from '../api/skillMarket'
import { useSettingsStore } from '../stores/settingsStore'
import { useSkillMarketStore } from '../stores/skillMarketStore'
import { useSkillStore } from '../stores/skillStore'
import type { SkillMarketDetail, SkillMarketItem } from '../types/skillMarket'
import { SkillCenter } from './SkillCenter'

vi.mock('../api/skillMarket', () => ({
  skillMarketApi: {
    list: vi.fn(),
    detail: vi.fn(),
    install: vi.fn(),
  },
}))

vi.mock('../components/skills/SkillList', () => ({
  SkillList: () => <div data-testid="installed-skill-list">Installed skills</div>,
}))

vi.mock('../components/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content, variant }: { content: string; variant?: string }) => (
    <div data-testid="markdown-renderer" data-variant={variant}>{content}</div>
  ),
}))

vi.mock('../components/chat/CodeViewer', () => ({
  CodeViewer: ({
    code,
    language,
    maxLines,
    showLineNumbers,
    wrapLongLines,
  }: {
    code: string
    language?: string
    maxLines?: number
    showLineNumbers?: boolean
    wrapLongLines?: boolean
  }) => (
    <div
      data-testid="code-viewer"
      data-language={language}
      data-max-lines={maxLines}
      data-show-line-numbers={showLineNumbers ? 'true' : 'false'}
      data-wrap-long-lines={wrapLongLines ? 'true' : 'false'}
    >
      {code}
    </div>
  ),
}))

const mockedSkillMarketApi = vi.mocked(skillMarketApi)

function makeItem(overrides: Partial<SkillMarketItem> = {}): SkillMarketItem {
  return {
    source: 'clawhub',
    sourceMode: 'primary',
    slug: 'ppt-generator',
    displayName: 'PPT Generator',
    summary: 'Create presentation decks from structured prompts.',
    owner: 'OpenClaw',
    canonicalUrl: 'https://clawhub.ai/skills/ppt-generator',
    upstreamUrl: 'https://github.com/example/ppt-generator',
    license: 'MIT',
    version: '1.0.0',
    downloads: 42000,
    stars: 128,
    trustState: 'clean',
    installed: false,
    ...overrides,
  }
}

function makeDetail(overrides: Partial<SkillMarketDetail> = {}): SkillMarketDetail {
  return {
    ...makeItem(),
    files: [{ path: 'SKILL.md', size: 512 }],
    filePreviews: [
      {
        path: 'SKILL.md',
        content: '# PPT Generator',
        language: 'markdown',
        size: 512,
      },
    ],
    entryPreview: '# PPT Generator',
    riskLabels: [],
    installEligibility: { status: 'installable' },
    ...overrides,
  }
}

describe('SkillCenter', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useSkillMarketStore.getState().clearDetailCache()
    useSkillMarketStore.setState({
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
    })
    useSkillStore.setState({
      skills: [],
      selectedSkill: null,
      selectedSkillReturnTab: 'skills',
      isLoading: false,
      isDetailLoading: false,
      error: null,
      fetchSkills: vi.fn(),
      fetchSkillDetail: vi.fn(),
      clearSelection: vi.fn(() => useSkillStore.setState({ selectedSkill: null })),
    })
    mockedSkillMarketApi.list.mockResolvedValue({
      items: [makeItem()],
      nextCursor: null,
      source: 'clawhub',
      sourceStatus: 'ok',
    })
    mockedSkillMarketApi.detail.mockResolvedValue({ detail: makeDetail() })
    mockedSkillMarketApi.install.mockResolvedValue({
      installed: true,
      skillName: 'ppt-generator',
      targetPath: '/Users/nanmi/.claude/skills/ppt-generator',
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    useSkillMarketStore.getState().clearDetailCache()
    useSkillMarketStore.setState({
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
    })
    useSkillStore.setState({
      skills: [],
      selectedSkill: null,
      selectedSkillReturnTab: 'skills',
      isLoading: false,
      isDetailLoading: false,
      error: null,
    })
  })

  it('loads marketplace cards and opens a detail confirmation panel', async () => {
    const { container } = render(<SkillCenter />)

    expect(screen.getByRole('tab', { name: 'Marketplace' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('button', { name: 'PPT Generator' })).toBeInTheDocument()
    expect(mockedSkillMarketApi.list).toHaveBeenCalledWith({
      source: 'auto',
      sort: 'downloads',
      q: undefined,
      limit: 100,
    })

    fireEvent.click(screen.getByRole('button', { name: 'PPT Generator' }))

    await waitFor(() => {
      expect(mockedSkillMarketApi.detail).toHaveBeenCalledWith('clawhub', 'ppt-generator')
    })
    const detail = await screen.findByText('# PPT Generator')
    expect(detail).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: 'PPT Generator' })
    const detailLayer = screen.getByTestId('skill-market-detail-layer')
    expect(container.contains(dialog)).toBe(false)
    expect(document.body.contains(dialog)).toBe(true)
    expect(detailLayer).toHaveClass('fixed', 'inset-0', 'z-50')
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled()
    expect(screen.getByText('Open upstream')).toHaveAttribute('href', 'https://github.com/example/ppt-generator')
    expect(screen.getByText('File preview')).toBeInTheDocument()
    expect(screen.getAllByText('SKILL.md').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(mockedSkillMarketApi.install).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Confirm skill install' })).toBeInTheDocument()
    expect(screen.getByText('~/.claude/skills/ppt-generator')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Install skill' }))
    await waitFor(() => {
      expect(mockedSkillMarketApi.install).toHaveBeenCalledWith('clawhub', 'ppt-generator', '1.0.0')
    })
  })

  it('renders marketplace cards with trust, details, install, API key, and popularity signals', async () => {
    mockedSkillMarketApi.list.mockResolvedValue({
      items: [
        makeItem({
          slug: 'skill-vetter',
          displayName: 'Skill Vetter',
          summary: 'Security-first skill vetting.',
          downloads: 260960,
          trustState: 'clean',
          installed: false,
        }),
        makeItem({
          slug: 'weather',
          displayName: 'Weather',
          summary: 'Fetch current weather through a command-line workflow.',
          downloads: 18420,
          trustState: 'clean',
          installed: true,
          requiresApiKey: false,
        }),
        makeItem({
          slug: 'crm-sync',
          displayName: 'CRM Sync',
          summary: 'Connects to an external CRM API.',
          downloads: 7420,
          trustState: 'warning',
          requiresApiKey: true,
        }),
      ],
      nextCursor: null,
      source: 'clawhub',
      sourceStatus: 'ok',
    })

    render(<SkillCenter />)

    const market = screen.getByTestId('skill-marketplace-tab')
    const vetterCard = await within(market).findByRole('button', { name: 'Skill Vetter' })
    const weatherCard = within(market).getByRole('button', { name: 'Weather' })
    const crmCard = within(market).getByRole('button', { name: 'CRM Sync' })
    expect(vetterCard).toBeInTheDocument()
    expect(within(market).getAllByText('Clean').length).toBeGreaterThan(0)
    expect(within(market).queryByText('Preview')).not.toBeInTheDocument()
    expect(within(vetterCard).getByText('Details')).toBeInTheDocument()
    expect(within(weatherCard).getByText('Installed')).toBeInTheDocument()
    expect(within(crmCard).getByText('API key')).toBeInTheDocument()
    expect(within(vetterCard).getByText(/260\.9K|260,960/)).toBeInTheDocument()
  })

  it('prefetches visible details and warms a focused marketplace card without opening the drawer', async () => {
    mockedSkillMarketApi.list.mockResolvedValue({
      items: [
        makeItem({ slug: 'alpha', displayName: 'Alpha Skill' }),
        makeItem({ slug: 'bravo', displayName: 'Bravo Skill' }),
        makeItem({ slug: 'charlie', displayName: 'Charlie Skill' }),
        makeItem({ slug: 'delta', displayName: 'Delta Skill' }),
      ],
      nextCursor: null,
      source: 'clawhub',
      sourceStatus: 'ok',
    })

    render(<SkillCenter />)

    const deltaCard = await screen.findByRole('button', { name: 'Delta Skill' })
    await waitFor(() => {
      expect(mockedSkillMarketApi.detail).toHaveBeenCalledTimes(3)
    })
    mockedSkillMarketApi.detail.mockClear()

    fireEvent.focus(deltaCard)

    await waitFor(() => {
      expect(mockedSkillMarketApi.detail).toHaveBeenCalledWith('clawhub', 'delta')
    })
    expect(screen.queryByTestId('skill-market-detail-layer')).not.toBeInTheDocument()
  })

  it('uses marketplace-shaped loading skeletons while the catalog loads', () => {
    mockedSkillMarketApi.list.mockReturnValue(new Promise(() => {}))
    act(() => {
      useSkillMarketStore.setState({
        isLoading: true,
        items: [],
      })
    })

    render(<SkillCenter />)

    const loadingRegion = screen.getByTestId('skill-marketplace-loading')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('role', 'status')
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status', { name: 'Loading marketplace skills' })).toBe(loadingRegion)
    expect(screen.getAllByTestId('skill-card-skeleton')).toHaveLength(8)
  })

  it('keeps the detail drawer in the body modal layer for uniform theme masking', async () => {
    render(<SkillCenter />)
    fireEvent.click(await screen.findByRole('button', { name: 'PPT Generator' }))

    const detailLayer = await screen.findByTestId('skill-market-detail-layer')
    expect(detailLayer.parentElement).toBe(document.body)
    expect(detailLayer).toHaveClass('fixed', 'inset-0', 'z-50')
    expect(detailLayer.querySelector('.skill-market-detail-scrim')).not.toBeNull()
  })

  it('closes the marketplace detail drawer from the close icon', async () => {
    render(<SkillCenter />)
    fireEvent.click(await screen.findByRole('button', { name: 'PPT Generator' }))

    const dialog = await screen.findByRole('dialog', { name: 'PPT Generator' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close skill details' }))

    await waitFor(() => {
      expect(screen.queryByTestId('skill-market-detail-layer')).not.toBeInTheDocument()
    })
    expect(useSkillMarketStore.getState().selectedDetail).toBeNull()
    expect(useSkillMarketStore.getState().isDetailLoading).toBe(false)
  })

  it('announces detail drawer skeleton loading without visible copy', async () => {
    mockedSkillMarketApi.detail.mockReturnValue(new Promise(() => {}))

    render(<SkillCenter />)
    fireEvent.click(await screen.findByRole('button', { name: 'PPT Generator' }))

    const detailLayer = screen.getByTestId('skill-market-detail-layer')
    const detailLoading = within(detailLayer).getByRole('status', { name: 'Loading skill detail' })
    expect(detailLoading).toHaveAttribute('aria-busy', 'true')
    expect(within(detailLoading).getByText('Loading skill detail')).toHaveClass('sr-only')
  })

  it('places install decision, blocking reason, and file preview in the drawer decision area', async () => {
    mockedSkillMarketApi.detail.mockResolvedValue({
      detail: makeDetail({
        installEligibility: { status: 'blocked', reason: 'A full package safety scan is required before install.' },
        trustSummary: 'Scanner found no known malicious content, but the package scan is incomplete.',
        filePreviews: [{
          path: 'SKILL.md',
          content: '# Skill Vetter\n\nSecurity-first skill vetting.',
          language: 'markdown',
          size: 512,
        }],
      }),
    })

    render(<SkillCenter />)
    fireEvent.click(await screen.findByRole('button', { name: 'PPT Generator' }))

    const dialog = await screen.findByRole('dialog', { name: 'PPT Generator' })
    expect(within(dialog).getByRole('heading', { name: 'Install decision' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Blocked' })).toBeDisabled()
    expect(within(dialog).getByText(/full package safety scan/i)).toBeInTheDocument()
    expect(within(dialog).getByText('File preview')).toBeInTheDocument()
    expect(within(dialog).getAllByText('SKILL.md').length).toBeGreaterThan(0)
  })

  it('renders Markdown and Python previews with the existing rich preview components', async () => {
    mockedSkillMarketApi.detail.mockResolvedValue({
      detail: makeDetail({
        files: [
          { path: 'SKILL.md', size: 256, contentType: 'text/markdown' },
          { path: 'scripts/audit.py', size: 42, contentType: 'text/x-python' },
        ],
        filePreviews: [
          {
            path: 'SKILL.md',
            content: '# Audit Skill\n\nUse this before install.',
            language: 'markdown',
            size: 256,
          },
          {
            path: 'scripts/audit.py',
            content: 'print("audit")\n',
            language: 'python',
            size: 42,
          },
        ],
        entryPreview: '# Audit Skill',
        riskLabels: ['scripts', 'executables'],
      }),
    })

    render(<SkillCenter />)
    fireEvent.click(await screen.findByRole('button', { name: 'PPT Generator' }))

    expect(await screen.findByText('File preview')).toBeInTheDocument()
    expect(screen.getByTestId('markdown-renderer')).toHaveAttribute('data-variant', 'compact')
    expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('Use this before install.')
    expect(screen.getByText('scripts/audit.py')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'scripts/audit.py' }))
    const codePreview = screen.getByTestId('code-viewer')
    expect(codePreview).toHaveAttribute('data-language', 'python')
    expect(codePreview).toHaveAttribute('data-max-lines', '9999')
    expect(codePreview).toHaveAttribute('data-show-line-numbers', 'true')
    expect(codePreview).toHaveAttribute('data-wrap-long-lines', 'true')
    expect(codePreview).toHaveTextContent('print("audit")')
    expect(screen.getByText('Scripts')).toBeInTheDocument()
    expect(screen.getByText('Executables')).toBeInTheDocument()
  })

  it('explains when marketplace file preview is unavailable', async () => {
    mockedSkillMarketApi.detail.mockResolvedValue({
      detail: makeDetail({
        source: 'skillhub',
        sourceMode: 'fallback',
        filePreviews: [],
        entryPreview: undefined,
        previewUnavailableReason: 'SkillHub does not expose a safe raw file preview endpoint yet.',
      }),
    })

    render(<SkillCenter />)
    fireEvent.click(await screen.findByRole('button', { name: 'PPT Generator' }))

    expect(await screen.findByText('Preview unavailable')).toBeInTheDocument()
    expect(screen.getByText('SkillHub does not expose a safe raw file preview endpoint yet.')).toBeInTheDocument()
  })

  it('shows marketplace source fallback status without losing the selected source control', async () => {
    mockedSkillMarketApi.list.mockResolvedValue({
      items: [makeItem({ source: 'skillhub', sourceMode: 'fallback' })],
      nextCursor: null,
      source: 'skillhub',
      sourceStatus: 'fallback',
      message: 'ClawHub unavailable, using SkillHub.',
    })

    render(<SkillCenter />)

    expect(await screen.findByText('ClawHub unavailable, using SkillHub.')).toBeInTheDocument()
    expect(screen.getByText('Fallback active')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('replaces raw network failures with a user-facing marketplace error', async () => {
    mockedSkillMarketApi.list.mockRejectedValue(new Error('Failed to fetch'))

    render(<SkillCenter />)

    expect(await screen.findByText('Marketplace unavailable')).toBeInTheDocument()
    expect(screen.getByText(/could not be reached/)).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })

  it('opens the installed skill detail from an installed marketplace item', async () => {
    const fetchSkillDetail = vi.fn()
    useSkillStore.setState({
      skills: [
        {
          name: 'ppt-generator',
          displayName: 'PPT Generator',
          description: 'Installed local skill',
          source: 'user',
          userInvocable: true,
          contentLength: 80,
          hasDirectory: true,
        },
      ],
      fetchSkillDetail,
    })
    mockedSkillMarketApi.detail.mockResolvedValue({
      detail: makeDetail({
        installed: true,
        installEligibility: { status: 'installed', installedSkillName: 'ppt-generator' },
      }),
    })
    render(<SkillCenter />)

    fireEvent.click(await screen.findByRole('button', { name: 'PPT Generator' }))
    const viewInstalledButton = await screen.findByRole('button', { name: 'View installed' })
    expect(viewInstalledButton).toHaveClass('bg-[var(--color-success-container)]')
    fireEvent.click(viewInstalledButton)

    expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true')
    expect(fetchSkillDetail).toHaveBeenCalledWith('user', 'ppt-generator', undefined, 'skills')
  })

  it('submits market searches without auto-searching every keystroke', async () => {
    render(<SkillCenter />)
    await screen.findByRole('button', { name: 'PPT Generator' })
    mockedSkillMarketApi.list.mockClear()

    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: '  ppt  ' },
    })
    expect(mockedSkillMarketApi.list).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Run search' }))

    await waitFor(() => {
      expect(mockedSkillMarketApi.list).toHaveBeenCalledWith({
        source: 'auto',
        sort: 'downloads',
        q: 'ppt',
        limit: 100,
      })
    })
  })

  it('marks blocked marketplace details as not installable', async () => {
    mockedSkillMarketApi.detail.mockResolvedValue({
      detail: makeDetail({
        trustState: 'blocked',
        riskLabels: ['scripts'],
        installEligibility: { status: 'blocked', reason: 'Risky script detected.' },
      }),
    })
    render(<SkillCenter />)

    fireEvent.click(await screen.findByRole('button', { name: 'PPT Generator' }))

    const detailPanel = await screen.findByText('Risk signals')
    expect(detailPanel).toBeInTheDocument()
    expect(screen.getByText('Scripts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Blocked' })).toBeDisabled()
  })

  it('switches to the installed skills tab', async () => {
    render(<SkillCenter />)
    await screen.findByRole('button', { name: 'PPT Generator' })

    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }))

    expect(screen.getByTestId('installed-skill-list')).toBeInTheDocument()
    expect(within(screen.getByTestId('skill-mine-tab')).getByTestId('installed-skill-list')).toBeInTheDocument()
  })

  it('opens the mine tab when an installed skill detail is already selected', async () => {
    useSkillStore.setState({
      selectedSkill: {
        meta: {
          name: 'local-ppt',
          displayName: 'Local PPT',
          description: 'Installed local skill',
          source: 'user',
          userInvocable: true,
          contentLength: 80,
          hasDirectory: true,
        },
        tree: [{ name: 'SKILL.md', path: 'SKILL.md', type: 'file' }],
        files: [
          {
            path: 'SKILL.md',
            content: '# Local PPT',
            body: '# Local PPT',
            language: 'markdown',
            isEntry: true,
          },
        ],
        skillRoot: '/tmp/local-ppt',
      },
    })

    render(<SkillCenter />)

    expect(await screen.findByText('Local PPT')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true')
    expect(mockedSkillMarketApi.list).not.toHaveBeenCalled()
  })
})
