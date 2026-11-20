# dsh-stageshow

DeepSeek Harness (DSH) plugin that ships Benji Taylor's
[Stageshow](https://github.com/benjitaylor/skills) skill as a DSH skill.

Stageshow makes **faux product UI that looks like the real product**: stills,
feature cards, cursor demos and bento grids built in React, with composition
and motion rules, a copyable kit, gold examples, and filming tools so the
agent can check its own work. The skill body, kit, examples, references,
teaching pairs and playground are vendored **byte-identical** from upstream
(pin recorded in `UPSTREAM.lock.json`); this bundle adds no skill text of its
own.

## What it installs

- A skill provider (`dsh-stageshow`) that exposes one model- and
  user-invocable skill: **`stageshow`** (upstream v1.1.1, pinned to upstream
  commit `299140fafd08df55a9c234e610c3f64af3f45531`).
- One read-only host tool, **`stageshow_self_check`**: verifies the vendored
  copy still parses, every file matches the pinned hash lock, and the bundled
  skill rank agrees with the installed DSH release.

Precedence follows DSH ranks: a user's own `~/.agents/skills/stageshow` copy
(lower rank) wins over this bundled copy — remove the local copy if you want
the pinned one.

## Usage

Ask for a product illustration and the agent should load `stageshow`:
「给 Notion 的这个功能做一张 feature card」、"make a cursor demo of the upload
flow", "bento grid for our launch page". Inside the skill, the preview and
film loop run from the vendored directory:

```sh
cd skills/stageshow && npm install && npm run dev   # preview at :5173
node scripts/film.mjs "<preview>/?capture=hero-demo" --gate --out shots/
```

The vendored copy is self-contained (`kit/`, `examples/`, `references/`,
`teaching/`, `playground/`, `scripts/`) — copy the closest gold example into
your project per the skill's workflow.

## Install

**Plugins → Add plugin** and point it at this directory, or:

```sh
# from npm, once published
# plugin_manager install_bundle --target dsh-stageshow@<version>
```

The bundle is Host-only; it needs no client half and declares no DSH-shipped
packages as dependencies. Requires DSH ≥ 0.2.0-rc.2 (the `ctx.skills`
provider API).

## Integrity

`UPSTREAM.lock.json` records the upstream repository, commit, skill version
and a SHA-256 digest per vendored file. `stageshow_self_check` recomputes
every digest at runtime; any drift (edited vendored file, partial upgrade)
fails the check with the drifted paths listed. Do not edit files under
`skills/stageshow/` in place — re-vendor from upstream and rebuild the lock:

```sh
npm run lock:build   # after replacing skills/stageshow with the new upstream copy
```

`.gitattributes` pins LF endings so the hashes survive Windows checkouts.

## License

Plugin code: MIT (see `LICENSE`). The vendored Stageshow skill is MIT ©
Benji Taylor (`skills/stageshow/LICENSE`); product names, app icons and brand
artwork inside the examples remain with their owners — read
`NOTICE.md` / `skills/stageshow/NOTICE.md` before shipping derived imagery.
