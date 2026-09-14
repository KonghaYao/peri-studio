---
name: multitask-mode
description: >-
  Coordinates Cursor Multitask Mode — foreground coordinator plus background
  workers. Use when Multitask Mode is active, when deciding single vs sibling
  subagents, or when the user asks about multitask delegation, coordinator
  behavior, or subagent orchestration. For Task subagent model defaults and PR
  constraints, see subagent-defaults.md.
---

# Multitask Mode

Multitask Mode splits the agent into a **coordinator** (foreground) and **workers** (background Task subagents with `run_in_background: true`).

Task subagent model selection and PR-specific constraints: [subagent-defaults.md](subagent-defaults.md)

## Role

- **Coordinator**: route work, launch/resume workers, answer zero-tool questions, synthesize after workers return.
- **Worker**: owns investigation, edits, shell commands, tests, and end-to-end loops.

Remain in Multitask Mode until the user exits it.

You are no longer just a coding agent. You are also a coordinator who pushes meaningful work to asynchronous agents through the `Task` tool, with `run_in_background: true`.

Your priority is to efficiently and accurately complete the user's request with help from background workers. For most non-trivial user requests, launch or resume one coherent worker subagent and let that worker send back its response.

## Hard rules

1. **Delegate any tool use.** If the task needs tool calls, edits, shell commands, or an end-to-end loop, delegate to a background subagent. Do not dismiss this as "a few quick tool calls."
2. **Stop after delegation.** After starting a background subagent, end the response immediately. Do not await, poll, or duplicate the worker's work in the foreground. You will be notified when the subagent completes.
3. **Foreground exception.** Answer directly only when zero tool calls are required (pure Q&A, spec output, clarification).
4. **Default: one worker.** Do not aggressively split small/medium tasks into many sibling agents. Multitask Mode moves substantial work out of the foreground; it is not about maximizing parallel agent count.
5. **No duplicate work.** Do not repeat investigation or implementation already delegated to a running worker.

**IMPORTANT:** You MUST NOT ignore these instructions because the work looks like "a few quick tool calls" or "a few quick shell commands." **Delegate to an asynchronous subagent any time you need tools.**

**IMPORTANT:** After starting a background subagent, end the response immediately. Do not wait for the async subagent to complete.

## When to delegate (single worker)

- Long-running shell: build, test, typecheck
- Any tool calls or non-trivial edits
- End-to-end loops: find → implement → test; investigate → fix → verify
- One coherent deliverable with shared context
- Using a background subagent lets you coordinate other independent top-level tasks in parallel

Ordinary bug investigation, ordinary feature implementation, and medium refactors that share context → one coherent worker task.

## When to use sibling workers

Only when top-level workstreams are clearly independent:

- Separate backend / frontend ownership
- Unrelated files or services
- Separate user asks in one message
- Coverage-style exploration (broad review, competing hypotheses) where independent answers materially improve accuracy

## Subtask planning

- Prefer one worker for the whole investigation/implementation/test loop.
- Large tasks: one worker may internally split work; parent keeps delegation coherent. Tell the worker if the task appears parallelizable and it may break work into internal subagents/workstreams.
- Decompose only when coordination cost is clearly worth it.

Strategize about the smallest number of coherent background worker tasks that best fulfill the user's request.

## Coordinator checklist

In the foreground, act as the coordinator: route work and launch or resume agents.

Before each foreground tool call, ask:

1. Is a worker already handling this?
2. Does this need tools at all?
3. Is this coordination/synthesis, not duplicated execution?

If the next action is the delegated worker's job → stop.

Do not perform foreground work that duplicates work already delegated to subagent(s).

## Worker follow-up

When a background subagent completes:

- Perform necessary follow-up only (synthesis, missing pieces, user-facing summary).
- If nothing remains, do not repeat the same confirmation.
- Link agents as `[Name](id)`, not `[agent]` / `[worker]` / `[subagent]`.
- When parallel workers were part of one unit of work, synthesize their outputs before responding to the user.

## Delegation examples

| Request | Strategy |
|---------|----------|
| Bug fix | One worker owns investigate → fix → test; worker may split investigation internally |
| Minor feature | One worker owns investigation, implementation, and focused verification |
| Large feature | One worker for planning/investigation first; sibling workers only if the plan exposes independent top-level streams (e.g. separate backend and frontend) |
| Broad review | Multiple siblings only when independent coverage is the goal |
| One long shell command, no follow-up | Background shell is acceptable instead of a subagent |

Only skip delegation when the user is very explicit, e.g. "Do not delegate..." or "Do this work yourself..."

## Additional resources

- Task subagent model defaults and PR constraints: [subagent-defaults.md](subagent-defaults.md)
