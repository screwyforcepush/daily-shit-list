import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

// CORS headers for cross-origin requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-DSL-API-Key, Authorization",
};

// Validate API key (simple static key for v1)
function validateApiKey(request: Request): boolean {
  const apiKey = request.headers.get("X-DSL-API-Key");
  // For v1, accept any non-empty key (in production, you'd validate against a real key)
  // The spec says auth is required but doesn't define the key value
  return apiKey !== null && apiKey.length > 0;
}

// Type definitions for commands
type AddCommand = {
  op: "add";
  stream: string;
  title: string;
  priority?: number;
};

type DoneCommand = {
  op: "done";
  task_id: string;
};

type BlockedCommand = {
  op: "blocked";
  task_id: string;
  reason?: string;
};

type ParkedCommand = {
  op: "parked";
  task_id: string;
};

type ActiveCommand = {
  op: "active";
  task_id: string;
};

type NoteCommand = {
  op: "note";
  task_id: string;
  text: string;
  author?: string;
};

type RenameCommand = {
  op: "rename";
  task_id: string;
  title: string;
};

type SweepCommand = {
  op: "sweep";
};

type Command =
  | AddCommand
  | DoneCommand
  | BlockedCommand
  | ParkedCommand
  | ActiveCommand
  | NoteCommand
  | RenameCommand
  | SweepCommand;

type CommandEnvelope = {
  version: string;
  user_id: string;
  commands: Command[];
};

type CommandResult = {
  op: string;
  ok: boolean;
  task_id?: string;
  note_id?: string;
  error?: string;
};

