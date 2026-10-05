# Document management

## Implemented model

Documents are versioned metadata records with `DocumentVersion` object metadata, owned by a `User` and optionally associated with folders. Folder and document shares are modeled separately. Access is not granted merely by client navigation: document/folder services and protected routes apply permission and ownership/share checks.

## API-backed capabilities

The documents and folders routers expose list/detail, creation/upload finalization, metadata update, delete/restore/permanent-delete, versions, tags, sharing, previews/downloads, folder move/copy/ZIP, deleted views, pins, and folder-share operations. Exact availability, inputs, and permissions are in `documents.routes.ts`, `folders.routes.ts`, and their validators.

The `/files` router provides signed-token upload/download URLs; Express streams bytes to or from MinIO rather than exposing public MinIO URLs. The client contains repository explorer/scanner and preview components, including document preview modals. Thumbnail processing has a worker. Preview header buttons labeled Share and Fullscreen are explicitly marked “not implemented” in the committed UI.

## Personal repository

`/repositories/me` provisions/returns the caller’s repository; storage summary, favorites/recents/pins through related feature APIs/models, copy jobs, and emergency access are implemented. A ROOT-granted, time-limited `EmergencyAccess` record is the elevated cross-owner mechanism exposed by repository routes.

## Validation and storage

The document validator specifies accepted MIME types and request shape. Object storage uses MinIO keys and signed API file tokens; the schema holds version metadata including bytes/checksum-related fields where modeled. Do not claim an upload, conflict, preview, or permission behavior without consulting the corresponding service and validator because the detail is operation-specific.
