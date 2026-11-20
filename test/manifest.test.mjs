import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const root = fileURLToPath(new URL('..', import.meta.url))
const readJson = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'))

test('manifest: bundle contract is complete', async () => {
  const pkg = await readJson('package.json')
  assert.equal(pkg.name, 'dsh-stageshow')
  assert.equal(pkg.type, 'module')
  assert.ok(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch required (dsh.client alone is not installable)')
  assert.match(pkg.dsh?.engines?.dsh ?? '', /^>=/, 'engines.dsh range required')
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./icon'], './icon.svg')
  for (const required of ['index.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'NOTICE.md', 'UPSTREAM.lock.json', 'skills']) {
    assert.ok(pkg.files.includes(required), `files must ship ${required}`)
  }
  const deps = Object.keys(pkg.dependencies ?? {})
  assert.deepEqual(deps.filter((d) => d.startsWith('@deepseek-ai/')), [], 'must not depend on shipped DSH packages')
})

test('manifest: patch row is namespaced and matches the package name', async () => {
  const pkg = await readJson('package.json')
  const ops = parseYaml(await readFile(join(root, 'cordis.patch.yml'), 'utf8'))
  assert.ok(Array.isArray(ops) && ops.length >= 1, 'patch must be a list of operations')
  const rows = ops.flatMap((op) => (op && typeof op === 'object' && Array.isArray(op.insert) ? op.insert : []))
  assert.ok(rows.length >= 1, 'at least one insert row is required')
  const row = rows.find((r) => r.name === pkg.name)
  assert.ok(row, 'a row must load this package')
  assert.equal(row.id, 'dsh-stageshow', 'row id must be namespaced with the package name')
  assert.ok(typeof row.config === 'object')
  const generic = rows.filter((r) => /^(docs|client|mcp|main)$/.test(String(r.id)))
  assert.deepEqual(generic, [], 'row ids must not collide with generic names')
})

test('manifest: locale resources and icon exist and parse', async () => {
  for (const locale of ['en', 'zh']) {
    const data = await readJson(`locale/${locale}.json`)
    assert.ok(typeof data.meta?.title === 'string' && data.meta.title.length > 0, `${locale} meta.title`)
    assert.ok(typeof data.meta?.description === 'string' && data.meta.description.length > 0, `${locale} meta.description`)
  }
  const icon = await readFile(join(root, 'icon.svg'), 'utf8')
  assert.match(icon, /viewBox="0 0 36 36"/, 'icon must use the 36x36 viewBox')
  assert.ok(!/<rect[^>]*width="36"[^>]*height="36"/.test(icon), 'icon must not paint a full-bleed tile background')
})
