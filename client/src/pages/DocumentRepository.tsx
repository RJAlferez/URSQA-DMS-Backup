import { PageHeader } from "@/components/layout/PageHeader"
import { RepositoryExplorer } from "@/components/repository/RepositoryExplorer"

// =============================================================================
// Document Repository — personal, owner-scoped file management
// -----------------------------------------------------------------------------
// Each authenticated account manages its own folders and files (Windows-
// Explorer behavior: single click selects, double click opens). No other
// account's repository is visible here.
// =============================================================================

export default function DocumentRepository() {
  return (
    <div className="content-padding">
      <PageHeader
        title="My Documents"
        description="Manage and organize your personal documents."
      />
      <RepositoryExplorer />
    </div>
  )
}
