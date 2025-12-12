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

// Delete multiple tasks matching search query
// Supports single string or array of strings (OR matching)
export const deleteMany = mutation({
  args: {
    q: v.union(v.string(), v.array(v.string())),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allTasks = await ctx.db.query("tasks").collect();

    // Normalize query to array of lowercase terms
    const queries = Array.isArray(args.q)
      ? args.q.map(term => term.toLowerCase())
      : [args.q.toLowerCase()];

    const matchingTasks = allTasks.filter(t => {
      const titleLower = t.title.toLowerCase();
      // Match if ANY term matches (OR logic)
      const matchesTitle = queries.some(query => titleLower.includes(query));
      const matchesStatus = !args.status || t.status === args.status;
      return matchesTitle && matchesStatus;
    });

    const deleted: Array<{ id: string; title: string }> = [];
    for (const task of matchingTasks) {
      await ctx.db.delete(task._id);
      deleted.push({ id: task._id, title: task.title });
    }

    return { ok: true, deleted, count: deleted.length };
  },
});

// Activate a task: unblock if blocked, then set to in_flight
export const activate = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return { ok: false, error: "Task not found" };

    const timestamp = now();
    await ctx.db.patch(args.taskId, {
      status: "in_flight",
      updatedAt: timestamp,
      blockedReason: undefined,
      completedAt: undefined,
    });
    return { ok: true, previousStatus: task.status };
  },
});

// ============ QUERIES ============

export const list = query({
  args: {
    project: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("planned"),
      v.literal("in_flight"),
      v.literal("blocked"),
      v.literal("done")
    )),
  },
  handler: async (ctx, args) => {
    let tasks;

    // Use optimal index based on filter combination
    if (args.project && args.status) {
      // Both filters: use composite index
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project_status", (q) =>
          q.eq("project", args.project!).eq("status", args.status!)
        )
        .collect();
    } else if (args.project) {
      // Project filter only
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("project", args.project!))
        .collect();
    } else if (args.status) {
      // Status filter only
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      // No filters
      tasks = await ctx.db.query("tasks").collect();
    }

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
// Supports single string or array of strings (OR matching)
export const find = query({
  args: {
    q: v.union(v.string(), v.array(v.string())),
    status: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const allTasks = await ctx.db.query("tasks").collect();

    // Normalize query to array of lowercase terms
    const queries = Array.isArray(args.q)
      ? args.q.map(term => term.toLowerCase())
      : [args.q.toLowerCase()];

    return allTasks.filter(t => {
      const titleLower = t.title.toLowerCase();
      // Match if ANY term matches (OR logic)
      const matchesTitle = queries.some(query => titleLower.includes(query));
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

// Get list of all projects with task counts - for agent onboarding
export const projects = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").collect();

    const projectStats: Record<string, { total: number; active: number; done: number }> = {};

    for (const task of tasks) {
      if (!projectStats[task.project]) {
        projectStats[task.project] = { total: 0, active: 0, done: 0 };
      }
      projectStats[task.project].total++;
      if (task.status === "done") {
        projectStats[task.project].done++;
      } else {
        projectStats[task.project].active++;
      }
    }

    return Object.entries(projectStats)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.active - a.active); // Most active first
  },
});

// Find existing project by name (case-insensitive match)
// Returns the canonical project name if found, or suggestions if fuzzy match
export const findProjectByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const tasks = await ctx.db.query("tasks").collect();

    // Get unique project names
    const projectNames = [...new Set(tasks.map(t => t.project))];
    const inputLower = args.name.toLowerCase();

    // Look for exact case-insensitive match
    const exactMatch = projectNames.find(p => p.toLowerCase() === inputLower);
    if (exactMatch) {
      return { match: exactMatch, suggestions: [] };
    }

    // Look for fuzzy matches (starts with, contains)
    const suggestions = projectNames.filter(p => {
      const pLower = p.toLowerCase();
      // Starts with input
      if (pLower.startsWith(inputLower)) return true;
      // Input starts with project name
      if (inputLower.startsWith(pLower)) return true;
      // Contains input
      if (pLower.includes(inputLower)) return true;
      // Levenshtein-like: check if input is a substring with small edits
      // Simple heuristic: check word overlap
      const inputWords = inputLower.split(/\s+/);
      const pWords = pLower.split(/\s+/);
      const hasOverlap = inputWords.some(w => pWords.some(pw => pw.includes(w) || w.includes(pw)));
      return hasOverlap;
    });

    return { match: null, suggestions: suggestions.slice(0, 5) };
  },
});

