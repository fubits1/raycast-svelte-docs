# Svelte Docs Raycast Extension

Search Svelte/SvelteKit documentation in Raycast.

99% vibe-coded with Claude.

## Setup

> Node 24

```bash
pnpm install
pnpm run dev # already sufficient to be installed in Raycast
```

## Usage

Type "Search Svelte Docs" in Raycast, then add query. First result auto-selected with detail view.

## Implementation

- Parser: Raw markdown between headers
- Search: Keywords > titles > content
- Results: first result is auto-selected
- Detail view with markdown rendering
