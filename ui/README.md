# Daily Shit List - UI

## Overview

Read-only visualization dashboard for the Daily Shit List. This UI is for humans to see task state - all data manipulation happens via the API (used by agents).

## Tech Stack

- React 19 + TypeScript
- Vite 7
- Tailwind CSS 4
- Convex React client (WebSocket subscriptions)

## Architecture

```
App.tsx
├── ConvexProvider (WebSocket connection)
└── Dashboard
    ├── Header (stats: in_flight, blocked, planned, done)
    ├── Project sections (collapsible)
    │   ├── Progress bar
    │   └── Task list (expandable notes)
    └── Completed section (collapsed by default)
```

## Key Design Decisions

1. **Read-only** - No buttons/forms for data manipulation. All changes via API.
2. **Real-time** - Uses Convex `useQuery` for WebSocket subscriptions. Updates push automatically.
3. **Live indicator** - Pulsing green dot shows WebSocket is connected.
4. **Expandable notes** - Click "+ N notes" to see full note content.
5. **Project grouping** - Tasks grouped by project, sorted by status (in_flight first).

## Files

- **src/App.tsx** - Single component with all UI logic
- **src/App.css** - Tailwind imports
- **vite.config.ts** - Dev server config + path alias for Convex types

## Development

```bash
# Install deps
npm install

# Start dev server (port 5175)
npm run dev

# Build for production
npm run build
```

## Convex Connection

The UI connects to Convex cloud:
```typescript
const convex = new ConvexReactClient('https://tremendous-labrador-731.convex.cloud')
```

It subscribes to `api.planner.list` which returns all tasks grouped by project with stats.

## Styling

Uses Tailwind with a dark theme:
- Background: `neutral-950`
- Cards: `neutral-900/50` with `neutral-800` borders
- Status colors: blue (in_flight), rose (blocked), neutral (planned), emerald (done)

## Making Changes

1. Edit `src/App.tsx`
2. Dev server hot-reloads
3. Build and commit when done
4. UI is served from wherever you deploy the static build
