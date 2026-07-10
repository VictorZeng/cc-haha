#!/usr/bin/env bun

import { resolve } from 'node:path'

interface ContractSuite {
  name: string
  cwd: string
  command: string[]
}

const root = resolve(import.meta.dir, '../..')
const suites: ContractSuite[] = [
  {
    name: 'server mock CLI and WebSocket contracts',
    cwd: root,
    command: [
      'bun',
      'test',
      'src/server/__tests__/websocket-handler.test.ts',
      'src/server/__tests__/conversations.test.ts',
    ],
  },
  {
    name: 'desktop transport, store, and first-turn contracts',
    cwd: resolve(root, 'desktop'),
    command: [
      'bun',
      'run',
      'test',
      '--',
      '--run',
      'src/api/websocket.test.ts',
      'src/stores/chatStore.test.ts',
      'src/pages/EmptySession.test.tsx',
    ],
  },
]

function formatDuration(startedAt: number): string {
  return `${((performance.now() - startedAt) / 1000).toFixed(1)}s`
}

const runStartedAt = performance.now()

for (const [index, suite] of suites.entries()) {
  const suiteStartedAt = performance.now()
  console.log(`\n[chat-contract] ${index + 1}/${suites.length}: ${suite.name}`)
  console.log(`[chat-contract] cwd: ${suite.cwd}`)
  console.log(`[chat-contract] $ ${suite.command.join(' ')}`)

  const proc = Bun.spawn(suite.command, {
    cwd: suite.cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    console.error(
      `[chat-contract] FAILED: ${suite.name} (exit ${exitCode}, ${formatDuration(suiteStartedAt)})`,
    )
    process.exit(exitCode)
  }

  console.log(`[chat-contract] PASSED: ${suite.name} (${formatDuration(suiteStartedAt)})`)
}

console.log(`\n[chat-contract] All chat contract suites passed (${formatDuration(runStartedAt)}).`)
