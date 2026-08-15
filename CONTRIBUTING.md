# Contributing to PelletPilot

Thanks for helping build an open stack for pellet grills. 🔥

## Ground rules

- **Never commit secrets or vendor firmware.** Anything device-specific (WiFi passwords,
  device IDs, the vendor's proprietary mJS files, flash dumps) goes in `private/`, which is
  gitignored. Public files use placeholders like `<GRILL_IP>` / `PBV-XXXXXXXXXXXX`.
- **Safety first.** This project actuates a live fire (igniter, auger, fan). Any control
  code must fail safe — never leave the auger/igniter energized on error, always keep the
  high-temp and flameout interlocks. See [`docs/07`](docs/07-pid-control-feasibility.md).
- **Respect the trademark line.** "Compatible with Pit Boss / Dansons grills" — never imply
  affiliation. Don't redistribute vendor firmware or assets.

## Repo structure

Monorepo (pnpm workspaces). Each package is independent:

- `packages/protocol` — the shared `FE…FF` codec + RPC client. Changes here ripple
  everywhere; add tests and keep it dependency-free.
- `packages/server` — self-hostable cloud + public API.
- `packages/app` — mobile web SPA.
- `tools/` — Python reference implementations (handy for validation).

ESP32 **firmware** lives in its own repo, [`pelletpilot/firmware`](https://github.com/pelletpilot/firmware)
(different toolchain/cadence). Protocol changes that affect it should land in
`packages/protocol` here first, then flow to the firmware repo.
- `docs/` — protocol/reverse-engineering reference. Keep it accurate; it's the spec.

## Dev setup

```bash
pnpm install
pnpm -r build      # build all packages
pnpm -r test       # run tests
```

## Protocol changes

The serial + cloud protocols are documented in `docs/02`–`docs/04`. If you discover new
frame fields or commands, update the docs **and** `packages/protocol` together, and cite how
you verified it (ideally against a real device or the `pytboss` spec in `reference/`).

## PRs

- One logical change per PR. Include tests for protocol/decoder changes.
- Note any device model / control board you tested against.
- By contributing you agree your work is licensed under the project's [MIT license](LICENSE).
