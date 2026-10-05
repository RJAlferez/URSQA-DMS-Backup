import type { ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { PageHeader } from "@/components/layout/PageHeader"
import { SubmissionsTable } from "@/components/aaccup/SubmissionsTable"
import { Card, CardContent } from "@/components/ui/Card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs"
import type { AreaSet } from "@/services/aaccup"

// =============================================================================
// UserSubmissionsTab — the user's "My Submissions" view inside the AACCUP
// group. Same table as the admin review surface, read-only: the server only
// returns the caller's own submissions (non-reviewer scoping).
// =============================================================================

export default function UserSubmissionsTab({ navigation, areaSet }: { navigation?: ReactNode; areaSet?: AreaSet }) {
  const navigate = useNavigate()
  const selectedSet = areaSet === "ISO" ? "ISO" : "AACCUP"

  return (
    <div className="content-padding">
      <PageHeader
        title="My Submissions"
        description={`Your ${selectedSet} submitted evidence — statuses update after admin review.`}
      />
      {navigation && <div className="mb-6 lg:mb-8">{navigation}</div>}
      <Card className="mb-5 overflow-hidden border-border/70">
        <CardContent className="p-2 pt-2 pb-2 md:p-2 md:pt-2 md:pb-2">
          <Tabs value={selectedSet} onValueChange={(value) => navigate(`/user/submissions?areaSet=${value}`)}>
            <TabsList className="flex h-9 w-full justify-start gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsTrigger value="AACCUP" className="min-w-max px-4 py-1.5 text-[12px]">AACCUP</TabsTrigger>
              <TabsTrigger value="ISO" className="min-w-max px-4 py-1.5 text-[12px]">ISO</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>
      <SubmissionsTable mode="view" areaSet={selectedSet} />
    </div>
  )
}
