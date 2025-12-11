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
    async function resolveTaskId(): Promise<Id<"tasks"> | null> {
      if (args.id) return args.id as Id<"tasks">;
      if (args.title) {
        const matches = await ctx.runQuery(api.planner.find, { q: args.title });
        if (matches.length === 0) return null;
        // Return first match (exact match preferred)
        const exact = matches.find((t: any) => t.title.toLowerCase() === args.title.toLowerCase());
        return (exact || matches[0])._id;
      }
      return null;
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
          const taskId = await resolveTaskId();
          if (!taskId) return json({ error: "Task not found. Provide id or title" }, 400);
          await ctx.runMutation(api.planner.done, { taskId });
          const task = await ctx.runQuery(api.planner.get, { taskId });
          return json({ ok: true, task: cleanTask(task) });
        }

        // start <id|title> - shortcut for status: in_flight
        case "start": {
          const taskId = await resolveTaskId();
          if (!taskId) return json({ error: "Task not found. Provide id or title" }, 400);
          await ctx.runMutation(api.planner.status, { taskId, status: "in_flight" });
          const task = await ctx.runQuery(api.planner.get, { taskId });
          return json({ ok: true, task: cleanTask(task) });
        }

        // block <id|title> [reason] - shortcut for status: blocked
        case "block": {
          const taskId = await resolveTaskId();
          if (!taskId) return json({ error: "Task not found. Provide id or title" }, 400);
          await ctx.runMutation(api.planner.status, { taskId, status: "blocked", reason: args.reason });
          const task = await ctx.runQuery(api.planner.get, { taskId });
          return json({ ok: true, task: cleanTask(task) });
        }

        // unblock <id|title> - shortcut for status: planned (clears blocked)
        case "unblock": {
          const taskId = await resolveTaskId();
          if (!taskId) return json({ error: "Task not found. Provide id or title" }, 400);
          await ctx.runMutation(api.planner.status, { taskId, status: "planned" });
          const task = await ctx.runQuery(api.planner.get, { taskId });
          return json({ ok: true, task: cleanTask(task) });
        }

        // status <id|title> <status> [reason]
        case "status": {
          if (!args.status) return json({ error: "Need status" }, 400);
          const taskId = await resolveTaskId();
          if (!taskId) return json({ error: "Task not found. Provide id or title" }, 400);
          await ctx.runMutation(api.planner.status, {
            taskId,
            status: args.status,
            reason: args.reason,
          });
          const task = await ctx.runQuery(api.planner.get, { taskId });
          return json({ ok: true, task: cleanTask(task) });
        }

        // note <id|title> <text>
        case "note": {
          if (!args.text) return json({ error: "Need text" }, 400);
          const taskId = await resolveTaskId();
          if (!taskId) return json({ error: "Task not found. Provide id or title" }, 400);
          await ctx.runMutation(api.planner.note, { taskId, text: args.text });
          const task = await ctx.runQuery(api.planner.get, { taskId });
          return json({ ok: true, task: cleanTask(task) });
        }

        // rename <id|title> <newTitle>
        case "rename": {
          if (!args.newTitle) return json({ error: "Need newTitle" }, 400);
          const taskId = await resolveTaskId();
          if (!taskId) return json({ error: "Task not found. Provide id or title" }, 400);
          await ctx.runMutation(api.planner.rename, { taskId, title: args.newTitle });
          const task = await ctx.runQuery(api.planner.get, { taskId });
          return json({ ok: true, task: cleanTask(task) });
        }

        // delete <id|title>
        case "delete": {
          const taskId = await resolveTaskId();
          if (!taskId) return json({ error: "Task not found. Provide id or title" }, 400);
          await ctx.runMutation(api.planner.deleteTask, { taskId });
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
          const taskId = await resolveTaskId();
          if (!taskId) return json({ error: "Task not found. Provide id or title" }, 400);
          const task = await ctx.runQuery(api.planner.get, { taskId });
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

        default:
          return json({ error: `Unknown op: ${op}. Valid: add, done, start, block, unblock, status, note, rename, delete, purge, find, active, list, get, batch` }, 400);
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
