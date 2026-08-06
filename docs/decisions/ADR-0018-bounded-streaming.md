# ADR-0018: Bound streamed result memory before disk spill

- Status: Accepted
- Date: 2026-08-06

## Context

QueryX streams native results in 256-row chunks, but the renderer retained every received row. That improved time-to-first-row while leaving an unbounded query capable of exhausting local memory. True disk spill and backpressure require a durable result-store contract that is not yet ready.

## Decision

The desktop stream workflow persists a selectable 10,000, 100,000, or 1,000,000 row cap. The shared core bounds each incoming chunk at the remaining budget and reports whether rows were discarded. The store keeps the bounded prefix, aborts cancel-capable drivers after an overflowing chunk, and converts the expected cancellation into a successful partial result with an explicit warning. It reports rows loaded live in the Results toolbar. Non-cancellable drivers still bound renderer memory but may finish the server-side cursor before returning.

## Consequences

- An accidental unbounded Stream cannot grow the renderer result beyond the selected cap.
- Users can export or inspect the bounded prefix without mistaking it for a complete result; the warning is part of the result contract.
- The cap is not disk spill and does not reduce server/network work for non-cancellable drivers; true backpressure and disk-backed exports remain planned.
