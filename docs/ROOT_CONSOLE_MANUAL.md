# URS-DMS Root Console Manual

## Purpose

The Root Console is the system-administration workspace for configuring how
URS-DMS behaves across the university. Use it to define the organization,
reusable folder structures, accreditation requirements, workflows, forms,
accounts, permissions, and platform settings.

The Root Console changes live, persisted system data. It is not a demo or
preview-only area. Every mutation is authorized, versioned where applicable,
and recorded in the audit log.

## Access and navigation

Only users with the `ROOT` role can use the Root Console. Log in with a ROOT
account, then open the Root Console from the administrator sidebar. Available
pages are:

- **Platform Overview** (`/root`) — health, usage, queue, audit, and
  configuration summaries.
- **Organization** (`/root-organization`) — campuses, colleges, departments,
  offices, and programs.
- **Folder Builder** (`/root-folder-builder`) — reusable folder templates and
  scope assignments.
- **Requirement Builder** (`/root-requirement-builder`) — accreditation
  requirement templates, validation rules, cycles, and assignments.
- **Workflow Builder** (`/root-workflow-builder`) — workflow definitions,
  steps, transitions, assignments, and runtime instances.
- **Form Builder** (`/root-form-builder`) — dynamic forms, fields, versions,
  and assignments.
- **Setup Wizard** (`/root-setup-wizard`) — guided first-run configuration.
- **Configuration Engine** (`/root-config`) — versioned platform settings.
- **Storage Maintenance** (`/root-maintenance`) — storage checks and cleanup
  jobs.
- **Roles & Permissions** (`/root-roles-permissions`) — role permission
  bindings.
- **System Audit** (`/root-audit`) — review security and platform events.
- **System Users** (`/root-users`) — review users and reset passwords.

If a page is hidden, that is a presentation guard; the server remains the
authority. A non-ROOT request to a Root Console API is denied and audited.

## Recommended first-time setup

Use the Setup Wizard on a new installation. Complete the steps in this order:

1. **Platform Information** — university name, logo, academic year,
   semester, colors, timezone, and language.
2. **Organization** — create campuses, colleges, departments, offices, and
   programs.
3. **Folder Templates** — create reusable nested folder structures.
4. **Requirement Templates** — define accreditation areas, requirements,
   groups, and validation rules.
5. **Workflow Assignment** — attach workflow definitions to areas or the
   university scope.
6. **Form Assignment** — attach forms to requirement templates, workflow
   steps, AACCUP areas, folder templates, or the university scope.
7. **Administrator Setup** — create administrator accounts, assign roles, and
   optionally assign departments.
8. **Setup Summary** — review the live counts and complete the wizard.

Progress is saved. Once completed, the wizard is locked to prevent accidental
reconfiguration, but a ROOT user can reopen it from the control center.

## Organization

Use Organization before assigning folders, requirements, or forms. Create the
hierarchy from the top down:

`Campus → College → Department / Office / Program`

Create a record with its name and code, then set its parent scope where
available. Use the tree tab to check that records are assigned correctly.

- **Edit** saves a new version snapshot.
- **Archive** is a soft delete; it preserves history and data.
- **Restore** returns an archived record to active use.
- **Version History** shows previous values and allows a rollback.

Keep codes stable because other assignments and reports may use them.

## Folder Builder

Folder templates define the starting folder structure for repositories. They
do not directly move or delete users' existing files.

1. Create a template with a clear name, code, description, and status.
2. Select the template and add folders.
3. Nest folders under the correct parent.
4. Set folder category, visibility, and active/inactive status as needed.
5. Review the tree and use the template preview.
6. Assign the template to a department, college, or university scope.
7. Set assignment priority when more than one template can apply.

More-specific assignments win during resolution: department before college,
and college before university. Inactive templates are not selected for new
runtime provisioning.

## Requirement Builder

Requirement templates are used to generate accreditation runtime
requirements. Build them as a tree:

- **SECTION** — grouping node, such as an AACCUP area or major section.
- **REQUIREMENT** — assessable requirement.
- **SUB_REQUIREMENT** or **SUPPORTING_DOCUMENT** — nested evidence or detail
  nodes where applicable.

For each requirement, configure its code, description, help text, required
state, status, and validation rules. A rule can reject an upload with an
`ERROR` or allow it with a `WARNING`.

