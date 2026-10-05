import { z } from "zod";

export const folderShareSchema = z.object({
  recipientType: z.enum(["USER", "DEPARTMENT"]),
  userIds: z.array(z.string().uuid()).max(100).optional(),
  departmentId: z.string().uuid().optional(),
  permission: z.enum(["VIEWER", "EDITOR"]),
}).superRefine((value, ctx) => {
  if (value.recipientType === "USER" && (!value.userIds || value.userIds.length === 0)) ctx.addIssue({ code: "custom", path: ["userIds"], message: "Select at least one user" });
  if (value.recipientType === "DEPARTMENT" && !value.departmentId) ctx.addIssue({ code: "custom", path: ["departmentId"], message: "Select a department" });
});
export type FolderShareInput = z.infer<typeof folderShareSchema>;

export const folderShareUpdateSchema = z.object({ permission: z.enum(["VIEWER", "EDITOR"]) }).strict();
export type FolderShareUpdateInput = z.infer<typeof folderShareUpdateSchema>;
