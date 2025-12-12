import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Valid operations for suggestion matching
const VALID_OPS = [
  "help", "projects", "active", "list", "find", "get", "export",
  "add", "done", "complete", "reopen", "start", "block", "unblock",
  "status", "note", "rename", "delete", "deleteMany", "purge", "batch", "activate", "import"
];

// Suggest similar operations when user provides invalid op name
function suggestOp(invalidOp: string): string | null {
  if (!invalidOp) return null;
  const lower = invalidOp.toLowerCase();

  // Check for exact match (shouldn't happen but safety first)
  if (VALID_OPS.includes(lower)) return null;

  const suggestions: string[] = [];

  for (const op of VALID_OPS) {
    // Starts with match: "fin" -> "find"
    if (op.startsWith(lower) || lower.startsWith(op)) {
      suggestions.push(op);
      continue;
    }
    // Contains match: "ist" -> "list"
    if (op.includes(lower) || lower.includes(op)) {
      suggestions.push(op);
      continue;
    }
    // Common typos and aliases
    if (
      (lower === "finish" && op === "done") ||
      (lower === "completed" && op === "complete") ||
      (lower === "remove" && op === "delete") ||
      (lower === "search" && op === "find") ||
      (lower === "create" && op === "add") ||
      (lower === "new" && op === "add") ||
      (lower === "update" && op === "status") ||
      (lower === "edit" && op === "rename") ||
      (lower === "all" && op === "list") ||
      (lower === "tasks" && op === "list") ||
      (lower === "begin" && op === "start") ||
      (lower === "stop" && op === "block") ||
      (lower === "clear" && op === "purge")
    ) {
      suggestions.push(op);
    }
  }

  // Return first unique suggestion
  return suggestions.length > 0 ? suggestions[0] : null;
}

// Clean task for output - remove internal fields, add useful computed ones
function cleanTask(task: any) {
  if (!task) return null;
  const { _creationTime, ...rest } = task;
  // Explicitly include blockedReason as null when not blocked (for API clarity)
  if (rest.status !== "blocked" && rest.blockedReason === undefined) {
    rest.blockedReason = null;
  }
  return rest;
}

