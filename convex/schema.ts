import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
    userId: v.string(),
    stream: v.string(),
    title: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("done"),
      v.literal("blocked"),
      v.literal("parked")
    ),
    blockedReason: v.optional(v.union(v.string(), v.null())),
    priority: v.optional(v.union(v.number(), v.null())),
    createdAt: v.string(),
    updatedAt: v.string(),
    completedAt: v.optional(v.union(v.string(), v.null())),
  })
    .index("by_userId_status", ["userId", "status"])
    .index("by_userId_stream_status", ["userId", "stream", "status"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),

  notes: defineTable({
    taskId: v.id("tasks"),
    userId: v.string(),
    author: v.string(),
    text: v.string(),
    createdAt: v.string(),
  })
    .index("by_taskId", ["taskId"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),

  events: defineTable({
    userId: v.string(),
    type: v.string(),
    taskId: v.optional(v.union(v.id("tasks"), v.null())),
    payload: v.any(),
    createdAt: v.string(),
    source: v.string(),
  })
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_taskId", ["taskId"]),
});
