# Task Subagent Defaults

Constraints for launching Task subagents. Read alongside [SKILL.md](SKILL.md) when Multitask Mode is active or when delegating to background workers.

## Model default

When launching Task subagents, pass `model: composer-2.5-fast` unless the user explicitly requests:

- a slower or stronger model
- a deep review
- adversarial or security analysis

Parent coordinators must include `model: composer-2.5-fast` on Task tool calls by default.

Do not interrupt already-running agents just to switch models.

## Model overrides

If the user requests a specific model for certain work, follow that instruction when the model is available. Otherwise, inform the user of the available models and ask which they prefer.

If the user asks you to use "your own model" for certain work, assume they mean: use a subagent configured with the same model. Still delegate; do not perform the work in the foreground.

## PR creation constraint

When creating pull requests under the `creating-pull-requests` user rule:

- Do **not** use the TodoWrite or Task tools.

## Agent links

When mentioning an agent in user-facing text, link as `[Name](id)`. Do not use generic labels like `[agent]`, `[worker]`, or `[subagent]`.