// POST /api - Command interface optimized for agent use
// Supports both id and title for task lookup (title uses first match)
http.route({
  path: "/api",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { op, ...args } = body;

    // Helper to resolve task ID from either id or title
    // Returns { id, matches } - error if ambiguous (multiple matches, no exact)
    async function resolveTaskId(): Promise<{ id: Id<"tasks"> | null; matches?: any[]; error?: string }> {
      if (args.id) return { id: args.id as Id<"tasks"> };
      if (args.title) {
        const matches = await ctx.runQuery(api.planner.find, { q: args.title });
        if (matches.length === 0) return { id: null, error: "No task found matching: " + args.title };

        // Exact match (case-insensitive) always wins
        const exact = matches.find((t: any) => t.title.toLowerCase() === args.title.toLowerCase());
        if (exact) return { id: exact._id };

        // Multiple partial matches = ambiguous, unless exact: true forces first match
        if (matches.length > 1 && !args.exact) {
          return {
            id: null,
            matches: matches.map((t: any) => ({ id: t._id, title: t.title, project: t.project, status: t.status })),
            error: `Ambiguous: "${args.title}" matches ${matches.length} tasks. Use exact title, id field, or add exact:true to use first match.`
          };
        }

        return { id: matches[0]._id };
      }
      return { id: null, error: "Need id or title" };
    }

    try {
      switch (op) {
        // add <title> <project> [note]
        case "add": {
          if (!args.title || !args.project) {
            return json({ error: "Need title and project" }, 400);
          }

          // Case-insensitive project matching to avoid duplicates
          const projectLookup = await ctx.runQuery(api.planner.findProjectByName, {
            name: args.project,
          });

          // Use existing project name if found (preserves canonical casing)
          const projectName = projectLookup.match || args.project;
          const projectCreated = !projectLookup.match;

          const id = await ctx.runMutation(api.planner.add, {
            title: args.title,
            project: projectName,
            note: args.note,
          });
          const task = await ctx.runQuery(api.planner.get, { taskId: id });

          // Build response with helpful feedback
          const response: any = { ok: true, task: cleanTask(task), projectCreated };
          if (!projectLookup.match && projectLookup.suggestions.length > 0) {
            response.note = `Created new project "${projectName}". Did you mean one of these? ${projectLookup.suggestions.join(", ")}`;
            response.suggestions = projectLookup.suggestions;
          } else if (projectLookup.match && projectLookup.match !== args.project) {
            response.note = `Used existing project "${projectLookup.match}" (matched from "${args.project}")`;
          }

          return json(response);
        }

        // done|complete <id|title> - mark task done
        case "done":
        case "complete": {
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          await ctx.runMutation(api.planner.done, { taskId: resolved.id });
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json({ ok: true, task: cleanTask(task) });
        }

        // reopen <id|title> - undo done, set back to planned
        case "reopen": {
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          await ctx.runMutation(api.planner.status, { taskId: resolved.id, status: "planned" });
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json({ ok: true, task: cleanTask(task) });
        }

        // start <id|title> - shortcut for status: in_flight
        case "start": {
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          await ctx.runMutation(api.planner.status, { taskId: resolved.id, status: "in_flight" });
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json({ ok: true, task: cleanTask(task) });
        }

        // block <id|title> [reason] - shortcut for status: blocked
        case "block": {
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          await ctx.runMutation(api.planner.status, { taskId: resolved.id, status: "blocked", reason: args.reason });
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json({ ok: true, task: cleanTask(task) });
        }

        // unblock <id|title> - shortcut for status: planned (clears blocked)
        case "unblock": {
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          await ctx.runMutation(api.planner.status, { taskId: resolved.id, status: "planned" });
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json({ ok: true, task: cleanTask(task) });
        }

        // status <id|title> <status> [reason]
        case "status": {
          if (!args.status) return json({ error: "Need status" }, 400);
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          await ctx.runMutation(api.planner.status, {
            taskId: resolved.id,
            status: args.status,
            reason: args.reason,
          });
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json({ ok: true, task: cleanTask(task) });
        }

        // note <id|title> <text>
        case "note": {
          if (!args.text) return json({ error: "Need text" }, 400);
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          await ctx.runMutation(api.planner.note, { taskId: resolved.id, text: args.text });
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json({ ok: true, task: cleanTask(task) });
        }

        // rename <id|title> <newTitle>
        case "rename": {
          if (!args.newTitle) return json({ error: "Need newTitle" }, 400);
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          await ctx.runMutation(api.planner.rename, { taskId: resolved.id, title: args.newTitle });
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json({ ok: true, task: cleanTask(task) });
        }

        // delete <id|title>
        case "delete": {
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          // Fetch task details before deletion for audit/confirmation
          const taskToDelete = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          await ctx.runMutation(api.planner.deleteTask, { taskId: resolved.id });
          return json({ ok: true, deleted: cleanTask(taskToDelete) });
        }

        // purge - delete all done tasks
        case "purge": {
          const result = await ctx.runMutation(api.planner.purge, {});
          return json(result);
        }

        // deleteMany <q> [status] - bulk delete matching tasks
        // q can be a string or array of strings (OR matching)
        case "deleteMany": {
          if (!args.q) return json({ error: "Need q (search query - string or array of strings)" }, 400);
          const result = await ctx.runMutation(api.planner.deleteMany, { q: args.q, status: args.status });
          return json(result);
        }

        // activate <id|title> - unblock if blocked, then set to in_flight
        case "activate": {
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          const result = await ctx.runMutation(api.planner.activate, { taskId: resolved.id });
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json({ ok: true, task: cleanTask(task), previousStatus: result.previousStatus });
        }

        // find <q> [status] - search tasks by title
        // q can be a string or array of strings (OR matching)
        case "find": {
          if (!args.q) return json({ error: "Need q (search query - string or array of strings)" }, 400);
          const tasks = await ctx.runQuery(api.planner.find, { q: args.q, status: args.status });
          const count = tasks.length;
          const queryDisplay = Array.isArray(args.q) ? args.q.join("' or '") : args.q;
          if (count === 0) {
            return json({ tasks: [], count: 0, message: `No tasks found matching '${queryDisplay}'` });
          }
          return json({ tasks: tasks.map(cleanTask), count });
        }

        // active - get all non-done tasks (most useful for agents)
        case "active": {
          const tasks = await ctx.runQuery(api.planner.active, {});
          return json({ tasks: tasks.map(cleanTask) });
        }

        // list - get all tasks grouped by project (with optional filters)
        case "list": {
          const result = await ctx.runQuery(api.planner.list, {
            project: args.project,
            status: args.status,
          });
          // Clean tasks in the response
          const cleanedTasks: Record<string, any[]> = {};
          for (const [project, tasks] of Object.entries(result.tasks)) {
            cleanedTasks[project] = (tasks as any[]).map(cleanTask);
          }
          return json({ tasks: cleanedTasks, stats: result.stats });
        }

        // get <id|title>
        case "get": {
          const resolved = await resolveTaskId();
          if (!resolved.id) return json({ error: resolved.error, matches: resolved.matches }, 400);
          const task = await ctx.runQuery(api.planner.get, { taskId: resolved.id });
          return json(cleanTask(task) || { error: "Not found" });
        }

        // batch - execute multiple operations
        case "batch": {
          if (!args.ops || !Array.isArray(args.ops)) {
            return json({ error: "Need ops array" }, 400);
          }
          const results: any[] = [];
          for (const subOp of args.ops) {
            // Recursively handle each op (simple implementation)
            const { op: subOpName, ...subArgs } = subOp;
            try {
              // For batch, we just track success/failure
              switch (subOpName) {
                case "done": {
                  const matches = await ctx.runQuery(api.planner.find, { q: subArgs.title || "" });
                  const taskId = subArgs.id || (matches[0]?._id);
                  if (taskId) {
                    await ctx.runMutation(api.planner.done, { taskId });
                    results.push({ op: subOpName, ok: true, title: subArgs.title });
                  } else {
                    results.push({ op: subOpName, ok: false, error: "Not found" });
                  }
                  break;
                }
                case "add": {
                  // Case-insensitive project matching for batch adds
                  const batchProjectLookup = await ctx.runQuery(api.planner.findProjectByName, {
                    name: subArgs.project,
                  });
                  const batchProjectName = batchProjectLookup.match || subArgs.project;

                  const id = await ctx.runMutation(api.planner.add, {
                    title: subArgs.title,
                    project: batchProjectName,
                    note: subArgs.note,
                  });
                  results.push({
                    op: subOpName,
                    ok: true,
                    id,
                    projectUsed: batchProjectName,
                    projectCreated: !batchProjectLookup.match,
                  });
                  break;
                }
                default:
                  results.push({ op: subOpName, ok: false, error: "Unsupported in batch" });
              }
            } catch (e) {
              results.push({ op: subOpName, ok: false, error: String(e) });
            }
          }
          return json({ ok: true, results });
        }

        // projects - list all projects with stats (for agent onboarding)
        case "projects": {
          const projects = await ctx.runQuery(api.planner.projects, {});
          return json({ projects });
        }

        // export - export all tasks for backup
        case "export": {
          const result = await ctx.runQuery(api.planner.exportTasks, {});
          return json(result);
        }

        // import - import tasks from backup
        // mode: "replace" (delete all, import new), "merge" (update existing, add new), "append" (add all)
        case "import": {
          if (!args.data) return json({ error: "Need data (export format)" }, 400);
          if (!args.mode) return json({ error: "Need mode: replace|merge|append" }, 400);
          const validModes = ["replace", "merge", "append"];
          if (!validModes.includes(args.mode)) {
            return json({ error: `Invalid mode: ${args.mode}. Valid: ${validModes.join(", ")}` }, 400);
          }
          const result = await ctx.runMutation(api.planner.importTasks, {
            data: args.data,
            mode: args.mode,
          });
          return json(result);
        }

        // help - API documentation for agent onboarding
        case "help": {
          return json({
            description: "Daily Shit List - Task management API for agents",
            onboarding: [
              "1. Call 'projects' to see existing projects (avoid typos when adding tasks)",
              "2. Call 'active' to see current non-done tasks",
              "3. Use exact titles or add exact:true when title is ambiguous",
            ],
            operations: {
              // Queries (read-only)
              help: "This documentation",
              projects: "List all projects with task counts",
              active: "Get all non-done tasks sorted by status",
              list: { args: "[project], [status]", desc: "Get tasks grouped by project. Filter by project name and/or status: planned|in_flight|blocked|done" },
              find: { args: "q (string|string[]), [status]", desc: "Search tasks by title substring. q can be array for OR matching. Returns count and matched tasks. Filter by status: planned|in_flight|blocked|done" },
              get: { args: "id|title", desc: "Get single task" },
              export: { args: "none", desc: "Export all tasks as JSON for backup. Returns {version, exportedAt, taskCount, tasks[]}" },

              // Mutations (write)
              add: { args: "title, project, [note]", desc: "Create new task. Project matching is case-insensitive (uses existing project if found)" },
              done: { args: "id|title, [exact]", desc: "Mark task completed (alias: complete)" },
              complete: { args: "id|title, [exact]", desc: "Alias for done - mark task completed" },
              reopen: { args: "id|title", desc: "Undo done, set back to planned" },
              start: { args: "id|title", desc: "Set status to in_flight" },
              block: { args: "id|title, [reason]", desc: "Set status to blocked" },
              unblock: { args: "id|title", desc: "Set status to planned" },
              status: { args: "id|title, status, [reason]", desc: "Set any status" },
              note: { args: "id|title, text", desc: "Add note to task" },
              rename: { args: "id|title, newTitle", desc: "Rename task" },
              delete: { args: "id|title", desc: "Delete task" },
              deleteMany: { args: "q (string|string[]), [status]", desc: "Bulk delete tasks matching search. q can be array for OR matching" },
              purge: { args: "none", desc: "Delete all done tasks" },
              activate: { args: "id|title", desc: "Unblock if blocked, then set to in_flight (combined unblock+start)" },
              batch: { args: "ops[]", desc: "Execute multiple operations" },
              import: { args: "data, mode", desc: "Import tasks from export. mode: replace (delete all, import new), merge (update existing by title+project, add new), append (add all as new)" },
            },
            statuses: ["planned", "in_flight", "blocked", "done"],
            schemas: {
              task: {
                _id: "string (Convex document ID)",
                title: "string",
                project: "string",
                status: "planned|in_flight|blocked|done",
                notes: "[{t: ISO timestamp, text: string}] - array of timestamped notes (multiple supported)",
                createdAt: "ISO timestamp",
                updatedAt: "ISO timestamp",
                completedAt: "ISO timestamp (present when status=done)",
                blockedReason: "string|null (present when status=blocked)",
              },
              errorResponse: {
                format: "{error: string, matches?: array}",
                description: "Error responses include 'error' message. Ambiguous title lookups include 'matches' array with potential task matches.",
                example: { error: "Ambiguous: 'api' matches 3 tasks", matches: [{ id: "...", title: "...", project: "...", status: "..." }] },
              },
            },
            search: {
              caseSensitivity: "Title search is case-INSENSITIVE ('mcp' matches 'MCP Server')",
              partialMatching: "Partial title matching is supported ('auth' matches 'Fix authentication bug')",
              exactMatch: "Exact case-insensitive match is prioritized when multiple results found",
            },
            projectMatching: {
              caseInsensitive: "Project names are matched case-insensitively ('api ergonomics' matches 'API Ergonomics')",
              preserveCanonical: "When matched, uses the existing project's canonical casing",
              suggestions: "If no exact match, similar project names are suggested in response",
            },
            tips: [
              "Use title-based lookup: {op:'done', title:'MCP server'}",
              "Partial titles work but must be unambiguous",
              "Add exact:true to force first match if ambiguous",
              "Response always includes updated task for verification",
              "Find returns count field: {tasks: [...], count: N}",
              "Find supports array queries: {op:'find', q:['bug','fix']} matches tasks with 'bug' OR 'fix'",
              "Project names are matched case-insensitively to avoid duplicates",
              "add response includes projectCreated (boolean) and note (if matched/suggested)",
              "Aliases: 'complete' works same as 'done'",
              "Use 'activate' to unblock+start in one call: {op:'activate', title:'Task name'}",
              "Use 'deleteMany' for bulk deletes: {op:'deleteMany', q:'test'} deletes all matching 'test'",
              "GET /api returns list view (same as POST with op:'list')",
              "Use 'export' to backup all tasks: {op:'export'} returns JSON backup",
              "Use 'import' to restore from backup: {op:'import', data:<export>, mode:'replace|merge|append'}",
            ],
          });
        }

        default: {
          const suggestion = suggestOp(op);
          const errorMsg = suggestion
            ? `Unknown op: ${op}. Did you mean '${suggestion}'?`
            : `Unknown op: ${op}. Valid: help, projects, active, list, find, get, export, add, done, complete, reopen, start, block, unblock, status, note, rename, delete, deleteMany, purge, activate, batch, import`;
          return json({ error: errorMsg }, 400);
        }
      }
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Error" }, 500);
    }
  }),
});

// GET /api - Quick list view (cleaned output)
http.route({
  path: "/api",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runQuery(api.planner.list, {});
    const cleanedTasks: Record<string, any[]> = {};
    for (const [project, tasks] of Object.entries(result.tasks)) {
      cleanedTasks[project] = (tasks as any[]).map(cleanTask);
    }
    return json({ tasks: cleanedTasks, stats: result.stats });
  }),
});

http.route({
  path: "/api",
  method: "OPTIONS",
  handler: httpAction(async () => {
    // Return list of valid operations for API discovery
    const operations = {
      queries: ["help", "projects", "active", "list", "find", "get", "export"],
      mutations: ["add", "done", "complete", "reopen", "start", "block", "unblock", "status", "note", "rename", "delete", "deleteMany", "purge", "activate", "batch", "import"],
      statuses: ["planned", "in_flight", "blocked", "done"],
    };
    return new Response(JSON.stringify({ operations }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }),
});

export default http;