Before publishing:

1. Expand the tree and check parent/child order.
2. Confirm required nodes and validation messages.
3. Use **User Preview** to see the experience.
4. Create or select an accreditation cycle.
5. Assign the template to the intended scope.
6. Publish only after review.

Publishing projects the template into runtime accreditation requirements. Do
not change a published template in place; make a new draft/version or use the
supported rollback flow.

## Workflow Builder

Workflows define controlled actions for requests, accreditation submissions,
and other supported runtime entities.

1. Create a workflow and choose its entity type.
2. Add ordered steps.
3. Optionally assign a role or required permission to each step.
4. Add transitions between steps.
5. Give each transition an action code and required permission.
6. Validate the workflow.
7. Publish it with an optional change note.
8. Assign it to an area or university scope.

Use the live instance section to inspect running workflows and the history
section to review changes. Test permissions and rejection/return paths before
assigning a workflow broadly.

## Form Builder

Forms collect structured data alongside requirements or workflow actions.

1. Create a form template with a name and description.
2. Add fields and choose the field type.
3. Configure label, description, placeholder, help text, default value, and
   whether the field is required.
4. Add options for choice fields.
5. Add validation rules such as minimum/maximum length, numeric limits, or a
   regular-expression pattern.
6. Preview the form.
7. Assign it to a requirement template, workflow step, AACCUP area, folder
   template, or university scope.
8. Publish after testing.

Use duplicate when you need a related form. Use version history and rollback
to recover an earlier design without deleting the audit trail.

## Configuration Engine

Configuration Engine values control platform behavior such as university
identity, calendar, colors, timezone, language, upload policy, and allowed
file types.

- Edit a value with a meaningful change note.
- Review version history before rolling back.
- Rollback creates a new version; it does not erase history.
- Seed-owned values are protected from deletion.
- Changes may take up to 60 seconds to appear in cached consumers.

For upload policy, an empty allowed-file-types list means all supported types
are allowed. Configuration changes affect the server, so validate them with a
small test before announcing a policy change.

## Roles, permissions, and users

Use **Roles & Permissions** to inspect a role and change its permission
bindings. `ROOT` is the highest-privilege role; use it sparingly. Permission
changes affect subsequent authenticated requests and are audited.

Use **System Users** to review account status and perform administrator-level
password resets. Give every person an individual account. Never share the
ROOT account or bootstrap credentials.

When creating administrators through the Setup Wizard or user administration:

- use a real institutional email and employee ID;
- assign the narrowest suitable role;
- assign a department when the user needs department-scoped access;
- require a password change when handing over an initial password.

## Storage Maintenance

Storage Maintenance reports object usage, active files, recycle-bin records,
orphan candidates, and recent jobs.

- Run consistency checks first when investigating a problem.
- Use dry-run cleanup to inspect candidates.
- Confirm cleanup only after checking that no valid database reference exists.
- Treat orphan deletion and permanent recycle-bin cleanup as irreversible
  operational actions.
- Keep backups outside the application container and verify restoration
  procedures separately.

## Audit and safe operating rules

Use System Audit to filter by module, status, severity, and time. Every
configuration, builder, role, user, archive, restore, publish, rollback, and
maintenance mutation should have an audit record.

Before saving a high-impact change:

1. Confirm you are in the correct environment.
2. Check the selected scope and parent record.
3. Add a useful change note.
4. Preview or validate the result.
5. Save once and verify the audit entry.
6. Test with a non-ROOT account where possible.

Do not edit the database directly to bypass the Root Console. Do not delete
published records to correct a mistake; archive, create a new version, or use
rollback so the history remains intact.

## Common troubleshooting

**A Root page is missing:** confirm the account is logged in with role
`ROOT`, then refresh the session. Client visibility does not override server
authorization.

**A published template cannot be edited:** this is expected. Roll back or
create a new draft/version first.

**An assignment is not being used:** check status, scope specificity, and
priority. A more-specific active assignment may take precedence.

**A user cannot see a new configuration:** allow the configuration cache to
expire, then refresh the session/page.

**A cleanup job reports candidates:** run the read-only consistency check and
dry-run first. Do not permanently delete until references and backups have
been reviewed.
