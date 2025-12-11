import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
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
  })
    .index("by_status", ["status"])
    .index("by_project", ["project"])
    .index("by_project_status", ["project", "status"]),
});
