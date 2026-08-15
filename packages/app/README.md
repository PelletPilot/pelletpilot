# packages/app — PelletPilot mobile web app (PWA SPA)

> Status: 🟡 design. This README is the spec; implementation lands after the server.

A mobile-first, installable web app (PWA) for watching and running a cook. Works in three
modes with one codebase, all built on `@pelletpilot/protocol`:

- **Local** — talks straight to the grill on your LAN (`PelletGrill` over `fetch`). No account.
- **Self-hosted** — connects to your own `packages/server` from anywhere.
- **Public** — connects to the hosted PelletPilot API.

## Core screens

- **Dashboard** — big chamber temp vs. setpoint, on/off, fan/igniter/auger activity dots,
  error banners (`noPellets`, `highTempErr`, flameout).
- **Control** — set grill temp (5° steps), light, prime, power. Confirm-guarded writes.
- **Probes** — live meat-probe readouts + target, with a **time-series graph** and a
  time-to-target estimate (stall-aware).
- **Cook timeline** — history from the server; annotate wrap/spritz events.
- **Alerts** — push (web-push) on probe target, flameout, lid-open recovery.

## Proposed stack

- **React + Vite + TypeScript**, PWA (installable, offline shell).
- **Charts:** lightweight (uPlot or Recharts) — follow the `dataviz` guidance for palette.
- **State:** the protocol client + a thin store; poll `getState()` locally or subscribe to
  the server's `WS /subscribe/:id`.
- **Design:** mobile-first, one-hand operation, big legible temps, dark-mode default (you're
  outside at night at the smoker).

## Safety UX

- Writes that actuate the grill (temp change, power off) get a confirm.
- Show connection state clearly; never imply control when the link is stale.
- Surface `highTempErr` / `noPellets` / flameout loudly.
