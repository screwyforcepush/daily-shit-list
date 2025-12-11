Here’s a first cut of the spec as a drop-in `planner-protocol-v1.md`.
I’ve written it assuming a “proper” schema (tasks/notes/events) – no giant JSON blobs.

---

# Daily Shit List Planner – Protocol v1

**Status:** Draft
**Owner:** Alex
**Domain:** Personal task planner (“Daily Shit List”)
**Audience:** Backend/Frontend devs, Agent/LLM prompt authors

---

## 1. Purpose & Scope

This spec defines:

* The **data model** for the “Daily Shit List” (DSL) planner.
* The **command protocol** that LLMs/agents use to update planner state.
* The **HTTP contract** between clients (ChatGPT, Claude, Gemini, UI) and the backend.
* Behavioural rules so multiple agents can safely share one canonical planner.

The core principle:

> **Planner state lives in the backend schema, not in any single chat/session.**
> Chats, voice, and local UIs are just clients emitting commands to mutate that shared state.

This spec assumes a Convex project, but the schema is relational/collection-based and portable to other backends.

---

## 2. Core Concepts

### 2.1 User

* **User** = an identity in the system.
* For v1 this is effectively a single hard-coded user (`"alex"`), but the schema MUST support `userId` so multi-user is possible later.

### 2.2 Task

A **task** is a small, actionable item (not a project/epic). Examples:

* “Show agent notification subscription status in dashboard”
* “Create Gemini and Codex adapter”
* “Book school concert tickets”

Tasks belong to:

* A **user**
* A **stream** (work lane / context, e.g. `crankshaft`, `agentic`, `personal`)

Tasks have a lifecycle controlled by `status`:

* `active` – in play / on the radar
* `done` – completed
* `blocked` – cannot proceed due to external dependency
* `parked` – not active today; “someday / later”

### 2.3 Stream

A **stream** is a high-level lane/category.

* Examples:

  * `crankshaft`
  * `agentic`
  * `webtrack`
  * `personal`
* Streams are stored as strings; no separate table required in v1.
* Streams MUST be treated as **case-insensitive** identifiers.

### 2.4 Note

A **note** is a short piece of free-form text attached to a task.

* Used for context, links, micro-updates (“Waiting on James for credentials”, “Pinged Cindy 2025-12-11”).
* Notes are immutable after creation (no in-place edit in v1).

### 2.5 Event

An **event** is an append-only audit log entry that captures planner changes.

* Examples:

  * Task created
  * Status changed
  * Note added
  * Sweep performed
* Used for debugging, analytics, and “what did the agent just do?” review.

---

## 3. Data Model (Schema)

This section describes tables/collections. Field names are normative; internal IDs can follow the datastore’s convention.

Types are conceptual, not language-specific.

### 3.1 `tasks` table

Each row = one task.

**Fields**

* `id`: string

  * Backend-generated canonical ID (e.g. Convex document id).
  * Global within the project.
* `userId`: string

  * e.g. `"alex"`.
* `stream`: string

  * e.g. `"crankshaft"`, `"agentic"`, `"personal"`.
* `title`: string

  * Human-readable description of the task.
* `status`: enum

  * `"active" | "done" | "blocked" | "parked"`.
* `blockedReason`: string | null

  * Human explanation if `status === "blocked"`.
* `priority`: integer | null

  * Optional; lower number = higher priority (or vice versa; define when you use it).
* `createdAt`: ISO 8601 string or numeric timestamp
* `updatedAt`: ISO 8601 string or numeric timestamp
* `completedAt`: ISO 8601 string or numeric timestamp | null

  * Only set when transitioning into `done`.

**Indexes (recommended)**

* By `userId` + `status`
* By `userId` + `stream` + `status`
* By `userId` + `createdAt`

### 3.2 `notes` table

Each row = one note on a task.

**Fields**

* `id`: string
* `taskId`: string (FK → `tasks.id`)
* `userId`: string
* `author`: string

  * e.g. `"alex"`, `"agent/chatgpt"`, `"agent/claude"`.
* `text`: string
* `createdAt`: timestamp

**Indexes**

* By `taskId`
* By `userId` + `createdAt`

### 3.3 `events` table

Append-only log of planner actions.

**Fields**

* `id`: string
* `userId`: string
* `type`: string (event type)

  * Suggested initial set:

    * `"task.add"`
    * `"task.statusChange"`
    * `"task.note"`
    * `"task.updateTitle"`
    * `"planner.sweep"`
  * MAY be extended in future versions.
* `taskId`: string | null
* `payload`: JSON

  * Arbitrary structured data describing the change (before/after, reason, etc.).
* `createdAt`: timestamp
* `source`: string

  * e.g. `"ui"`, `"gpt/alex-dsl-gpt"`, `"agent/claude"`, `"agent/gemini"`.

