import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const skillsDir = join(root, 'skills')

test('upstream lock: pin metadata', async () => {
  const lock = JSON.parse(await readFile(join(root, 'UPSTREAM.lock.json'), 'utf8'))
  assert.equal(lock.upstream.repo, 'benjitaylor/skills')
  assert.match(lock.upstream.commit, /^[0-9a-f]{40}$/)
  assert.equal(lock.upstream.skillVersion, '1.1.1')
})

test('upstream lock: every vendored file is covered and matches its digest', async () => {
  const lock = JSON.parse(await readFile(join(root, 'UPSTREAM.lock.json'), 'utf8'))
  const locked = new Map(Object.entries(lock.files))
  assert.ok(locked.size > 300, `expected the full vendored tree in the lock, got ${locked.size} entries`)

  const seen = new Set()
  const walk = async (dir, prefix = '') => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.DS_Store') continue
      const full = join(dir, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(full, relative)
      } else {
        seen.add(relative)
        assert.ok(locked.has(relative), `file missing from lock: ${relative}`)
        const digest = createHash('sha256').update(await readFile(full)).digest('hex')
        assert.equal(digest, locked.get(relative), `hash mismatch for ${relative}`)
      }
    }
  }
  await walk(skillsDir)
  for (const key of locked.keys()) {
    assert.ok(seen.has(key), `lock entry with no file on disk: ${key}`)
  }
  assert.equal(seen.size, locked.size)
})

test('upstream lock: key paths are skills/-relative and posix-normalized', async () => {
  const lock = JSON.parse(await readFile(join(root, 'UPSTREAM.lock.json'), 'utf8'))
  for (const key of Object.keys(lock.files)) {
    assert.ok(key.startsWith('stageshow/'), `key must live under stageshow/: ${key}`)
    assert.ok(!key.includes('\\'), `keys must be posix-normalized: ${key}`)
    assert.ok(!key.includes('node_modules'), `no vendored dependencies in the lock: ${key}`)
  }
})
