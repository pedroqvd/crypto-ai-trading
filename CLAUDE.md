## Critical Rule: NEVER Overwrite Existing Work
When asked to ADD new sections, components, or features, you MUST preserve all existing code. Read the current file first, understand its structure, then surgically add new code alongside it. NEVER replace or rewrite existing sections unless explicitly asked to. If unsure, ask before modifying.

## Development Workflow

## Surgical Edits Only
Do NOT rewrite or replace existing files. Only make additive, surgical edits. Before editing any file, first Read the entire file, then use the Edit tool to insert new code at specific locations. Never use the Write tool to overwrite an existing file. If adding a new dashboard section, identify the exact insertion points (imports, component declarations, JSX render locations, route registrations) and edit each one individually. Confirm the existing content is preserved after each edit by reading the file again.

## Incremental Changes Only
For UI work: make changes in small, testable increments. After each file edit, verify the existing functionality still works before proceeding. Never refactor or restructure code that wasn't part of the request.

## Code Standards

## TypeScript Conventions
- When handling API responses, always type them properly. Use `Record<string, any>` or specific interfaces for `response.json()` return values.
- This is a TypeScript-first project. Do not write untyped JavaScript.
