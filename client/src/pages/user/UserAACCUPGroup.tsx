import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AACCUPGroupTabs } from "@/components/aaccup/AACCUPGroupTabs"
import { UserAccreditationView } from "@/pages/user/UserAccreditationView"
import { UserTasksTab } from "@/pages/user/UserTasksTab"
import UserSubmissionsTab from "@/pages/user/UserSubmissionsTab"
import type { AreaSet } from "@/services/aaccup"

// =============================================================================
// UserAACCUPGroup — grouped user surface for the accreditation sets, the
// user's own submissions, and their assigned tasks. Deep links /user/iso and
// /user/aaccup preserve the set via `initialTab`.
// =============================================================================

const SUPPORTED_TAB_VALUES = new Set(["AACCUP", "ISO", "submissions", "tasks"])

const USER_TABS = [
  { value: "AACCUP", label: "AACCUP" },
  { value: "ISO", label: "ISO 21001:2025" },
  { value: "submissions", label: "My Submissions" },
  { value: "tasks", label: "My Tasks" },
]

interface UserAACCUPGroupProps {
  initialTab?: string
}

export default function UserAACCUPGroup({ initialTab = "AACCUP" }: UserAACCUPGroupProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlTab = searchParams.get("tab")
  const urlAreaSet = searchParams.get("areaSet")
  const isSupportedTab = (value: string | null): value is string => Boolean(value && SUPPORTED_TAB_VALUES.has(value))
  const [tab, setTab] = useState<string>(isSupportedTab(urlTab) ? urlTab : initialTab)

  useEffect(() => {
    setTab(isSupportedTab(urlTab) ? urlTab : initialTab)
  }, [initialTab, urlTab])

  const resolvedAreaSet: AreaSet | undefined =
    urlAreaSet === "AACCUP" || urlAreaSet === "ISO"
      ? urlAreaSet
      : initialTab === "ISO"
        ? "ISO"
        : initialTab === "AACCUP"
          ? "AACCUP"
          : undefined

  const navigation = useMemo(
    () => (
      <AACCUPGroupTabs
        value={tab}
        tabs={USER_TABS}
        onValueChange={(value) => {
          if (value === "AACCUP") navigate("/user/aaccup")
          else if (value === "ISO") navigate("/user/iso")
          else if (value === "submissions") {
            const areaSet = resolvedAreaSet === "ISO" || tab === "ISO" ? "ISO" : "AACCUP"
            navigate(`/user/aaccup?tab=submissions&areaSet=${areaSet}`)
          } else if (value === "tasks") navigate("/user/aaccup?tab=tasks")
        }}
      />
    ),
    [navigate, resolvedAreaSet, tab],
  )

  return (
    <div>
      {tab === "submissions" ? (
        <UserSubmissionsTab navigation={navigation} areaSet={resolvedAreaSet} />
      ) : tab === "tasks" ? (
        <UserTasksTab navigation={navigation} />
      ) : (
        <UserAccreditationView
          key={tab}
          areaSet={tab as AreaSet}
          navigation={navigation}
        />
      )}
    </div>
  )
}