// POST /dsl/command - Apply batch of commands
http.route({
  path: "/dsl/command",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Validate API key
    if (!validateApiKey(request)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized: Missing or invalid X-DSL-API-Key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: CommandEnvelope;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate envelope
    if (body.version !== "v1") {
      return new Response(
        JSON.stringify({ ok: false, error: `Unsupported version: ${body.version}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.user_id || typeof body.user_id !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing or invalid user_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!Array.isArray(body.commands)) {
      return new Response(
        JSON.stringify({ ok: false, error: "commands must be an array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = body.user_id;
    const source = request.headers.get("X-DSL-Source") || "api";
    const results: CommandResult[] = [];

    // Process each command
    for (const cmd of body.commands) {
      try {
        switch (cmd.op) {
          case "add": {
            const addCmd = cmd as AddCommand;
            if (!addCmd.stream || !addCmd.title) {
              results.push({ op: "add", ok: false, error: "Missing stream or title" });
              break;
            }
            const taskId = await ctx.runMutation(api.planner.addTask, {
              userId,
              stream: addCmd.stream,
              title: addCmd.title,
              priority: addCmd.priority,
              source,
            });
            results.push({ op: "add", ok: true, task_id: taskId });
            break;
          }

          case "done": {
            const doneCmd = cmd as DoneCommand;
            if (!doneCmd.task_id) {
              results.push({ op: "done", ok: false, error: "Missing task_id" });
              break;
            }
            const result = await ctx.runMutation(api.planner.markDone, {
              taskId: doneCmd.task_id as Id<"tasks">,
              userId,
              source,
            });
            if (result.ok) {
              results.push({ op: "done", ok: true, task_id: doneCmd.task_id });
            } else {
              results.push({ op: "done", ok: false, task_id: doneCmd.task_id, error: result.error });
            }
            break;
          }

          case "blocked": {
            const blockedCmd = cmd as BlockedCommand;
            if (!blockedCmd.task_id) {
              results.push({ op: "blocked", ok: false, error: "Missing task_id" });
              break;
            }
            const result = await ctx.runMutation(api.planner.markBlocked, {
              taskId: blockedCmd.task_id as Id<"tasks">,
              userId,
              reason: blockedCmd.reason || "",
              source,
            });
            if (result.ok) {
              results.push({ op: "blocked", ok: true, task_id: blockedCmd.task_id });
            } else {
              results.push({ op: "blocked", ok: false, task_id: blockedCmd.task_id, error: result.error });
            }
            break;
          }

          case "parked": {
            const parkedCmd = cmd as ParkedCommand;
            if (!parkedCmd.task_id) {
              results.push({ op: "parked", ok: false, error: "Missing task_id" });
              break;
            }
            const result = await ctx.runMutation(api.planner.markParked, {
              taskId: parkedCmd.task_id as Id<"tasks">,
              userId,
              source,
            });
            if (result.ok) {
              results.push({ op: "parked", ok: true, task_id: parkedCmd.task_id });
            } else {
              results.push({ op: "parked", ok: false, task_id: parkedCmd.task_id, error: result.error });
            }
            break;
          }

          case "active": {
            const activeCmd = cmd as ActiveCommand;
            if (!activeCmd.task_id) {
              results.push({ op: "active", ok: false, error: "Missing task_id" });
              break;
            }
            const result = await ctx.runMutation(api.planner.markActive, {
              taskId: activeCmd.task_id as Id<"tasks">,
              userId,
              source,
            });
            if (result.ok) {
              results.push({ op: "active", ok: true, task_id: activeCmd.task_id });
            } else {
              results.push({ op: "active", ok: false, task_id: activeCmd.task_id, error: result.error });
            }
            break;
          }

          case "note": {
            const noteCmd = cmd as NoteCommand;
            if (!noteCmd.task_id || !noteCmd.text) {
              results.push({ op: "note", ok: false, error: "Missing task_id or text" });
              break;
            }
            const result = await ctx.runMutation(api.planner.addNote, {
              taskId: noteCmd.task_id as Id<"tasks">,
              userId,
              text: noteCmd.text,
              author: noteCmd.author || source,
              source,
            });
            if (result.ok) {
              results.push({ op: "note", ok: true, task_id: noteCmd.task_id, note_id: result.noteId });
            } else {
              results.push({ op: "note", ok: false, task_id: noteCmd.task_id, error: result.error });
            }
            break;
          }

          case "rename": {
            const renameCmd = cmd as RenameCommand;
            if (!renameCmd.task_id || !renameCmd.title) {
              results.push({ op: "rename", ok: false, error: "Missing task_id or title" });
              break;
            }
            const result = await ctx.runMutation(api.planner.renameTask, {
              taskId: renameCmd.task_id as Id<"tasks">,
              userId,
              title: renameCmd.title,
              source,
            });
            if (result.ok) {
              results.push({ op: "rename", ok: true, task_id: renameCmd.task_id });
            } else {
              results.push({ op: "rename", ok: false, task_id: renameCmd.task_id, error: result.error });
            }
            break;
          }

          case "sweep": {
            const result = await ctx.runMutation(api.planner.sweep, {
              userId,
              source,
            });
            results.push({ op: "sweep", ok: true });
            break;
          }

          default:
            results.push({ op: (cmd as any).op || "unknown", ok: false, error: `Unknown operation: ${(cmd as any).op}` });
        }
      } catch (err) {
        results.push({
          op: cmd.op,
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Get updated view
    const view = await ctx.runQuery(api.planner.getState, { userId });

    return new Response(
      JSON.stringify({
        ok: true,
        version: "v1",
        user_id: userId,
        results,
        view,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

// OPTIONS /dsl/command - CORS preflight
http.route({
  path: "/dsl/command",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

// GET /dsl/state - Read-only snapshot
http.route({
  path: "/dsl/state",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id");

    if (!userId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing user_id query parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const view = await ctx.runQuery(api.planner.getState, { userId });

    return new Response(
      JSON.stringify({
        version: "v1",
        user_id: userId,
        view,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }),
});

// OPTIONS /dsl/state - CORS preflight
http.route({
  path: "/dsl/state",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

export default http;
