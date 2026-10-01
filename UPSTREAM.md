# Upstream policy

ActualForge is based on [Actual Budget](https://github.com/actualbudget/actual).

## Pinned base

- Upstream repository: `actualbudget/actual`
- Upstream release: `v26.9.0`
- Upstream commit: `59fe126f637d858c061e1eeedbef5436c8f2225a`
- Pin date: 2026-10-01

## Remote layout

For a local checkout, use:

```bash
git remote set-url origin git@github.com:tojollinor/ActualForge.git
git remote add upstream https://github.com/actualbudget/actual.git
```

Expected remotes:

- `origin` -> `tojollinor/ActualForge`
- `upstream` -> `actualbudget/actual`

## Update policy

There is intentionally **no automatic upstream synchronization**.

Actual Budget updates are handled only after an explicit request. An upstream update must be processed in this order:

1. Fetch the requested/current upstream state.
2. Compare it with the pinned ActualForge base.
3. Review conflicts with ActualForge-specific code and data models.
4. Run build, type, unit, and relevant integration tests.
5. Merge only after the update has been deliberately accepted.
6. Update the pin in `ACTUALFORGE_BASE.json` and this file.
7. Release a new ActualForge version.

Forbidden by project policy:

- scheduled upstream merge workflows,
- bots that automatically advance the Actual base,
- unattended merges,
- automatic Docker/image updates that silently change the Actual base.

Normal CI for ActualForge's own commits is allowed and is separate from upstream synchronization.
