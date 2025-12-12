# Convex Backend

## Overview

This is the Convex backend for the Daily Shit List. It provides:
- Real-time task storage with WebSocket subscriptions
- HTTP API for agent interactions
- Queries and mutations for task management

## Files

- **schema.ts** - Database schema (tasks table with indexes)
- **planner.ts** - Core queries and mutations (add, done, status, note, delete, etc.)
- **http.ts** - HTTP API handler that wraps planner functions for agent use

## Key Concepts

### Task Schema
```typescript
{
  title: string,
  project: string,
  status: "planned" | "in_flight" | "blocked" | "done",
  blockedReason?: string,
  notes: [{ t: timestamp, text: string }],
  createdAt: string,
  updatedAt: string,
  completedAt?: string
}
```

### Indexes
- `by_status` - Filter by status
- `by_project` - Filter by project
- `by_project_status` - Composite filter

## HTTP API

Endpoint: `POST https://tremendous-labrador-731.convex.site/api`

All operations use JSON body with `op` field. See TOOLGUIDE.md in repo root for full reference.

### Adding Operations

1. Add mutation/query to `planner.ts`
2. Add HTTP handler case in `http.ts`
3. Update TOOLGUIDE.md

Example mutation in planner.ts:
```typescript
export const myMutation = mutation({
  args: { taskId: v.id("tasks"), ... },
  handler: async (ctx, args) => {
    // ctx.db for database operations
    return { ok: true };
  },
});
```

Example HTTP handler in http.ts:
```typescript
case "myop": {
  const result = await ctx.runMutation(api.planner.myMutation, { ... });
  return json(result);
}
```

## Development

```bash
# Start dev server (watches for changes)
npx convex dev

# Deploy once
npx convex dev --once

# View dashboard
npx convex dashboard
```

## Real-time

The UI subscribes to `api.planner.list` via WebSocket. Any mutation that changes tasks will automatically push updates to connected clients.
