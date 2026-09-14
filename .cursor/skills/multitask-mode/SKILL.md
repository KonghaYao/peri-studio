---
name: multitask-mode
description: >-
  Coordinates Cursor Multitask Mode and Task subagent defaults — foreground
  coordinator plus background workers. Use when Multitask Mode is active, when
  launching Task subagents (including model selection), when deciding single vs
  sibling subagents, or when the user asks about multitask delegation,
  coordinator behavior, or subagent orchestration.
---

# Multitask Mode

Multitask Mode splits the agent into a **coordinator** (foreground) and **workers** (background Task subagents with `run_in_background: true`).

Read [reference.md](reference.md) for the full verbatim specification. This file is the operational quick reference.

## Role

- **Coordinator**: route work, launch/resume workers, answer zero-tool questions, synthesize after workers return.
- **Worker**: owns investigation, edits, shell commands, tests, and end-to-end loops.

Remain in Multitask Mode until the user exits it.

## Hard rules

1. **Delegate any tool use.** If the task needs tool calls, edits, shell commands, or an end-to-end loop, delegate to a background subagent. Do not dismiss this as "a few quick tool calls."
2. **Stop after delegation.** After starting a background subagent, end the response immediately. Do not await, poll, or duplicate the worker's work in the foreground.
3. **Foreground exception.** Answer directly only when zero tool calls are required (pure Q&A, spec output, clarification).
4. **Default: one worker.** Do not split small/medium tasks into many sibling agents.
5. **No duplicate work.** Do not repeat investigation or implementation already delegated to a running worker.

## When to delegate (single worker)

- Long-running shell: build, test, typecheck
- Any tool calls or non-trivial edits
- End-to-end loops: find → implement → test; investigate → fix → verify
- One coherent deliverable with shared context

## When to use sibling workers

Only when top-level workstreams are clearly independent:

- Separate backend / frontend ownership
- Unrelated files or services
- Separate user asks in one message
- Coverage-style exploration (broad review, competing hypotheses)

**Weak reasons** (use one worker instead): ordinary bug fix, medium refactor, feature work that shares context.

## Subtask planning

- Prefer one worker for the whole investigation/implementation/test loop.
- Large tasks: one worker may internally split work; parent keeps delegation coherent.
- Decompose only when coordination cost is clearly worth it.

## Subagent defaults

When launching Task subagents, pass `model: composer-2.5-fast` unless the user explicitly requests:

- a slower or stronger model
- a deep review
- adversarial or security analysis

Parent coordinators must include `model: composer-2.5-fast` on Task tool calls by default.

Do not interrupt already-running agents just to switch models.

## Coordinator checklist

Before each foreground tool call, ask:

1. Is a worker already handling this?
2. Does this need tools at all?
3. Is this coordination/synthesis, not duplicated execution?

If the next action is the delegated worker's job → stop.

## Worker follow-up

When a background subagent completes:

- Perform necessary follow-up only (synthesis, missing pieces, user-facing summary).
- If nothing remains, do not repeat the same confirmation.
- Link agents as `[Name](id)`, not `[agent]` / `[worker]` / `[subagent]`.

## Delegation examples

| Request | Strategy |
|---------|----------|
| Bug fix | One worker owns investigate → fix → test |
| Minor feature | One worker owns full loop |
| Large feature | One worker first; sibling workers only if plan exposes independent top-level streams |
| Broad review | Multiple siblings only when independent coverage is the goal |
| One long shell command, no follow-up | Background shell is acceptable instead of a subagent |

## Additional resources

- Full verbatim Multitask specification: [reference.md](reference.md)
