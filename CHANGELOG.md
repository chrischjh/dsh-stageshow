# Changelog

## 0.1.0 — 2026-11-21

- First release: hosts the Stageshow skill (upstream v1.1.1, commit
  `299140fafd08df55a9c234e610c3f64af3f45531`) as a DSH skill via
  `ctx.skills.registerProvider`, with `resourceBase` pointing at the vendored
  `skills/stageshow/` directory.
- `stageshow_self_check` tool: frontmatter parse, SHA-256 verification against
  `UPSTREAM.lock.json`, and bundled-rank agreement with the installed DSH.
- Vendored byte-identical: `SKILL.md`, `kit/`, `examples/`, `references/`,
  `teaching/`, `assets/`, `playground/`, `scripts/`, package manifests,
  `LICENSE`, `NOTICE.md`.
