import type { RoleName } from "@prisma/client";

export type NavigationAudience = "USER" | "ADMIN" | "ROOT";

const USER_KNOWLEDGE = `
AUTHORIZED USER NAVIGATION
- Dashboard: your overview and accreditation progress.
- My Documents: your personal repository. Use Upload to add files, New Folder to organize, Preview for supported files, Download to save a file, Requested Documents for fulfilled requests, and Recycle Bin for deleted files/folders and restore actions.
- My Requests: create and track document requests. Approved or fulfilled requested documents appear in My Documents under Requested Documents.
- AACCUP: open the AACCUP group, then choose AACCUP or ISO. These are separate accreditation contexts.
- AACCUP and ISO: open the relevant area, review requirements, and use Submit or Replace for evidence when available. Recent Submissions links to My Submissions within the same accreditation context.
- My Tasks: available inside the AACCUP group when assigned tasks exist; users can submit evidence for actionable tasks.
- Notifications: system events and notifications; some notifications can open their related target directly.
- My Activity: your activity history.
- Profile: open Profile to update supported profile information and change your persistent profile photo.
- Settings: personal application settings.
`;

const ADMIN_KNOWLEDGE = `
AUTHORIZED ADMIN NAVIGATION
- Dashboard: review pending submissions, file requests, task deadlines, accreditation progress, recent submissions, and audit activity.
- My Documents: the administrator's personal repository with Upload, New Folder, Preview, Download, Requested Documents, and Recycle Bin.
- Requests: review user document requests and use the available Approve or Reject workflow.
- AACCUP group: choose AACCUP or ISO. Their submission data and areas are separate.
- Area workspace: open an Area card to its dedicated Area page. The workspace contains Submitted Files, Tasks, Requirements, Summary, and Recent Activity. Available actions include Edit, New Task, and Add Submission.
- Submitted Files: review submissions for that specific area. Pending submissions expose the available review actions: Approve, Return for Revision, or Reject. Approved and Returned submissions do not expose pending-review actions.
- User Management: manage user accounts, invite or add users, and use the available user password reset action according to the administrator's permissions.
- Audit Logs: review available system activity and login/security events permitted to the admin role.
- Profile and Settings: manage the administrator's own account and settings.
`;

const ROOT_KNOWLEDGE = `
AUTHORIZED ROOT / SYSTEM ADMINISTRATOR NAVIGATION
- Platform Overview: system-level dashboard and organization-wide health summaries.
- Root Console > Organization: manage colleges, departments, offices, and programs. To add a department, open Organization, select Departments, then use the create action.
- Root Console > Folder Builder: manage folder templates and folder structures.
- Root Console > Requirement Builder: manage builder-controlled requirement templates.
- Root Console > Form Builder: manage system form templates.
- Root Console > Storage Maintenance: inspect storage status and run available maintenance actions.
- Root Console > Roles & Permissions: review and configure system role permissions.
- Root Console > System Audit: review root-level system audit activity.
- Root Console > System Users: manage system users and available root user actions.
- Root Console > Configuration Engine: manage versioned system configuration and rollback where available.
- Root users can also use the normal admin portal areas, including Dashboard, AACCUP/ISO, Requests, User Management, Audit Logs, Profile, and Settings.
`;

const ROLE_AUDIENCE: Record<RoleName, NavigationAudience> = {
  ROOT: "ROOT",
  ADMINISTRATOR: "ADMIN",
  QUALITY_ASSURANCE_OFFICER: "ADMIN",
  DEPARTMENT_COORDINATOR: "ADMIN",
  FACULTY: "USER",
  STAFF: "USER",
  READ_ONLY: "USER",
};

export function audienceForRole(role: RoleName): NavigationAudience {
  return ROLE_AUDIENCE[role];
}

export function navigationKnowledgeFor(audience: NavigationAudience): string {
  if (audience === "ROOT") return ROOT_KNOWLEDGE;
  if (audience === "ADMIN") return ADMIN_KNOWLEDGE;
  return USER_KNOWLEDGE;
}

export function roleBoundaryResponse(audience: NavigationAudience, message: string): string | null {
  const normalized = message.toLowerCase();
  if (/essay|president|python|write.*code|payroll|reveal.*(api key|secret)|ignore.*(previous|system|role).*instruction/.test(normalized)) {
    return "I can only help with navigating and using URS-QA DMS features.";
  }
  if (audience === "USER" && /user management|manage users|add (a|another )?user|reset .*user.*password/.test(normalized)) {
    return "User Management is available only to authorized Admin or Root accounts. I cannot provide access instructions for it from the User portal.";
  }
  if (audience === "ADMIN" && /add (a )?department|create (a )?department|root console|root organization/.test(normalized)) {
    return "Department creation is a Root-only function. Admin accounts should contact a System Administrator.";
  }
  return null;
}
