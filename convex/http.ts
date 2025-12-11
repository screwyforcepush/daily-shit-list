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

// Clean task for output - remove internal fields, add useful computed ones
function cleanTask(task: any) {
  if (!task) return null;
  const { _creationTime, ...rest } = task;
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
            matches: matches.map((t: any) => ({ title: t.title, project: t.project, status: t.status })),
            error: `Ambiguous: "${args.title}" matches ${matches.length} tasks. Use exact title or add exact:true to use first match.`
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
          const id = await ctx.runMutation(api.planner.add, {
            title: args.title,
            project: args.project,
            note: args.note,
          });
          const task = await ctx.runQuery(api.planner.get, { taskId: id });
          return json({ ok: true, task: cleanTask(task) });
        }

        // done <id|title> - mark task done
        case "done": {
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
          await ctx.runMutation(api.planner.deleteTask, { taskId: resolved.id });
          return json({ ok: true });
        }

        // purge - delete all done tasks
        case "purge": {
          const result = await ctx.runMutation(api.planner.purge, {});
          return json(result);
        }

        // find <q> [status] - search tasks by title
        case "find": {
          if (!args.q) return json({ error: "Need q (search query)" }, 400);
          const tasks = await ctx.runQuery(api.planner.find, { q: args.q, status: args.status });
          return json({ tasks: tasks.map(cleanTask) });
        }

        // active - get all non-done tasks (most useful for agents)
        case "active": {
          const tasks = await ctx.runQuery(api.planner.active, {});
          return json({ tasks: tasks.map(cleanTask) });
        }

        // list - get all tasks grouped by project
        case "list": {
          const result = await ctx.runQuery(api.planner.list, {});
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
                  const id = await ctx.runMutation(api.planner.add, {
                    title: subArgs.title,
                    project: subArgs.project,
                    note: subArgs.note,
                  });
                  results.push({ op: subOpName, ok: true, id });
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
              list: "Get all tasks grouped by project",
              find: { args: "q, [status]", desc: "Search tasks by title substring" },
              get: { args: "id|title", desc: "Get single task" },

              // Mutations (write)
              add: { args: "title, project, [note]", desc: "Create new task" },
              done: { args: "id|title, [exact]", desc: "Mark task completed" },
              reopen: { args: "id|title", desc: "Undo done, set back to planned" },
              start: { args: "id|title", desc: "Set status to in_flight" },
              block: { args: "id|title, [reason]", desc: "Set status to blocked" },
              unblock: { args: "id|title", desc: "Set status to planned" },
              status: { args: "id|title, status, [reason]", desc: "Set any status" },
              note: { args: "id|title, text", desc: "Add note to task" },
              rename: { args: "id|title, newTitle", desc: "Rename task" },
              delete: { args: "id|title", desc: "Delete task" },
              purge: { args: "none", desc: "Delete all done tasks" },
              batch: { args: "ops[]", desc: "Execute multiple operations" },
            },
            statuses: ["planned", "in_flight", "blocked", "done"],
            tips: [
              "Use title-based lookup: {op:'done', title:'MCP server'}",
              "Partial titles work but must be unambiguous",
              "Add exact:true to force first match if ambiguous",
              "Response always includes updated task for verification",
            ],
          });
        }

        default:
          return json({ error: `Unknown op: ${op}. Valid: help, projects, active, list, find, get, add, done, reopen, start, block, unblock, status, note, rename, delete, purge, batch` }, 400);
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
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});

export default http;