**Indexes**

* By `userId` + `createdAt`
* By `taskId` (optional but useful)

---

## 4. Planner Command Protocol

Agents/LLMs MUST NOT directly construct low-level DB operations.
Instead, they emit **high-level commands** in a small, fixed language.

### 4.1 Command envelope

All planner updates are sent as a single JSON object:

```json
{
  "version": "v1",
  "user_id": "alex",
  "commands": [ /* Command[] */ ]
}
```

* `version` MUST be `"v1"` for this spec.
* `user_id` is a logical user identifier (string).
* `commands` is an ordered list of high-level operations.

### 4.2 Supported command types

Each command is a JSON object with an `op` field and additional fields as required.

#### 4.2.1 `add`

Create a new task.

```json
{
  "op": "add",
  "stream": "crankshaft",
  "title": "Show agent notification subscription status in dashboard",
  "priority": 10
}
```

* `stream`: string – MUST be non-empty.
* `title`: string – MUST be non-empty.
* `priority`: optional integer.

Result: new row in `tasks` with status `active`.

#### 4.2.2 `done`

Mark an existing task as done.

```json
{
  "op": "done",
  "task_id": "task_abc123"
}
```

* `task_id`: string – MUST reference an existing `tasks.id`.

Result:

* `status` → `"done"`
* `completedAt` set (if not already)
* `updatedAt` updated

If `task_id` is unknown, the backend MUST treat this as a **no-op** and record an error in logs; the HTTP response SHOULD reflect that the command was not applied.

#### 4.2.3 `blocked`

Mark a task as blocked with a reason.

```json
{
  "op": "blocked",
  "task_id": "task_abc123",
  "reason": "Waiting on James to send API keys"
}
```

* `reason`: string – recommended, MAY be empty but SHOULD be provided.

Result:

* `status` → `"blocked"`
* `blockedReason` updated
* `updatedAt` updated

#### 4.2.4 `parked`

Move a task out of today’s focus.

```json
{
  "op": "parked",
  "task_id": "task_def456"
}
```

Result:

* `status` → `"parked"`
* `blockedReason` cleared
* `updatedAt` updated

#### 4.2.5 `note`

Append a note to a task.

```json
{
  "op": "note",
  "task_id": "task_ghi789",
  "text": "Ping again on Monday if no reply.",
  "author": "agent/chatgpt"
}
```

* `task_id`: required
* `text`: required
* `author`: optional; backend MAY override based on auth context.

Result:

* New row in `notes`
* `updatedAt` of the task MAY be updated.

#### 4.2.6 `rename`

Change a task’s title.

```json
{
  "op": "rename",
  "task_id": "task_ghi789",
  "title": "Refactor agentic harness runtime bleed"
}
```

Result: `title` updated.

#### 4.2.7 `sweep`

Perform housekeeping logic for the user’s planner.

```json
{
  "op": "sweep"
}
```

Sweeping behaviour MUST be deterministic and implemented on the backend.
Example behaviours (implementation detail, not protocol):

* Move `done` tasks older than N days into an archive or keep them but ignore in the “today” view.
* Auto-park `active` tasks that have not been touched in N days.
* Remove obviously junk/empty tasks.

No additional parameters in v1.

---

## 5. HTTP API Contract

LLM clients (e.g. Custom GPT Action, external agents) interact with the planner via HTTPS.

### 5.1 Base concepts

* All requests MUST be JSON.
* All responses MUST be JSON.
* Authentication via a static bearer or custom header (e.g. `X-DSL-API-Key`) is REQUIRED for any mutating operation.

This spec describes one primary endpoint:

* `POST /dsl/command` – apply a batch of commands and return an updated view.

Read-only endpoints (e.g. `GET /dsl/state`) are optional but recommended.

### 5.2 `POST /dsl/command`

**Request**

* Method: `POST`
* Path: `/dsl/command`
* Headers:

  * `Content-Type: application/json`
  * `X-DSL-API-Key: <secret>` (or equivalent)
* Body: a **command envelope** (Section 4.1)

Example:

```http
POST /dsl/command HTTP/1.1
Content-Type: application/json
X-DSL-API-Key: ****

{
  "version": "v1",
  "user_id": "alex",
  "commands": [
    {
      "op": "add",
      "stream": "agentic",
      "title": "Create Gemini and Codex adapter"
    },
    {
      "op": "blocked",
      "task_id": "task_abc123",
      "reason": "Waiting on James for partner access"
    },
    {
      "op": "note",
      "task_id": "task_abc123",
      "text": "Follow up again on Tuesday."
    },
    {
      "op": "sweep"
    }
  ]
}
```

**Response**

