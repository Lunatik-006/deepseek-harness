#!/usr/bin/env node
/**
 * Pre-commit checks without a shell launcher.
 *
 * lefthook starts its children with a hidden console (CREATE_NO_WINDOW); on this Windows host
 * that kills MSYS `sh.exe` during DLL initialization (0xC0000142), so every hook job failed and
 * commits needed --no-verify. Node spawns with `windowsHide: false`, which keeps the console
 * shared and makes the same checks deterministic. Keep each check aligned with lefthook.yml.
 */
import { spawnSync } from 'node:child_process'

const TS_OR_JS = /\.(?:ts|tsx|mts|cts|mjs)$/u
const VENDOR_SOURCE = /^vendor\/[^/]+\/(?:src\/|bin\.js)/u
const TSX_CLI = 'node_modules/tsx/dist/cli.mjs'
const PI_AI_INPUTS = new Set([
  'pnpm-lock.yaml',
  'packages/llm/llm-pi-ai/package.json',
  'packages/llm/llm-pi-ai/scripts/gen-provider-data.ts',
  'packages/llm/llm-pi-ai/src/provider-data.generated.ts',
])

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: false, ...options })
  if (result.error !== undefined) throw result.error
  return result
}

function fail(message, details = []) {
  process.stderr.write(`${message}\n`)
  for (const line of details) process.stderr.write(`  ${line}\n`)
  process.exit(1)
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: false })
  if (result.error !== undefined) throw result.error
  if (!allowFailure && result.status !== 0) process.exit(result.status ?? 1)
  return result.status ?? 1
}

function stagedFiles() {
  const result = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
  if (result.status !== 0) fail('pre-commit: cannot list staged files', [result.stderr.trim()])
  return result.stdout.split('\0').filter(Boolean)
}

const files = stagedFiles()
if (files.length === 0) process.exit(0)

// 1. Whitespace errors in the staged diff.
const whitespace = git(['diff', '--cached', '--check'])
if (whitespace.status !== 0) {
  process.stderr.write(whitespace.stdout)
  process.stderr.write(whitespace.stderr)
  fail('pre-commit: whitespace errors in the staged diff')
}

// 2. Vendored source must come with its manifest entry.
const vendorSources = files.filter(file => VENDOR_SOURCE.test(file))
if (vendorSources.length > 0 && !files.includes('vendor/README.md')) {
  fail('pre-commit: vendored SOURCE changed without updating vendor/README.md', vendorSources)
}

// 3. Lint and format the staged TypeScript/JavaScript; re-stage what the formatter fixed.
const lintable = files.filter(file => TS_OR_JS.test(file) && !file.startsWith('vendor/'))
if (lintable.length > 0) {
  run(process.execPath, [TSX_CLI,
    'scripts/run-oxlint.ts',
    '--config', '.oxlintrc.staged.json',
    '--fix',
    '--no-error-on-unmatched-pattern',
    ...lintable,
  ])
  const restage = git(['add', '--', ...lintable])
  if (restage.status !== 0) fail('pre-commit: cannot re-stage linted files', [restage.stderr.trim()])
}

// 4. Translation records keep their pair.
const translations = files.filter(file => file.endsWith('.i18n.yaml') && !file.startsWith('.agents/notes/archived/'))
if (translations.length > 0) {
  run(process.execPath, [TSX_CLI,'scripts/verify-translation-pairing.ts', '--cached', ...translations])
}

// 5. Archived notes stay out of the live note set.
if (files.some(file => file.startsWith('.agents/notes/archived/'))) {
  run(process.execPath, [TSX_CLI,'scripts/verify-archived-agent-notes.ts'])
}

// 6. Provider metadata stays generated.
if (files.some(file => PI_AI_INPUTS.has(file))) {
  run(process.execPath, [TSX_CLI,'packages/llm/llm-pi-ai/scripts/gen-provider-data.ts', '--check', '--cached'])
}
