import type { NotificationPriority, NotificationType } from "@prisma/client";

// =============================================================================
// URS-DMS — Notification event catalog (Sprint 7.3)
// -----------------------------------------------------------------------------
// The exhaustive list of events the platform can emit — mirrors the
// `NotificationType` DB enum one-to-one. Each entry carries the human-readable
// defaults used when a caller does not supply its own title/message, the
// default priority, and (where relevant) a default email subject/body used by
// `notifyUser` when the caller opts into the email channel.
//
// Emitting a notification is ONE call (notifyUser / notifyUsers) with a
// catalog `type` — modules never touch the Notification table directly.
// =============================================================================

export const NOTIFICATION_TYPE_VALUES = [
  "DOCUMENT_UPLOADED",
  "DOCUMENT_UPLOAD_FAILED",
  "DOCUMENT_DELIVERED",
  "DOCUMENT_RETURNED",
  "DOCUMENT_APPROVED",
  "DOCUMENT_REJECTED",
  "REQUEST_SUBMITTED",
  "REQUEST_APPROVED",
  "REQUEST_REJECTED",
  "AACCUP_SUBMISSION_APPROVED",
  "AACCUP_SUBMISSION_REJECTED",
  "AACCUP_SUBMISSION_RETURNED",
  "AACCUP_SUBMISSION_PENDING_REVIEW",
  "AACCUP_SUBMISSION_WITHDRAWN",
  "AACCUP_TASK_ASSIGNED",
  "AACCUP_TASK_DEADLINE",
  "RECYCLE_BIN_CLEANUP",
  "STORAGE_WARNING",
  "PASSWORD_RESET",
  "ROLE_CHANGED",
  "SYSTEM_ANNOUNCEMENT",
  "FOLDER_SHARED_ACCESS",
] as const;

export interface NotificationEmailDefaults {
  subject: string;
  body: string;
}

export interface NotificationEventSpec {
  type: NotificationType;
  defaultTitle: string;
  defaultMessage: string;
  defaultPriority: NotificationPriority;
  email?: NotificationEmailDefaults;
}

