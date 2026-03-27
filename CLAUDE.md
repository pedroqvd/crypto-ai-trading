## Critical Rule: NEVER Overwrite Existing Work
When asked to ADD new sections, components, or features, you MUST preserve all existing code. Read the current file first, understand its structure, then surgically add new code alongside it. NEVER replace or rewrite existing sections unless explicitly asked to. If unsure, ask before modifying.

## Development Workflow

## Incremental Changes Only
For UI work: make changes in small, testable increments. After each file edit, verify the existing functionality still works before proceeding. Never refactor or restructure code that wasn't part of the request.

## Code Standards

## TypeScript Conventions
- When handling API responses, always type them properly. Use `Record<string, any>` or specific interfaces for `response.json()` return values.
- This is a TypeScript-first project. Do not write untyped JavaScript.