* Status:

  * `200` on success (even if some commands fail individually – see below).
  * `4xx/5xx` for general errors (invalid JSON, auth failure, backend issues).
* Body:

```json
{
  "ok": true,
  "version": "v1",
  "user_id": "alex",
  "results": [
    { "op": "add", "ok": true, "task_id": "task_xyz999" },
    { "op": "blocked", "ok": true, "task_id": "task_abc123" },
    { "op": "note", "ok": true, "task_id": "task_abc123", "note_id": "note_123" },
    { "op": "sweep", "ok": true }
  ],
  "view": {
    "streams": {
      "crankshaft": [ /* TaskSummary[] */ ],
      "agentic": [ /* TaskSummary[] */ ],
      "personal": [ /* TaskSummary[] */ ]
    },
    "stats": {
      "totalActive": 5,
      "totalDoneToday": 2,
      "blockedCount": 1
    }
  }
}
```

Where `TaskSummary` is:

```ts
type TaskSummary = {
  id: string;
  stream: string;
  title: string;
  status: "active" | "done" | "blocked" | "parked";
  blockedReason?: string | null;
  priority?: number | null;
  createdAt: string;
  updatedAt: string;
};
```

Error handling:

* If an individual command fails (bad `task_id`, invalid op, etc.), the corresponding `results[i]` MUST have `ok: false` and an `error` field:

```json
{ "op": "done", "ok": false, "error": "Task not found" }
```

* The backend SHOULD attempt to apply subsequent commands where reasonable (no full rollback for v1).

### 5.3 Optional: `GET /dsl/state?user_id=alex`

Read-only snapshot for debugging / external tools.

**Response:**

```json
{
  "version": "v1",
  "user_id": "alex",
  "view": {
    "streams": { /* same as /dsl/command */ },
    "stats": { /* same as /dsl/command */ }
  }
}
```

---

## 6. LLM / Agent Behaviour Guidelines

These rules are for any AI client using the planner protocol.

1. **Never invent state.**

   * Do not claim a task was updated unless `/dsl/command` returned `ok: true` for that command.
2. **Keep commands small.**

   * Prefer a small set of concrete operations (`add`, `done`, `blocked`, `note`, `sweep`) over rewriting entire task lists.
3. **Don’t re-send the full planner.**

   * The planner state is stored in the backend; clients should send **deltas** only.
4. **Use stable task IDs.**

   * When the user refers to “that agentic harness refactor task”:

     * If the backend included a `TaskSummary` with ID, prefer using that `id`.
     * If ambiguous, ask the user to disambiguate rather than guessing.
5. **Be explicit with reasons.**

   * When blocking a task, include a `reason` string where possible.
6. **Summarise after updates.**

   * After a `POST /dsl/command`, report back:

     * What commands were applied (“Added 1 task, blocked 1 task, added 1 note, swept old tasks…”).
     * A human-readable view of the current active tasks per stream.
7. **Do not change semantics of status.**

   * `done`, `active`, `blocked`, `parked` must keep their meanings across tools.

---

## 7. Example Interaction (Voice or Text)

User (via ChatGPT desktop voice):

> “Add a personal task to book school concert tickets.
> Mark the agentic harness refactor as done.
> Note on the Crankshaft notification task that I’m waiting on Mykhaylo.
> Then sweep old tasks so I only see what matters today.”

LLM constructs:

```json
{
  "version": "v1",
  "user_id": "alex",
  "commands": [
    { "op": "add", "stream": "personal", "title": "Book school concert tickets" },
    { "op": "done", "task_id": "task_agentic_refactor_123" },
    { "op": "note", "task_id": "task_crank_notif_456", "text": "Waiting on Mykhaylo for details." },
    { "op": "sweep" }
  ]
}
```

Backend responds with updated `view`.
LLM then answers verbally:

> “Got it. I added a personal task to book school concert tickets, marked the agentic harness refactor as done, added a note to the Crankshaft notification task, and swept old items.
> You now have 3 active Crankshaft tasks, 1 active agentic task, and 2 personal tasks. Here they are…”

---

## 8. Future Extensions (Out of Scope for v1)

The protocol is intentionally minimal. Future versions MAY add:

* `tags` / `labels` for tasks.
* Deadlines / soft dates (without becoming a calendar).
* Support for recurring tasks.
* More structured prioritisation fields.
* Multi-user sharing and per-stream ACLs.
* Richer `sweep` parameters (e.g. “archive-only” sweeps).

Any such changes MUST bump `version` (e.g. `"v2"`) and maintain backward compatibility via explicit branching in `/dsl/command`.

---

If you want, next step I can draft the skeleton Convex code (`convex/planner.ts` + `convex/http.ts`) that implements this spec so your agents just have to fill in the details.

