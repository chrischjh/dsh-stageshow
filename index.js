import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

/**
 * dsh-stageshow — Host-only DSH bundle.
 *
 * Ships the upstream Stageshow skill (benjitaylor/skills, MIT) vendored
 * byte-identical under `skills/stageshow/` and registers it as a DSH skill
 * through `ctx.skills.registerProvider`, mirroring the shipped
 * `@deepseek-ai/dsh-skill-office` pattern. A read-only `stageshow_self_check`
 * tool verifies the vendored copy against a pinned upstream commit + per-file
 * hash lock (`UPSTREAM.lock.json`).
 */

const SKILL_NAME = 'stageshow'
const PROVIDER_NAME = 'dsh-stageshow'
const UPSTREAM_REPO = 'benjitaylor/skills'

/**
 * "Standard precedence rank for packaged skill providers" — the value of
 * BUNDLED_SKILL_RANK in @deepseek-ai/dsh-skill. A profile-installed bundle
 * cannot import shipped DSH packages (they resolve only inside the DSH
 * installation), so the constant is restated here; `stageshow_self_check`
 * compares it against the installed copy and reports a mismatch instead of
 * silently drifting. Lower ranks win duplicate skill names, so a user's own
 * ~/.agents/skills/stageshow copy keeps precedence over this bundled one.
 */
const BUNDLED_SKILL_RANK = 600

const MAX_REPORTED_MISMATCHES = 20

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/** Parse a SKILL.md into { name, description, metadata, content }. Throws on malformed input. */
export function parseSkill(raw, path) {
  const match = FRONTMATTER.exec(raw)
  if (match?.[1] === undefined) throw new Error(`stageshow: ${path} has no YAML frontmatter`)
  const metadata = parseYaml(match[1])
  if (typeof metadata !== 'object' || metadata === null) throw new Error(`stageshow: ${path} frontmatter is not a mapping`)
  const { description } = metadata
  if (typeof description !== 'string' || description.length === 0) throw new Error(`stageshow: ${path} has no description`)
  const name = typeof metadata.name === 'string' && metadata.name.length > 0 ? metadata.name : SKILL_NAME
  if (name !== SKILL_NAME) throw new Error(`stageshow: ${path} declares skill name "${name}", expected "${SKILL_NAME}"`)
  const version = typeof metadata.metadata === 'object' && metadata.metadata !== null && typeof metadata.metadata.version === 'string'
    ? metadata.metadata.version
    : undefined
  return { name, description, metadata: { ...(metadata.metadata ?? {}) }, version, content: raw.slice(match[0].length).trim() }
}

function isPersistentReadFailure(error) {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return code === 'ENOENT' || code === 'ENOTDIR'
}

async function hashFile(path) {
  const data = await readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

async function listFiles(root) {
  const out = []
  let entries
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: false })
  } catch {
    return out
  }
  for (const entry of entries) {
    const base = entry.split(sep).pop()
    if (base === 'node_modules' || base === '.DS_Store') continue
    out.push(entry.split(sep).join('/'))
  }
  return out.sort()
}

export const name = 'stageshow'
export const inject = ['skills']

