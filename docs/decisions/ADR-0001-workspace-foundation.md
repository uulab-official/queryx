# ADR-0001: Establish the workspace foundation before native drivers

- Status: Accepted
- Date: 2026-08-03

## Context

The QueryX brief requires a Tauri 2 desktop application, Rust database drivers, shared result models, and a VS Code-like UI. The repository started as a browser-only visual prototype with no package or test boundary.

## Decision

Create a pnpm workspace with `apps/desktop`, `packages/shared`, and `packages/core` before adding native database connections. Keep the UI running against a deterministic in-memory driver that implements the same typed contract as future native drivers.

## Consequences

- UI work can continue without a live database or secrets.
- Driver-neutral types become reviewable before SQL dialect details enter the UI.
- The in-memory driver must never be mistaken for production connectivity.
- Tauri and Rust integration remains the next v0.1 milestone rather than being hidden behind fake persistence.
