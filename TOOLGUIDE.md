# Daily Shit List (DSL) - Agent Tool Guide

## API Endpoint
```
POST https://tremendous-labrador-731.convex.site/api
Content-Type: application/json
```

## Quick Start
```json
{"op": "help"}      // Get full API documentation
{"op": "projects"}  // List existing projects
{"op": "active"}    // Get all non-done tasks
```

## Core Operations

### Reading
| Operation | Example | Description |
|-----------|---------|-------------|
| `help` | `{"op": "help"}` | API documentation |
| `projects` | `{"op": "projects"}` | List projects with task counts |
| `active` | `{"op": "active"}` | All non-done tasks |
| `list` | `{"op": "list"}` | All tasks grouped by project |
| `find` | `{"op": "find", "q": "MCP"}` | Search by title |
| `get` | `{"op": "get", "title": "MCP server"}` | Get single task |

### Writing
| Operation | Example | Description |
|-----------|---------|-------------|
| `add` | `{"op": "add", "title": "Fix bug", "project": "Backend", "note": "optional"}` | Create task |
| `done` | `{"op": "done", "title": "Fix bug"}` | Mark completed |
| `start` | `{"op": "start", "title": "Fix bug"}` | Set to in_flight |
| `block` | `{"op": "block", "title": "Fix bug", "reason": "waiting on API"}` | Set to blocked |
| `unblock` | `{"op": "unblock", "title": "Fix bug"}` | Set to planned |
| `reopen` | `{"op": "reopen", "title": "Fix bug"}` | Undo done |
| `note` | `{"op": "note", "title": "Fix bug", "text": "Found root cause"}` | Add note |
| `delete` | `{"op": "delete", "title": "Fix bug"}` | Delete task |

## Task Lookup
- Use `title` for fuzzy matching (partial titles work)
- Use `id` for exact ID matching
- Add `"exact": true` to force first match if ambiguous

## Statuses
`planned` | `in_flight` | `blocked` | `done`

## Tips
- Ambiguous titles return error with match list
- All mutations return the updated task
- Projects are auto-created when you add tasks
