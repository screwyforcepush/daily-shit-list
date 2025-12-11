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

// POST /api - Command interface optimized for agent use
// Returns updated state after mutations for efficiency
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
          return json({ ok: true, task });
        }

        // done <task_id>
        case "done": {
          if (!args.id) return json({ error: "Need id" }, 400);
          await ctx.runMutation(api.planner.done, { taskId: args.id as Id<"tasks"> });
          const task = await ctx.runQuery(api.planner.get, { taskId: args.id as Id<"tasks"> });
          return json({ ok: true, task });
        }

        // status <task_id> <status> [reason]
        case "status": {
          if (!args.id || !args.status) return json({ error: "Need id and status" }, 400);
          await ctx.runMutation(api.planner.status, {
            taskId: args.id as Id<"tasks">,
            status: args.status,
            reason: args.reason,
          });
          const task = await ctx.runQuery(api.planner.get, { taskId: args.id as Id<"tasks"> });
          return json({ ok: true, task });
        }

        // note <task_id> <text>
        case "note": {
          if (!args.id || !args.text) return json({ error: "Need id and text" }, 400);
          await ctx.runMutation(api.planner.note, {
            taskId: args.id as Id<"tasks">,
            text: args.text,
          });
          const task = await ctx.runQuery(api.planner.get, { taskId: args.id as Id<"tasks"> });
          return json({ ok: true, task });
        }

        // rename <task_id> <title>
        case "rename": {
          if (!args.id || !args.title) return json({ error: "Need id and title" }, 400);
          await ctx.runMutation(api.planner.rename, {
            taskId: args.id as Id<"tasks">,
            title: args.title,
          });
          const task = await ctx.runQuery(api.planner.get, { taskId: args.id as Id<"tasks"> });
          return json({ ok: true, task });
        }

        // delete <task_id>
        case "delete": {
          if (!args.id) return json({ error: "Need id" }, 400);
          await ctx.runMutation(api.planner.deleteTask, { taskId: args.id as Id<"tasks"> });
          return json({ ok: true });
        }

        // purge - delete all done tasks
        case "purge": {
          const result = await ctx.runMutation(api.planner.purge, {});
          return json(result);
        }

        // list - get all tasks grouped by project
        case "list": {
          const result = await ctx.runQuery(api.planner.list, {});
          return json(result);
        }

        // get <task_id>
        case "get": {
          if (!args.id) return json({ error: "Need id" }, 400);
          const task = await ctx.runQuery(api.planner.get, { taskId: args.id as Id<"tasks"> });
          return json(task || { error: "Not found" });
        }

        default:
          return json({ error: `Unknown op: ${op}` }, 400);
      }
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Error" }, 500);
    }
  }),
});

// GET /api - Quick list view
http.route({
  path: "/api",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runQuery(api.planner.list, {});
    return json(result);
  }),
});

http.route({
  path: "/api",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});

export default http;