// ============ EXPORT/IMPORT ============

// Export all tasks for backup
export const exportTasks = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").collect();

    // Transform tasks to export format (exclude internal _id, _creationTime)
    const exportedTasks = tasks.map(task => ({
      title: task.title,
      project: task.project,
      status: task.status,
      blockedReason: task.blockedReason,
      notes: task.notes,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    }));

    return {
      version: "1.0",
      exportedAt: now(),
      taskCount: tasks.length,
      tasks: exportedTasks,
    };
  },
});

// Import tasks from backup (supports replace, merge, append modes)
export const importTasks = mutation({
  args: {
    data: v.object({
      version: v.string(),
      exportedAt: v.string(),
      taskCount: v.number(),
      tasks: v.array(v.object({
        title: v.string(),
        project: v.string(),
        status: v.union(
          v.literal("planned"),
          v.literal("in_flight"),
          v.literal("blocked"),
          v.literal("done")
        ),
        blockedReason: v.optional(v.string()),
        notes: v.array(v.object({
          t: v.string(),
          text: v.string(),
        })),
        createdAt: v.string(),
        updatedAt: v.string(),
        completedAt: v.optional(v.string()),
      })),
    }),
    mode: v.union(
      v.literal("replace"),  // Delete all existing, import new
      v.literal("merge"),    // Update existing by title+project, add new
      v.literal("append")    // Add all as new tasks (even if duplicates)
    ),
  },
  handler: async (ctx, args) => {
    const { data, mode } = args;
    const timestamp = now();

    let deleted = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    if (mode === "replace") {
      // Delete all existing tasks
      const existingTasks = await ctx.db.query("tasks").collect();
      for (const task of existingTasks) {
        await ctx.db.delete(task._id);
        deleted++;
      }

      // Insert all imported tasks
      for (const task of data.tasks) {
        await ctx.db.insert("tasks", {
          title: task.title,
          project: task.project,
          status: task.status,
          blockedReason: task.blockedReason,
          notes: task.notes,
          createdAt: task.createdAt,
          updatedAt: timestamp,
          completedAt: task.completedAt,
        });
        created++;
      }
    } else if (mode === "merge") {
      // Get existing tasks for matching
      const existingTasks = await ctx.db.query("tasks").collect();
      const existingByKey = new Map<string, typeof existingTasks[0]>();
      for (const task of existingTasks) {
        const key = `${task.project.toLowerCase()}:${task.title.toLowerCase()}`;
        existingByKey.set(key, task);
      }

      for (const task of data.tasks) {
        const key = `${task.project.toLowerCase()}:${task.title.toLowerCase()}`;
        const existing = existingByKey.get(key);

        if (existing) {
          // Update existing task (merge notes, use imported status if different)
          const mergedNotes = [...existing.notes];
          for (const note of task.notes) {
            // Only add notes that don't exist (by timestamp+text)
            const exists = mergedNotes.some(n => n.t === note.t && n.text === note.text);
            if (!exists) {
              mergedNotes.push(note);
            }
          }
          // Sort notes by timestamp
          mergedNotes.sort((a, b) => a.t.localeCompare(b.t));

          await ctx.db.patch(existing._id, {
            status: task.status,
            blockedReason: task.blockedReason,
            notes: mergedNotes,
            updatedAt: timestamp,
            completedAt: task.completedAt,
          });
          updated++;
        } else {
          // Create new task
          await ctx.db.insert("tasks", {
            title: task.title,
            project: task.project,
            status: task.status,
            blockedReason: task.blockedReason,
            notes: task.notes,
            createdAt: task.createdAt,
            updatedAt: timestamp,
            completedAt: task.completedAt,
          });
          created++;
        }
      }
    } else if (mode === "append") {
      // Simply add all tasks (may create duplicates)
      for (const task of data.tasks) {
        await ctx.db.insert("tasks", {
          title: task.title,
          project: task.project,
          status: task.status,
          blockedReason: task.blockedReason,
          notes: task.notes,
          createdAt: task.createdAt,
          updatedAt: timestamp,
          completedAt: task.completedAt,
        });
        created++;
      }
    }

    return {
      ok: true,
      mode,
      deleted,
      created,
      updated,
      skipped,
      importedFrom: data.exportedAt,
    };
  },
});
