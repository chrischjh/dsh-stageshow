#!/usr/bin/env node
// Dev-time tool (not shipped): rebuild UPSTREAM.lock.json from the vendored
// skills/ tree. Run after replacing skills/stageshow with a new upstream copy.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSkill } from '../index.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const skillsDir = join(root, 'skills')
const upstreamCommit = process.argv[2]

if (upstreamCommit === undefined || !/^[0-9a-f]{40}$/.test(upstreamCommit)) {
  console.error('usage: node scripts/build-lock.mjs <upstream-commit-sha>')
  process.exit(1)
}

const { readdir } = await import('node:fs/promises')
const files = {}
const walk = async (dir, prefix = '') => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.DS_Store') continue
    const full = join(dir, entry.name)
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) await walk(full, relative)
    else {
      const data = await readFile(full)
      files[relative] = createHash('sha256').update(data).digest('hex')
    }
  }
}
await walk(skillsDir)

const skill = parseSkill(await readFile(join(skillsDir, 'stageshow', 'SKILL.md'), 'utf8'), 'skills/stageshow/SKILL.md')

const lock = {
  upstream: {
    repo: 'benjitaylor/skills',
    commit: upstreamCommit,
    skillVersion: skill.version ?? '',
    lockedAt: new Date().toISOString(),
  },
  files,
}
await writeFile(join(root, 'UPSTREAM.lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
console.log(`locked ${Object.keys(files).length} files; skill v${skill.version}; commit ${upstreamCommit.slice(0, 12)}`)
