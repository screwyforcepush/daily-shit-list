import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function now(): string {
  return new Date().toISOString();
}

// ============ MUTATIONS ============

export const add = mutation({
  args: {
    title: v.string(),
    project: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = now();
    const notes = args.note
      ? [{ t: timestamp, text: args.note }]
      : [];

    const taskId = await ctx.db.insert("tasks", {
      title: args.title,
      project: args.project,
      status: "planned",
      notes,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return taskId;
  },
});

export const done = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return { ok: false, error: "Task not found" };

    const timestamp = now();
    await ctx.db.patch(args.taskId, {
      status: "done",
      completedAt: timestamp,
      updatedAt: timestamp,
      blockedReason: undefined,
    });
    return { ok: true };
  },
});

export const status = mutation({
  args: {
    taskId: v.id("tasks"),
    status: v.union(
      v.literal("planned"),
      v.literal("in_flight"),
      v.literal("blocked"),
      v.literal("done")
    ),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return { ok: false, error: "Task not found" };

    const timestamp = now();
    const update: any = {
      status: args.status,
      updatedAt: timestamp,
    };

    if (args.status === "blocked" && args.reason) {
      update.blockedReason = args.reason;
    } else if (args.status !== "blocked") {
      update.blockedReason = undefined;
    }

    if (args.status === "done") {
      update.completedAt = timestamp;
    } else {
      update.completedAt = undefined;
    }

    await ctx.db.patch(args.taskId, update);
    return { ok: true };
  },
});

export const note = mutation({
  args: {
    taskId: v.id("tasks"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return { ok: false, error: "Task not found" };

    const timestamp = now();
    const notes = [...task.notes, { t: timestamp, text: args.text }];

    await ctx.db.patch(args.taskId, {
      notes,
      updatedAt: timestamp,
    });
    return { ok: true };
  },
});

export const rename = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return { ok: false, error: "Task not found" };

    await ctx.db.patch(args.taskId, {
      title: args.title,
      updatedAt: now(),
    });
    return { ok: true };
  },
});

export const deleteTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return { ok: false, error: "Task not found" };

    await ctx.db.delete(args.taskId);
    return { ok: true };
  },
});

export const purge = mutation({
  args: {},
  handler: async (ctx) => {
    const doneTasks = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "done"))
      .collect();

    let count = 0;
    for (const task of doneTasks) {
      await ctx.db.delete(task._id);
      count++;
    }

    return { ok: true, deleted: count };
  },
});

// ============ QUERIES ============

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").collect();

    // Group by project
    const byProject: Record<string, typeof tasks> = {};

    for (const task of tasks) {
      if (!byProject[task.project]) {
        byProject[task.project] = [];
      }
      byProject[task.project].push(task);
    }

    // Sort: in_flight first, then blocked, then planned, done last
    const statusOrder: Record<string, number> = { in_flight: 0, blocked: 1, planned: 2, done: 3 };
    for (const project of Object.keys(byProject)) {
      byProject[project].sort((a, b) => {
        const orderA = statusOrder[a.status] ?? 99;
        const orderB = statusOrder[b.status] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.createdAt.localeCompare(b.createdAt);
      });
    }

    const stats = {
      total: tasks.length,
      planned: tasks.filter(t => t.status === "planned").length,
      in_flight: tasks.filter(t => t.status === "in_flight").length,
      blocked: tasks.filter(t => t.status === "blocked").length,
      done: tasks.filter(t => t.status === "done").length,
    };

    return { tasks: byProject, stats };
  },
});

export const get = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.taskId);
  },
});

// Find tasks by title substring (case-insensitive)
export const find = query({
  args: { q: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const allTasks = await ctx.db.query("tasks").collect();
    const query = args.q.toLowerCase();

    return allTasks.filter(t => {
      const matchesTitle = t.title.toLowerCase().includes(query);
      const matchesStatus = !args.status || t.status === args.status;
      return matchesTitle && matchesStatus;
    });
  },
});

// Get active tasks (not done) - most common query for agents
export const active = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").collect();
    const active = tasks.filter(t => t.status !== "done");

    // Sort: in_flight first, then blocked, then planned
    const statusOrder: Record<string, number> = { in_flight: 0, blocked: 1, planned: 2 };
    active.sort((a, b) => {
      const orderA = statusOrder[a.status] ?? 99;
      const orderB = statusOrder[b.status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.createdAt.localeCompare(b.createdAt);
    });

    return active;
  },
});
