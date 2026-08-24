# AgentBoard AI Assets

This directory contains AgentBoard-owned built-in AI assets.

Rules:

- Use Markdown only.
- Keep provider-specific execution details out of these files.
- Keep built-in assets separate from project or user assets such as `.claude/skills`.
- Runtime loaders must normalize these files before handing them to Engine code.

Current asset groups:

- `skills/` contains built-in reusable skills.
- `concerns/` contains phase-scoped quality concern packs.

Role prompts and provider-specific runtime prompt fragments remain in the legacy runtime until the prompt loader migration is complete.
