import { PageHeader } from "@/components/layout/PageHeader"
import { RepositoryExplorer } from "@/components/repository/RepositoryExplorer"
import { DocumentScanner } from "@/components/repository/DocumentScanner"
import { Button } from "@/components/ui/Button"
import { ScanLine } from "lucide-react"
import { useState } from "react"

// =============================================================================
// My Documents — personal, owner-scoped file management
// -----------------------------------------------------------------------------
// The logged-in user manages their own folders and files. Repositories are
// isolated per account — only the owner's records are shown.
// =============================================================================

export default function UserDocuments() {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [repositoryKey, setRepositoryKey] = useState(0)
  return (
    <div className="content-padding">
      <PageHeader
        title="My Documents"
        description="Manage and organize your personal documents."
        actions={<Button onClick={() => setScannerOpen(true)}><ScanLine className="mr-2 h-4 w-4" />Scan Documents</Button>}
      />
      <RepositoryExplorer key={repositoryKey} />
      <DocumentScanner open={scannerOpen} onOpenChange={setScannerOpen} onUploaded={() => setRepositoryKey((key) => key + 1)} />
    </div>
  )
}
