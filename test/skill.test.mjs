import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseSkill, name as pluginName, inject, apply } from '../index.js'

const root = fileURLToPath(new URL('..', import.meta.url))

const SKILL = join(root, 'skills', 'stageshow', 'SKILL.md')

test('plugin surface: name, inject, apply', () => {
  assert.equal(pluginName, 'stageshow')
  assert.deepEqual(inject, ['skills'])
  assert.equal(typeof apply, 'function')
})

test('vendored SKILL.md parses with the expected identity', async () => {
  const raw = await readFile(SKILL, 'utf8')
  const skill = parseSkill(raw, 'skills/stageshow/SKILL.md')
  assert.equal(skill.name, 'stageshow')
  assert.equal(skill.version, '1.1.1')
  assert.ok(skill.description.length > 50, 'routing description must be substantial')
  assert.ok(!skill.content.startsWith('---'), 'frontmatter must be stripped from the body')
  assert.ok(skill.content.includes('# Stageshow'), 'body must keep the upstream heading')
})

test('parseSkill rejects malformed skill files', () => {
  assert.throws(() => parseSkill('no frontmatter here', 'x.md'), /frontmatter/)
  assert.throws(() => parseSkill('---\nname: stageshow\n---\nbody', 'x.md'), /description/)
  assert.throws(() => parseSkill('---\nname: other-skill\ndescription: d\n---\nbody', 'x.md'), /expected/)
})

test('vendored copy is byte-identical to the upstream clone when present', { skip: !existsSync(join(root, 'upstream-skill', 'stageshow', 'SKILL.md')) ? 'upstream clone not checked out' : false }, async () => {
  const vendored = await readFile(SKILL)
  const upstream = await readFile(join(root, 'upstream-skill', 'stageshow', 'SKILL.md'))
  assert.ok(vendored.equals(upstream), 'SKILL.md must not be edited during vendoring')
})