export function apply(ctx, config = {}) {
  const assetRoot = fileURLToPath(new URL('./skills/', import.meta.url))
  if (!isAbsolute(assetRoot)) throw new Error('stageshow: asset root must resolve to an absolute directory')
  const skillDir = join(assetRoot, SKILL_NAME)
  const skillPath = join(skillDir, 'SKILL.md')
  const lockPath = fileURLToPath(new URL('./UPSTREAM.lock.json', import.meta.url))

  const reportedFailures = new Map()

  async function readSkill(signal) {
    let raw
    try {
      raw = await readFile(skillPath, { encoding: 'utf8', signal })
    } catch (error) {
      if (signal?.aborted === true) throw error
      return failed(error, isPersistentReadFailure(error))
    }
    try {
      const parsed = parseSkill(raw, 'skills/stageshow/SKILL.md')
      reportedFailures.delete(SKILL_NAME)
      return { kind: 'loaded', ...parsed }
    } catch (error) {
      return failed(error, true)
    }
  }

  function failed(error, persistent) {
    const failure = String(error)
    if (reportedFailures.get(SKILL_NAME) !== failure) {
      reportedFailures.set(SKILL_NAME, failure)
      ctx.logger.warn(`stageshow: skill "${SKILL_NAME}" is unavailable: ${failure}`)
    }
    return { kind: 'failed', error, persistent }
  }

  ctx.skills.registerProvider((control) => ({
    name: PROVIDER_NAME,
    async list(options) {
      const read = await readSkill(options.signal)
      if (read.kind === 'failed') return { candidates: [], complete: read.persistent }
      return {
        complete: true,
        candidates: [{
          name: SKILL_NAME,
          description: read.description,
          invocation: { modelInvocable: true, userInvocable: true },
          provider: PROVIDER_NAME,
          source: 'bundled',
          rank: BUNDLED_SKILL_RANK,
          resourceBase: { kind: 'directory', path: skillDir.split(sep).join('/') },
          locator: skillPath,
        }],
      }
    },
    async get(candidate, options) {
      const read = await readSkill(options.signal)
      if (read.kind === 'failed') {
        if (!read.persistent) throw read.error
        control.invalidate()
        return undefined
      }
      const { rank: _rank, locator: _locator, ...summary } = candidate
      return { ...summary, content: read.content }
    },
  }), 'stageshow skill provider')

  // Optional capability: the self-check tool needs ctx.tools, which not every
  // composition mounts. The skill itself must not depend on it.
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    ctx.effect(() => tools.register({
      name: 'stageshow_self_check',
      description: 'Verify the vendored Stageshow skill: SKILL.md parses, every vendored file matches the pinned upstream commit hash lock, and the bundled skill rank agrees with the installed DSH. Read-only; returns a structured report.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            upstream: {
              type: 'object',
              additionalProperties: false,
              properties: {
                repo: { type: 'string' },
                commit: { type: 'string' },
                version: { type: 'string' },
              },
              required: ['repo', 'commit', 'version'],
            },
            skill: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                version: { type: 'string' },
                parse: { type: 'string' },
                descriptionChars: { type: 'integer' },
                contentBytes: { type: 'integer' },
              },
              required: ['name', 'parse'],
            },
            integrity: {
              type: 'object',
              additionalProperties: false,
              properties: {
                files: { type: 'integer' },
                verified: { type: 'integer' },
                mismatched: { type: 'array', items: { type: 'string' } },
                missing: { type: 'array', items: { type: 'string' } },
                extra: { type: 'integer' },
                truncated: { type: 'boolean' },
              },
              required: ['files', 'verified', 'mismatched', 'missing', 'extra', 'truncated'],
            },
            rank: {
              type: 'object',
              additionalProperties: false,
              properties: {
                plugin: { type: 'integer' },
                installed: { type: 'integer' },
                status: { type: 'string' },
              },
              required: ['plugin', 'status'],
            },
            failure: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
              required: ['code', 'message'],
            },
          },
          required: ['ok', 'upstream', 'skill', 'integrity', 'rank'],
        },
        render(args, value) {
          const lines = []
          if (!value.ok) {
            lines.push(`stageshow self-check FAILED${value.failure ? ` [${value.failure.code}]: ${value.failure.message}` : ''}`)
          } else {
            lines.push('stageshow self-check passed.')
          }
          lines.push(`Upstream: ${value.upstream.repo} @ ${value.upstream.commit.slice(0, 12)} (skill v${value.upstream.version})`)
          if (value.skill.parse === 'ok') {
            lines.push(`Skill "${value.skill.name}" v${value.skill.version}: parses, ${value.skill.contentBytes} bytes of instructions, ${value.skill.descriptionChars}-char description.`)
          } else {
            lines.push('Skill: SKILL.md failed to parse — see the Host log.')
          }
          const { integrity } = value
          lines.push(`Integrity: ${integrity.verified}/${integrity.files} files verified, ${integrity.mismatched.length} mismatched, ${integrity.missing.length} missing, ${integrity.extra} untracked${integrity.truncated ? ' (mismatch list truncated)' : ''}.`)
          for (const item of [...integrity.mismatched, ...integrity.missing]) lines.push(`  drift: ${item}`)
          if (integrity.extra > 0) lines.push(`  ${integrity.extra} file(s) exist in the vendored copy but are not in UPSTREAM.lock.json`)
          lines.push(`Rank: plugin ${value.rank.plugin}, installed ${value.rank.installed ?? 'unknown'} (${value.rank.status}).`)
          if (!value.ok) lines.push('Fix: reinstall dsh-stageshow from the packaged artifact; do not edit vendored files in place.')
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      timeoutMs: 30000,
      async execute(args, exec) {
        return await selfCheck(exec?.signal)
      },
      presentCall() {
        return { card: 'generic', title: 'Stageshow self-check', kind: 'read' }
      },
    }), 'stageshow self-check tool')
  }

  async function selfCheck(signal) {
    const lock = { upstream: null, files: null }
    try {
      const raw = await readFile(lockPath, { encoding: 'utf8', signal })
      const parsed = JSON.parse(raw)
      lock.upstream = parsed.upstream ?? null
      lock.files = parsed.files ?? null
    } catch (error) {
      return fail('lock-unreadable', `UPSTREAM.lock.json could not be read or parsed: ${error}`, signal)
    }
    if (typeof lock.upstream !== 'object' || lock.upstream === null || typeof lock.files !== 'object' || lock.files === null) {
      return fail('lock-invalid', 'UPSTREAM.lock.json is missing the upstream or files section.', signal)
    }

    const skillRead = await readSkill(signal)
    const report = {
      ok: false,
      upstream: {
        repo: typeof lock.upstream.repo === 'string' ? lock.upstream.repo : UPSTREAM_REPO,
        commit: typeof lock.upstream.commit === 'string' ? lock.upstream.commit : '',
        version: typeof lock.upstream.skillVersion === 'string' ? lock.upstream.skillVersion : '',
      },
      skill: skillRead.kind === 'loaded'
        ? {
            name: skillRead.name,
            version: skillRead.version ?? '',
            parse: 'ok',
            descriptionChars: skillRead.description.length,
            contentBytes: Buffer.byteLength(skillRead.content, 'utf8'),
          }
        : { name: SKILL_NAME, parse: 'failed' },
      integrity: { files: 0, verified: 0, mismatched: [], missing: [], extra: 0, truncated: false },
      rank: { plugin: BUNDLED_SKILL_RANK, status: 'unavailable' },
    }
    if (skillRead.kind === 'failed') {
      report.failure = { code: 'skill-unavailable', message: String(skillRead.error) }
      report.ok = false
    }

    // Verify every locked file, then look for vendored extras.
    const expected = Object.entries(lock.files)
    let truncated = false
    for (const [relative, digest] of expected) {
      report.integrity.files += 1
      const path = join(assetRoot, relative.split('/').join(sep))
      let actual
      try {
        actual = await hashFile(path)
      } catch {
        report.integrity.missing.push(relative)
        continue
      }
      if (actual === digest) report.integrity.verified += 1
      else if (report.integrity.mismatched.length < MAX_REPORTED_MISMATCHES) report.integrity.mismatched.push(relative)
      else truncated = true
    }
    const vendored = await listFiles(assetRoot)
    const locked = new Set(expected.map(([relative]) => relative))
    report.integrity.extra = vendored.filter((relative) => !locked.has(relative)).length
    report.integrity.truncated = truncated

    report.rank = await checkRank(signal)
    report.ok = skillRead.kind === 'loaded'
      && report.integrity.mismatched.length === 0
      && report.integrity.missing.length === 0
      && report.integrity.extra === 0
    return report
  }

  function fail(code, message, signal) {
    throwIfAborted(signal)
    return {
      ok: false,
      upstream: { repo: UPSTREAM_REPO, commit: '', version: '' },
      skill: { name: SKILL_NAME, parse: 'failed' },
      integrity: { files: 0, verified: 0, mismatched: [], missing: [], extra: 0, truncated: false },
      rank: { plugin: BUNDLED_SKILL_RANK, status: 'unavailable' },
      failure: { code, message },
    }
  }

  async function checkRank(signal) {
    const installDir = process.env.DSH_INSTALL_DIR
    if (installDir === undefined || installDir.length === 0) {
      return { plugin: BUNDLED_SKILL_RANK, status: 'unavailable' }
    }
    const candidates = [
      join(installDir, 'node_modules', '@deepseek-ai', 'dsh-skill', 'src', 'index.ts'),
      join(installDir, 'node_modules', '@deepseek-ai', 'dsh-skill', 'lib', 'index.js'),
    ]
    for (const path of candidates) {
      let source
      try {
        source = await readFile(path, { encoding: 'utf8', signal })
      } catch {
        continue
      }
      const match = /BUNDLED_SKILL_RANK\s*=\s*(\d+)/.exec(source)
      if (match !== null) {
        const installed = Number(match[1])
        return { plugin: BUNDLED_SKILL_RANK, installed, status: installed === BUNDLED_SKILL_RANK ? 'match' : 'mismatch' }
      }
    }
    return { plugin: BUNDLED_SKILL_RANK, status: 'unavailable' }
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    const error = new Error('stageshow_self_check aborted')
    error.name = 'AbortError'
    throw error
  }
}
