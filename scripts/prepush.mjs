#!/usr/bin/env node
/** The repository typecheck that lefthook's pre-push ran; see scripts/precommit.mjs for why node. */
import { spawnSync } from 'node:child_process'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(pnpm, ['run', 'typecheck'], { stdio: 'inherit', windowsHide: false })
if (result.error !== undefined) throw result.error
process.exit(result.status ?? 1)
