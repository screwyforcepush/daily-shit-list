import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Helper to get current ISO timestamp
function now(): string {
  return new Date().toISOString();
}

// Helper to normalize stream names (case-insensitive)
function normalizeStream(stream: string): string {
  return stream.toLowerCase().trim();
}

// ============ MUTATIONS ============

export const addTask = mutation({
  args: {
    userId: v.string(),
    stream: v.string(),
    title: v.string(),
    priority: v.optional(v.number()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const timestamp = now();
    const taskId = await ctx.db.insert("tasks", {
      userId: args.userId,
      stream: normalizeStream(args.stream),
      title: args.title,
      status: "active",
      blockedReason: null,
      priority: args.priority ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    });

    // Log event
    await ctx.db.insert("events", {
      userId: args.userId,
      type: "task.add",
      taskId,
      payload: { title: args.title, stream: args.stream, priority: args.priority },
      createdAt: timestamp,
      source: args.source,
    });

    return taskId;
  },
});

export const markDone = mutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      return { ok: false, error: "Task not found" };
    }

    const timestamp = now();
    const previousStatus = task.status;

    await ctx.db.patch(args.taskId, {
      status: "done",
      updatedAt: timestamp,
      completedAt: task.completedAt ?? timestamp,
      blockedReason: null,
    });

    await ctx.db.insert("events", {
      userId: args.userId,
      type: "task.statusChange",
      taskId: args.taskId,
      payload: { from: previousStatus, to: "done" },
      createdAt: timestamp,
      source: args.source,
    });

    return { ok: true };
  },
});

export const markBlocked = mutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
    reason: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      return { ok: false, error: "Task not found" };
    }

    const timestamp = now();
    const previousStatus = task.status;

    await ctx.db.patch(args.taskId, {
      status: "blocked",
      blockedReason: args.reason,
      updatedAt: timestamp,
    });

    await ctx.db.insert("events", {
      userId: args.userId,
      type: "task.statusChange",
      taskId: args.taskId,
      payload: { from: previousStatus, to: "blocked", reason: args.reason },
      createdAt: timestamp,
      source: args.source,
    });

    return { ok: true };
  },
});

export const markParked = mutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      return { ok: false, error: "Task not found" };
    }

    const timestamp = now();
    const previousStatus = task.status;

    await ctx.db.patch(args.taskId, {
      status: "parked",
      blockedReason: null,
      updatedAt: timestamp,
    });

    await ctx.db.insert("events", {
      userId: args.userId,
      type: "task.statusChange",
      taskId: args.taskId,
      payload: { from: previousStatus, to: "parked" },
      createdAt: timestamp,
      source: args.source,
    });

    return { ok: true };
  },
});

export const markActive = mutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      return { ok: false, error: "Task not found" };
    }

    const timestamp = now();
    const previousStatus = task.status;

    await ctx.db.patch(args.taskId, {
      status: "active",
      blockedReason: null,
      updatedAt: timestamp,
      completedAt: null,
    });

    await ctx.db.insert("events", {
      userId: args.userId,
      type: "task.statusChange",
      taskId: args.taskId,
      payload: { from: previousStatus, to: "active" },
      createdAt: timestamp,
      source: args.source,
    });

    return { ok: true };
  },
});

export const addNote = mutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
    text: v.string(),
    author: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      return { ok: false, error: "Task not found" };
    }

    const timestamp = now();

    const noteId = await ctx.db.insert("notes", {
      taskId: args.taskId,
      userId: args.userId,
      author: args.author,
      text: args.text,
      createdAt: timestamp,
    });

    // Update task's updatedAt
    await ctx.db.patch(args.taskId, {
      updatedAt: timestamp,
    });

    await ctx.db.insert("events", {
      userId: args.userId,
      type: "task.note",
      taskId: args.taskId,
      payload: { text: args.text, author: args.author, noteId },
      createdAt: timestamp,
      source: args.source,
    });

    return { ok: true, noteId };
  },
});

export const renameTask = mutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
    title: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      return { ok: false, error: "Task not found" };
    }

    const timestamp = now();
    const previousTitle = task.title;

    await ctx.db.patch(args.taskId, {
      title: args.title,
      updatedAt: timestamp,
    });

    await ctx.db.insert("events", {
      userId: args.userId,
      type: "task.updateTitle",
      taskId: args.taskId,
      payload: { from: previousTitle, to: args.title },
      createdAt: timestamp,
      source: args.source,
    });

    return { ok: true };
  },
});

export const sweep = mutation({
  args: {
    userId: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const timestamp = now();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Get all tasks for the user
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId_status", (q) => q.eq("userId", args.userId))
      .collect();

    let archivedCount = 0;
    let parkedCount = 0;

    for (const task of tasks) {
      // Auto-park active tasks not touched in 30 days
      if (task.status === "active" && task.updatedAt < thirtyDaysAgo) {
        await ctx.db.patch(task._id, {
          status: "parked",
          updatedAt: timestamp,
        });
        parkedCount++;
      }
    }

    await ctx.db.insert("events", {
      userId: args.userId,
      type: "planner.sweep",
      taskId: null,
      payload: { archivedCount, parkedCount },
      createdAt: timestamp,
      source: args.source,
    });

    return { ok: true, archivedCount, parkedCount };
  },
});

// ============ QUERIES ============

export const getState = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all tasks for user (excluding done tasks older than today for the "view")
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", args.userId))
      .collect();

    // Group by stream
    const streams: Record<string, Array<{
      id: string;
      stream: string;
      title: string;
      status: "active" | "done" | "blocked" | "parked";
      blockedReason?: string | null;
      priority?: number | null;
      createdAt: string;
      updatedAt: string;
    }>> = {};

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    let totalActive = 0;
    let totalDoneToday = 0;
    let blockedCount = 0;

    for (const task of tasks) {
      // Skip done tasks that were completed before today (for the view)
      if (task.status === "done" && task.completedAt && task.completedAt < todayIso) {
        continue;
      }

      if (!streams[task.stream]) {
        streams[task.stream] = [];
      }

      streams[task.stream].push({
        id: task._id,
        stream: task.stream,
        title: task.title,
        status: task.status,
        blockedReason: task.blockedReason,
        priority: task.priority,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });

      if (task.status === "active") totalActive++;
      if (task.status === "done" && task.completedAt && task.completedAt >= todayIso) totalDoneToday++;
      if (task.status === "blocked") blockedCount++;
    }

    // Sort tasks within each stream by priority (lower first), then by createdAt
    for (const stream of Object.keys(streams)) {
      streams[stream].sort((a, b) => {
        const priorityA = a.priority ?? Infinity;
        const priorityB = b.priority ?? Infinity;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.createdAt.localeCompare(b.createdAt);
      });
    }

    return {
      streams,
      stats: {
        totalActive,
        totalDoneToday,
        blockedCount,
      },
    };
  },
});

export const getTaskById = query({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      return null;
    }
    return task;
  },
});

export const getNotesForTask = query({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      return [];
    }

    const notes = await ctx.db
      .query("notes")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .collect();

    return notes;
  },
});