export const NOTIFICATION_EVENTS: Record<NotificationType, NotificationEventSpec> = {
  DOCUMENT_UPLOADED: {
    type: "DOCUMENT_UPLOADED",
    defaultTitle: "Document uploaded",
    defaultMessage: "A document has been uploaded to the document repository.",
    defaultPriority: "MEDIUM",
    email: {
      subject: "URS-DMS - Document uploaded",
      body: "<p>A document has been uploaded to the URS document repository.</p>",
    },
  },
  DOCUMENT_UPLOAD_FAILED: {
    type: "DOCUMENT_UPLOAD_FAILED",
    defaultTitle: "Upload failed",
    defaultMessage: "A document upload could not be verified and was rolled back.",
    defaultPriority: "HIGH",
  },
  DOCUMENT_DELIVERED: {
    type: "DOCUMENT_DELIVERED",
    defaultTitle: "Document delivered",
    defaultMessage: "A requested document has been delivered to your Requested Documents.",
    defaultPriority: "MEDIUM",
  },
  DOCUMENT_RETURNED: {
    type: "DOCUMENT_RETURNED",
    defaultTitle: "Document returned",
    defaultMessage: "A document was returned for revision.",
    defaultPriority: "HIGH",
  },
  DOCUMENT_APPROVED: {
    type: "DOCUMENT_APPROVED",
    defaultTitle: "Document approved",
    defaultMessage: "A document has been approved.",
    defaultPriority: "MEDIUM",
    email: {
      subject: "URS-DMS — Document approved",
      body: "<p>Your document has been approved.</p>",
    },
  },
  DOCUMENT_REJECTED: {
    type: "DOCUMENT_REJECTED",
    defaultTitle: "Document rejected",
    defaultMessage: "A document has been rejected. Please review the decision note.",
    defaultPriority: "HIGH",
    email: {
      subject: "URS-DMS — Document rejected",
      body: "<p>A document has been rejected. Please review the decision note in URS-DMS.</p>",
    },
  },
  REQUEST_SUBMITTED: {
    type: "REQUEST_SUBMITTED",
    defaultTitle: "Document request submitted",
    defaultMessage: "A document access request has been submitted.",
    defaultPriority: "MEDIUM",
  },
  REQUEST_APPROVED: {
    type: "REQUEST_APPROVED",
    defaultTitle: "Request approved",
    defaultMessage: "Your document access request has been approved.",
    defaultPriority: "MEDIUM",
    email: {
      subject: "URS-DMS — Request approved",
      body: "<p>Your document access request has been approved.</p>",
    },
  },
  REQUEST_REJECTED: {
    type: "REQUEST_REJECTED",
    defaultTitle: "Request rejected",
    defaultMessage: "Your document access request has been rejected.",
    defaultPriority: "MEDIUM",
    email: {
      subject: "URS-DMS — Request rejected",
      body: "<p>Your document access request has been rejected.</p>",
    },
  },
  AACCUP_SUBMISSION_APPROVED: {
    type: "AACCUP_SUBMISSION_APPROVED",
    defaultTitle: "Submission approved",
    defaultMessage: "Your AACCUP document submission has been approved.",
    defaultPriority: "MEDIUM",
  },
  AACCUP_SUBMISSION_RETURNED: {
    type: "AACCUP_SUBMISSION_RETURNED",
    defaultTitle: "Submission returned",
    defaultMessage: "Your AACCUP document submission was returned for revision.",
    defaultPriority: "HIGH",
  },
  AACCUP_SUBMISSION_REJECTED: {
    type: "AACCUP_SUBMISSION_REJECTED",
    defaultTitle: "Submission rejected",
    defaultMessage: "Your AACCUP document submission has been rejected.",
    defaultPriority: "HIGH",
  },
  AACCUP_SUBMISSION_PENDING_REVIEW: {
    type: "AACCUP_SUBMISSION_PENDING_REVIEW",
    defaultTitle: "Submission pending review",
    defaultMessage: "A new AACCUP document submission is awaiting review.",
    defaultPriority: "MEDIUM",
    email: {
      subject: "URS-DMS — Submission pending review",
      body: "<p>A submission is awaiting review in URS-DMS.</p>",
    },
  },
  AACCUP_SUBMISSION_WITHDRAWN: {
    type: "AACCUP_SUBMISSION_WITHDRAWN",
    defaultTitle: "Submission withdrawn",
    defaultMessage: "A submitted document was withdrawn by its submitter.",
    defaultPriority: "HIGH",
    email: {
      subject: "URS-DMS — Submission withdrawn",
      body: "<p>A submitted document was withdrawn and is no longer active.</p>",
    },
  },
  AACCUP_TASK_ASSIGNED: {
    type: "AACCUP_TASK_ASSIGNED",
    defaultTitle: "New task assigned",
    defaultMessage: "You have been assigned a new AACCUP task.",
    defaultPriority: "MEDIUM",
  },
  AACCUP_TASK_DEADLINE: {
    type: "AACCUP_TASK_DEADLINE",
    defaultTitle: "Task deadline approaching",
    defaultMessage: "An assigned task is approaching its deadline.",
    defaultPriority: "HIGH",
    email: {
      subject: "URS-DMS — Task deadline approaching",
      body: "<p>An assigned task is approaching its deadline.</p>",
    },
  },
  RECYCLE_BIN_CLEANUP: {
    type: "RECYCLE_BIN_CLEANUP",
    defaultTitle: "Recycle Bin cleanup",
    defaultMessage: "An item in your Recycle Bin was permanently removed after the 30-day retention period.",
    defaultPriority: "LOW",
  },
  STORAGE_WARNING: {
    type: "STORAGE_WARNING",
    defaultTitle: "Storage warning",
    defaultMessage: "Platform storage usage exceeds the configured warning threshold.",
    defaultPriority: "HIGH",
  },
  PASSWORD_RESET: {
    type: "PASSWORD_RESET",
    defaultTitle: "Password changed",
    defaultMessage: "Your password has been changed. If this was not you, contact the administrator.",
    defaultPriority: "HIGH",
    email: {
      subject: "URS-DMS — Password changed",
      body: "<p>Your URS-DMS password has been changed. If this was not you, contact the administrator immediately.</p>",
    },
  },
  ROLE_CHANGED: {
    type: "ROLE_CHANGED",
    defaultTitle: "Role changed",
    defaultMessage: "Your account role has been changed by an administrator.",
    defaultPriority: "HIGH",
  },
  SYSTEM_ANNOUNCEMENT: {
    type: "SYSTEM_ANNOUNCEMENT",
    defaultTitle: "System announcement",
    defaultMessage: "An announcement from the system administrator.",
    defaultPriority: "HIGH",
  },
  FOLDER_SHARED_ACCESS: {
    type: "FOLDER_SHARED_ACCESS",
    defaultTitle: "Folder shared with you",
    defaultMessage: "A folder has been shared with you in the document repository.",
    defaultPriority: "MEDIUM",
  },
};
