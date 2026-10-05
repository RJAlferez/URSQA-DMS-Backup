import { useCallback, useEffect, useRef, useState } from "react"
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  GitBranch,
  History,
  MoreHorizontal,
  Move,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Tag,
  Users,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Textarea } from "@/components/ui/Textarea"
import { Badge } from "@/components/ui/Badge"
import { Label } from "@/components/ui/Label"
import { Switch } from "@/components/ui/Switch"
import { Skeleton } from "@/components/ui/Skeleton"
import { EmptyState } from "@/components/ui/EmptyState"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table"
import { toast } from "@/lib/toast"
import {
  archiveFolderNode,
  archiveFolderTemplate,
  assignFolderTemplate,
  createFolderNode,
  createFolderTemplate,
  duplicateFolderNode,
  duplicateFolderTemplate,
  getFolderTemplate,
  listFolderAssignments,
  listFolderAssignmentTargets,
  listFolderHistory,
  listFolderNodes,
  listFolderTemplates,
  listFolderVersions,
  moveFolderNode,
  restoreFolderNode,
  restoreFolderTemplate,
  rollbackFolderTemplate,
  unassignFolderTemplate,
  updateFolderNode,
  updateFolderTemplate,
  type FolderAssignment,
  type FolderAssignmentTargetOption,
  type FolderAssignmentTargetType,
  type FolderHistoryEntry,
  type FolderNodeInput,
  type FolderNodeStatus,
  type FolderNodeVisibility,
  type FolderTemplate,
  type FolderTemplateChangeType,
  type FolderTemplateDetail,
  type FolderTemplateInput,
  type FolderTemplateStatus,
  type FolderTreeNode,
  type FolderVersion,
} from "@/services/root"

const TEMPLATE_PAGE_SIZE = 10
const HISTORY_PAGE_SIZE = 20
const ALL_VALUE = "ALL"
const ROOT_PARENT_VALUE = "__ROOT__"
const NO_TARGET_VALUE = "__NO_TARGET__"

type MainTab = "templates" | "assignments" | "history"
type TemplateStatusFilter = FolderTemplateStatus | typeof ALL_VALUE
type HistoryActionFilter = FolderTemplateChangeType | typeof ALL_VALUE
type NodeAction = "add" | "edit" | "move" | "duplicate" | "archive"

interface TemplateFormState {
  name: string
  code: string
  description: string
  category: string
  status: FolderTemplateStatus
  icon: string
  color: string
}

interface NodeFormState {
  name: string
  description: string
  category: string
  visibility: FolderNodeVisibility
  status: FolderNodeStatus
  icon: string
  color: string
}

type TemplateDialogState =
  | { mode: "create" }
  | { mode: "edit"; template: FolderTemplate }

type NodeDialogState =
  | { mode: "create"; parentId: string | null; parentName: string | null }
  | { mode: "edit"; node: FolderTreeNode }

type ConfirmAction =
  | { kind: "archive-template"; template: FolderTemplate }
  | { kind: "archive-node"; node: FolderTreeNode }

interface CountableNode {
  children: CountableNode[]
}

const EMPTY_TEMPLATE_FORM: TemplateFormState = {
  name: "",
  code: "",
  description: "",
  category: "",
  status: "ACTIVE",
  icon: "",
  color: "",
}

const EMPTY_NODE_FORM: NodeFormState = {
  name: "",
  description: "",
  category: "",
  visibility: "VISIBLE",
  status: "ACTIVE",
  icon: "",
  color: "",
}

const ASSIGNMENT_TARGETS: ReadonlyArray<{
  value: FolderAssignmentTargetType
  label: string
}> = [
  { value: "UNIVERSITY", label: "University" },
  { value: "COLLEGE", label: "College" },
  { value: "DEPARTMENT", label: "Department" },
  { value: "PROGRAM", label: "Program" },
  { value: "OFFICE", label: "Office" },
  { value: "AACCUP_AREA", label: "AACCUP Area" },
]

const HISTORY_ACTIONS: FolderTemplateChangeType[] = [
  "CREATED",
  "UPDATED",
  "ASSIGNED",
  "ARCHIVED",
  "RESTORED",
  "ROLLED_BACK",
]

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function formatWireDate(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString()
}

function countNodes(nodes: readonly CountableNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countNodes(node.children), 0)
}

function flattenNodes(nodes: readonly FolderTreeNode[]): FolderTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)])
}

function collectNodeIds(node: FolderTreeNode, result = new Set<string>()): Set<string> {
  result.add(node.id)
  node.children.forEach((child) => collectNodeIds(child, result))
  return result
}

function targetTypeLabel(value: FolderAssignmentTargetType): string {
  return ASSIGNMENT_TARGETS.find((target) => target.value === value)?.label ?? value
}

function historyBadgeVariant(
  action: FolderTemplateChangeType,
): "success" | "warning" | "danger" | "default" | "secondary" {
  switch (action) {
    case "CREATED":
    case "RESTORED":
      return "success"
    case "UPDATED":
    case "ASSIGNED":
      return "warning"
    case "ARCHIVED":
      return "danger"
    case "ROLLED_BACK":
      return "default"
    default:
      return "secondary"
  }
}

function snapshotFieldChanges(template: FolderTemplate, version: FolderVersion): string[] {
  const target = version.data
  const fields: Array<[string, string | null, string | null]> = [
    ["name", template.name, target.name],
    ["code", template.code, target.code],
    ["description", template.description, target.description],
    ["category", template.category, target.category],
    ["status", template.status, target.status],
    ["icon", template.icon, target.icon],
    ["color", template.color, target.color],
  ]
  return fields.filter(([, current, previous]) => current !== previous).map(([label]) => label)
}

function InlineError({
  message,
  onRetry,
  compact = false,
}: {
  message: string
  onRetry: () => void
  compact?: boolean
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "gap-2 px-4 py-5" : "gap-3 px-6 py-12"
      }`}
    >
      <div className="rounded-full bg-red-50 p-2 text-red-600">
        <Archive className="h-4 w-4" />
      </div>
      <p className="max-w-md text-[13px] text-gray-600">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Retry
      </Button>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-6 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Skeleton variant="rectangular" className="h-11 w-11" />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" className="h-5 w-48" />
            <Skeleton variant="text" className="h-3 w-72 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Skeleton variant="rectangular" className="h-20" />
          <Skeleton variant="rectangular" className="h-20" />
          <Skeleton variant="rectangular" className="h-20" />
        </div>
        <div className="space-y-2">
          <Skeleton variant="rectangular" className="h-11" />
          <Skeleton variant="rectangular" className="h-11" />
          <Skeleton variant="rectangular" className="h-11" />
        </div>
      </CardContent>
    </Card>
  )
}

function FolderNodeBranch({
  node,
  depth,
  expandedIds,
  disabled,
  onToggle,
  onAction,
}: {
  node: FolderTreeNode
  depth: number
  expandedIds: ReadonlySet<string>
  disabled: boolean
  onToggle: (nodeId: string) => void
  onAction: (action: NodeAction, node: FolderTreeNode) => void
}) {
  const hasChildren = node.children.length > 0
  const expanded = expandedIds.has(node.id)
  const NodeIcon = expanded && hasChildren ? FolderOpen : Folder

  return (
    <li>
      <div
        className="group flex min-h-12 items-center gap-2 border-b border-gray-100 px-2 py-2 last:border-b-0 hover:bg-gray-50/70"
        style={{ paddingLeft: depth * 18 + 8 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            onClick={() => onToggle(node.id)}
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="h-7 w-7 shrink-0" aria-hidden="true" />
        )}

        <NodeIcon
          className="h-4 w-4 shrink-0 text-amber-500"
          style={{ color: node.color ?? undefined }}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-gray-900">{node.name}</span>
            {node.category && (
              <span className="truncate text-[11px] text-gray-400">{node.category}</span>
            )}
          </div>
          {node.description && (
            <p className="mt-0.5 truncate text-[11px] text-gray-400">{node.description}</p>
          )}
          <div className="mt-1 flex items-center gap-1.5 sm:hidden">
            <Badge variant={node.status === "ACTIVE" ? "success" : "warning"}>
              {node.status}
            </Badge>
            <Badge variant={node.visibility === "VISIBLE" ? "outline" : "secondary"}>
              {node.visibility}
            </Badge>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <Badge variant={node.status === "ACTIVE" ? "success" : "warning"}>
            {node.status}
          </Badge>
          <Badge variant={node.visibility === "VISIBLE" ? "outline" : "secondary"}>
            {node.visibility === "VISIBLE" ? (
              <Eye className="mr-1 h-3 w-3" />
            ) : (
              <EyeOff className="mr-1 h-3 w-3" />
            )}
            {node.visibility}
          </Badge>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 p-0"
              aria-label={`Actions for ${node.name}`}
              disabled={disabled}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => onAction("add", node)}>
              <Plus className="mr-2 h-4 w-4" />
              Add child
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("edit", node)}>
              <Edit3 className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("move", node)}>
              <Move className="mr-2 h-4 w-4" />
              Move
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("duplicate", node)}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicate subtree
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600 focus:text-red-700"
              onSelect={() => onAction("archive", node)}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {hasChildren && expanded && (
        <ul>
          {node.children.map((child) => (
            <FolderNodeBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              disabled={disabled}
              onToggle={onToggle}
              onAction={onAction}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function RootFolderBuilder() {
  const [mainTab, setMainTab] = useState<MainTab>("templates")
  const [refreshing, setRefreshing] = useState(false)
  const [mutationKey, setMutationKey] = useState<string | null>(null)

  const [templates, setTemplates] = useState<FolderTemplate[]>([])
  const [templatePage, setTemplatePage] = useState(1)
  const [templateTotal, setTemplateTotal] = useState(0)
  const [templateTotalPages, setTemplateTotalPages] = useState(1)
  const [templateSearch, setTemplateSearch] = useState("")
  const [templateStatus, setTemplateStatus] = useState<TemplateStatusFilter>(ALL_VALUE)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const templateRequestRef = useRef(0)

  const [templateOptions, setTemplateOptions] = useState<FolderTemplate[]>([])
  const [templateOptionsLoading, setTemplateOptionsLoading] = useState(true)
  const [templateOptionsError, setTemplateOptionsError] = useState<string | null>(null)

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [detail, setDetail] = useState<FolderTemplateDetail | null>(null)
  const [allNodes, setAllNodes] = useState<FolderTreeNode[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set())
  const [archivedNodesExpanded, setArchivedNodesExpanded] = useState(false)
  const detailRequestRef = useRef(0)

  const [templateDialog, setTemplateDialog] = useState<TemplateDialogState | null>(null)
  const [templateForm, setTemplateForm] = useState<TemplateFormState>({
    ...EMPTY_TEMPLATE_FORM,
  })
  const [nodeDialog, setNodeDialog] = useState<NodeDialogState | null>(null)
  const [nodeForm, setNodeForm] = useState<NodeFormState>({ ...EMPTY_NODE_FORM })
  const [moveNode, setMoveNode] = useState<FolderTreeNode | null>(null)
  const [moveParentValue, setMoveParentValue] = useState(ROOT_PARENT_VALUE)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [assignmentType, setAssignmentType] = useState<FolderAssignmentTargetType>("UNIVERSITY")
  const [assignmentTargetId, setAssignmentTargetId] = useState(NO_TARGET_VALUE)
  const [assignmentTargets, setAssignmentTargets] = useState<FolderAssignmentTargetOption[]>([])
  const [assignmentTargetsLoading, setAssignmentTargetsLoading] = useState(false)
  const [assignmentTargetsError, setAssignmentTargetsError] = useState<string | null>(null)
  const assignmentTargetRequestRef = useRef(0)

  const [versionTemplate, setVersionTemplate] = useState<FolderTemplate | null>(null)
  const [versions, setVersions] = useState<FolderVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<FolderVersion | null>(null)
  const [rollbackNote, setRollbackNote] = useState("")
  const versionRequestRef = useRef(0)

  const [historyEntries, setHistoryEntries] = useState<FolderHistoryEntry[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyTotalPages, setHistoryTotalPages] = useState(1)
  const [historyTemplateFilter, setHistoryTemplateFilter] = useState(ALL_VALUE)
  const [historyActionFilter, setHistoryActionFilter] =
    useState<HistoryActionFilter>(ALL_VALUE)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const historyRequestRef = useRef(0)

  const loadTemplates = useCallback(async () => {
    const requestId = ++templateRequestRef.current
    setTemplatesLoading(true)
    setTemplatesError(null)
    try {
      const result = await listFolderTemplates({
        page: templatePage,
        pageSize: TEMPLATE_PAGE_SIZE,
        q: templateSearch.trim() || undefined,
        status: templateStatus === ALL_VALUE ? undefined : templateStatus,
        includeArchived: includeArchived || undefined,
      })
      if (requestId !== templateRequestRef.current) return
      setTemplates(result.items)
      setTemplateTotal(result.meta.total)
      setTemplateTotalPages(Math.max(1, result.meta.totalPages))
      if (result.items.length > 0) {
        setSelectedTemplateId((current) => current ?? result.items[0].id)
      }
    } catch (error) {
      if (requestId !== templateRequestRef.current) return
      setTemplatesError(errorMessage(error, "Failed to load folder templates"))
    } finally {
      if (requestId === templateRequestRef.current) setTemplatesLoading(false)
    }
  }, [includeArchived, templatePage, templateSearch, templateStatus])

  const loadTemplateOptions = useCallback(async () => {
    setTemplateOptionsLoading(true)
    setTemplateOptionsError(null)
    try {
      const firstPage = await listFolderTemplates({
        page: 1,
        pageSize: 100,
        includeArchived: true,
      })
      const remainingPages = await Promise.all(
        Array.from({ length: Math.max(0, firstPage.meta.totalPages - 1) }, (_, index) =>
          listFolderTemplates({
            page: index + 2,
            pageSize: 100,
            includeArchived: true,
          }),
        ),
      )
      setTemplateOptions([
        ...firstPage.items,
        ...remainingPages.flatMap((result) => result.items),
      ])
    } catch (error) {
      setTemplateOptionsError(errorMessage(error, "Failed to load template options"))
    } finally {
      setTemplateOptionsLoading(false)
    }
  }, [])

  const loadTemplateDetail = useCallback(async (templateId: string, showLoading = true) => {
    const requestId = ++detailRequestRef.current
    if (showLoading) setDetailLoading(true)
    setDetailError(null)
    try {
      const [nextDetail, nodesWithArchived, assignments] = await Promise.all([
        getFolderTemplate(templateId),
        listFolderNodes(templateId, { includeArchived: true }),
        listFolderAssignments({ templateId }),
      ])
      if (requestId !== detailRequestRef.current) return
      setDetail({ ...nextDetail, assignments })
      setAllNodes(nodesWithArchived)
      setExpandedNodeIds((current) =>
        current.size > 0 ? current : new Set(nextDetail.tree.map((node) => node.id)),
      )
    } catch (error) {
      if (requestId !== detailRequestRef.current) return
      setDetailError(errorMessage(error, "Failed to load template details"))
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false)
    }
  }, [])

  const loadHistoryEntries = useCallback(async () => {
    const requestId = ++historyRequestRef.current
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const result = await listFolderHistory({
        page: historyPage,
        pageSize: HISTORY_PAGE_SIZE,
        templateId:
          historyTemplateFilter === ALL_VALUE ? undefined : historyTemplateFilter,
        action: historyActionFilter === ALL_VALUE ? undefined : historyActionFilter,
      })
      if (requestId !== historyRequestRef.current) return
      setHistoryEntries(result.items)
      setHistoryTotal(result.meta.total)
      setHistoryTotalPages(Math.max(1, result.meta.totalPages))
    } catch (error) {
      if (requestId !== historyRequestRef.current) return
      setHistoryError(errorMessage(error, "Failed to load folder history"))
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false)
    }
  }, [historyActionFilter, historyPage, historyTemplateFilter])

  const loadAssignmentTargets = useCallback(async (type: FolderAssignmentTargetType) => {
    const requestId = ++assignmentTargetRequestRef.current
    setAssignmentTargetsLoading(true)
    setAssignmentTargetsError(null)
    setAssignmentTargets([])
    setAssignmentTargetId(NO_TARGET_VALUE)
    try {
      const targets = await listFolderAssignmentTargets(type)
      if (requestId !== assignmentTargetRequestRef.current) return
      setAssignmentTargets(targets)
    } catch (error) {
      if (requestId !== assignmentTargetRequestRef.current) return
      setAssignmentTargetsError(errorMessage(error, "Failed to load assignment targets"))
    } finally {
      if (requestId === assignmentTargetRequestRef.current) {
        setAssignmentTargetsLoading(false)
      }
    }
  }, [])

  const loadVersionsFor = useCallback(async (templateId: string) => {
    const requestId = ++versionRequestRef.current
    setVersionsLoading(true)
    setVersionsError(null)
    try {
      const nextVersions = await listFolderVersions(templateId)
      if (requestId !== versionRequestRef.current) return
      setVersions(nextVersions)
    } catch (error) {
      if (requestId !== versionRequestRef.current) return
      setVersionsError(errorMessage(error, "Failed to load template versions"))
    } finally {
      if (requestId === versionRequestRef.current) setVersionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    void loadTemplateOptions()
  }, [loadTemplateOptions])

  useEffect(() => {
    detailRequestRef.current += 1
    setDetail(null)
    setAllNodes([])
    setDetailError(null)
    setExpandedNodeIds(new Set())
    setArchivedNodesExpanded(false)
    if (selectedTemplateId) void loadTemplateDetail(selectedTemplateId)
  }, [loadTemplateDetail, selectedTemplateId])

  useEffect(() => {
    if (mainTab === "history") void loadHistoryEntries()
  }, [loadHistoryEntries, mainTab])

  useEffect(() => {
    if (mainTab !== "assignments" || selectedTemplateId || templateOptions.length === 0) return
    const firstActive = templateOptions.find((template) => !template.deletedAt)
    setSelectedTemplateId(firstActive?.id ?? templateOptions[0].id)
  }, [mainTab, selectedTemplateId, templateOptions])

  const refreshSelectedData = useCallback(
    async (templateId: string) => {
      await Promise.all([
        loadTemplateDetail(templateId, false),
        loadTemplates(),
        loadTemplateOptions(),
      ])
    },
    [loadTemplateDetail, loadTemplateOptions, loadTemplates],
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      if (mainTab === "history") {
        await Promise.all([loadHistoryEntries(), loadTemplateOptions()])
      } else {
        await Promise.all([
          loadTemplates(),
          loadTemplateOptions(),
          selectedTemplateId
            ? loadTemplateDetail(selectedTemplateId, false)
            : Promise.resolve(),
        ])
      }
    } finally {
      setRefreshing(false)
    }
  }

  const clearTemplateFilters = () => {
    setTemplateSearch("")
    setTemplateStatus(ALL_VALUE)
    setIncludeArchived(false)
    setTemplatePage(1)
    setSelectedTemplateId(null)
  }

  const changeTemplatePage = (page: number) => {
    setTemplatePage(page)
    setSelectedTemplateId(null)
  }

  const openCreateTemplate = () => {
    setTemplateForm({ ...EMPTY_TEMPLATE_FORM })
    setTemplateDialog({ mode: "create" })
  }

  const openEditTemplate = (template: FolderTemplate) => {
    setTemplateForm({
      name: template.name,
      code: template.code,
      description: template.description ?? "",
      category: template.category ?? "",
      status: template.status,
      icon: template.icon ?? "",
      color: template.color ?? "",
    })
    setTemplateDialog({ mode: "edit", template })
  }

  const handleSaveTemplate = async () => {
    if (!templateDialog) return
    if (!templateForm.name.trim() || !templateForm.code.trim()) {
      toast.error("Template name and code are required")
      return
    }

    setMutationKey("save-template")
    try {
      if (templateDialog.mode === "create") {
        const input: FolderTemplateInput = {
          name: templateForm.name.trim(),
          code: templateForm.code.trim(),
          description: templateForm.description.trim() || null,
          category: templateForm.category.trim() || null,
          status: templateForm.status,
          icon: templateForm.icon.trim() || null,
          color: templateForm.color.trim() || null,
        }
        const created = await createFolderTemplate(input)
        setTemplateDialog(null)
        setTemplateSearch("")
        setTemplateStatus(ALL_VALUE)
        setIncludeArchived(false)
        setTemplatePage(1)
        setSelectedTemplateId(created.template.id)
        setDetail(created)
        setAllNodes(created.tree)
        await Promise.all([loadTemplates(), loadTemplateOptions()])
        toast.success(`Template "${created.template.name}" created`)
      } else {
        const input: Partial<Omit<FolderTemplateInput, "nodes">> = {
          name: templateForm.name.trim(),
          code: templateForm.code.trim(),
          description: templateForm.description.trim() || null,
          category: templateForm.category.trim() || null,
          status: templateForm.status,
          icon: templateForm.icon.trim() || null,
          color: templateForm.color.trim() || null,
        }
        const updated = await updateFolderTemplate(
          templateDialog.template.id,
          input,
        )
        setTemplateDialog(null)
        setDetail(updated)
        await refreshSelectedData(templateDialog.template.id)
        toast.success(`Template "${updated.template.name}" updated`)
      }
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save template"))
    } finally {
      setMutationKey(null)
    }
  }

  const handleDuplicateTemplate = async (template: FolderTemplate) => {
    setMutationKey(`duplicate-template:${template.id}`)
    try {
      const duplicated = await duplicateFolderTemplate(template.id)
      setTemplateSearch("")
      setTemplateStatus(ALL_VALUE)
      setIncludeArchived(false)
      setTemplatePage(1)
      setSelectedTemplateId(duplicated.template.id)
      setDetail(duplicated)
      setAllNodes(duplicated.tree)
      await Promise.all([loadTemplates(), loadTemplateOptions()])
      toast.success(`Template duplicated as "${duplicated.template.name}"`)
    } catch (error) {
      toast.error(errorMessage(error, "Failed to duplicate template"))
    } finally {
      setMutationKey(null)
    }
  }

  const handleRestoreTemplate = async (template: FolderTemplate) => {
    setMutationKey(`restore-template:${template.id}`)
    try {
      const restored = await restoreFolderTemplate(template.id)
      setDetail(restored)
      await refreshSelectedData(template.id)
      toast.success(`Template "${restored.template.name}" restored`)
    } catch (error) {
      toast.error(errorMessage(error, "Failed to restore template"))
    } finally {
      setMutationKey(null)
    }
  }

  const openCreateNode = (parent: FolderTreeNode | null) => {
    setNodeForm({ ...EMPTY_NODE_FORM })
    setNodeDialog({
      mode: "create",
      parentId: parent?.id ?? null,
      parentName: parent?.name ?? null,
    })
  }

  const openEditNode = (node: FolderTreeNode) => {
    setNodeForm({
      name: node.name,
      description: node.description ?? "",
      category: node.category ?? "",
      visibility: node.visibility,
      status: node.status,
      icon: node.icon ?? "",
      color: node.color ?? "",
    })
    setNodeDialog({ mode: "edit", node })
  }

  const handleSaveNode = async () => {
    if (!nodeDialog || !selectedTemplateId) return
    if (!nodeForm.name.trim()) {
      toast.error("Folder name is required")
      return
    }

    setMutationKey("save-node")
    try {
      if (nodeDialog.mode === "create") {
        const input: FolderNodeInput & { name: string } = {
          name: nodeForm.name.trim(),
          description: nodeForm.description.trim() || null,
          category: nodeForm.category.trim() || null,
          visibility: nodeForm.visibility,
          status: nodeForm.status,
          icon: nodeForm.icon.trim() || null,
          color: nodeForm.color.trim() || null,
          parentId: nodeDialog.parentId,
        }
        const created = await createFolderNode(selectedTemplateId, input)
        setNodeDialog(null)
        await refreshSelectedData(selectedTemplateId)
        toast.success(`Folder "${created.name}" created`)
      } else {
        const input: FolderNodeInput = {
          name: nodeForm.name.trim(),
          description: nodeForm.description.trim() || null,
          category: nodeForm.category.trim() || null,
          visibility: nodeForm.visibility,
          status: nodeForm.status,
          icon: nodeForm.icon.trim() || null,
          color: nodeForm.color.trim() || null,
        }
        const updated = await updateFolderNode(
          selectedTemplateId,
          nodeDialog.node.id,
          input,
        )
        setNodeDialog(null)
        await refreshSelectedData(selectedTemplateId)
        toast.success(`Folder "${updated.name}" updated`)
      }
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save folder"))
    } finally {
      setMutationKey(null)
    }
  }

  const openMoveNode = (node: FolderTreeNode) => {
    setMoveNode(node)
    setMoveParentValue(node.parentId ?? ROOT_PARENT_VALUE)
  }

  const handleMoveNode = async () => {
    if (!moveNode || !selectedTemplateId) return
    setMutationKey(`move-node:${moveNode.id}`)
    try {
      const moved = await moveFolderNode(selectedTemplateId, moveNode.id, {
        parentId: moveParentValue === ROOT_PARENT_VALUE ? null : moveParentValue,
      })
      setMoveNode(null)
      await refreshSelectedData(selectedTemplateId)
      toast.success(`Folder "${moved.name}" moved`)
    } catch (error) {
      toast.error(errorMessage(error, "Failed to move folder"))
    } finally {
      setMutationKey(null)
    }
  }

  const handleDuplicateNode = async (node: FolderTreeNode) => {
    if (!selectedTemplateId) return
    setMutationKey(`duplicate-node:${node.id}`)
    try {
      const duplicated = await duplicateFolderNode(selectedTemplateId, node.id)
      await refreshSelectedData(selectedTemplateId)
      toast.success(`Subtree duplicated as "${duplicated.name}"`)
    } catch (error) {
      toast.error(errorMessage(error, "Failed to duplicate subtree"))
    } finally {
      setMutationKey(null)
    }
  }

  const handleRestoreNode = async (node: FolderTreeNode) => {
    if (!selectedTemplateId) return
    setMutationKey(`restore-node:${node.id}`)
    try {
      const restored = await restoreFolderNode(selectedTemplateId, node.id)
      await refreshSelectedData(selectedTemplateId)
      toast.success(`Folder "${restored.name}" restored`)
    } catch (error) {
      toast.error(errorMessage(error, "Failed to restore folder"))
    } finally {
      setMutationKey(null)
    }
  }

  const handleConfirmAction = async () => {
    if (!confirmAction) return
    if (confirmAction.kind === "archive-node" && !selectedTemplateId) return

    const action = confirmAction
    setMutationKey(`${action.kind}:${action.kind === "archive-node" ? action.node.id : action.template.id}`)
    try {
      if (action.kind === "archive-template") {
        const archived = await archiveFolderTemplate(action.template.id)
        setConfirmAction(null)
        if (includeArchived) {
          setDetail(archived)
          await refreshSelectedData(action.template.id)
        } else {
          setSelectedTemplateId(null)
          setDetail(null)
          setAllNodes([])
          await Promise.all([loadTemplates(), loadTemplateOptions()])
        }
        toast.success(`Template "${action.template.name}" archived`)
      } else if (selectedTemplateId) {
        const archived = await archiveFolderNode(selectedTemplateId, action.node.id)
        setConfirmAction(null)
        await refreshSelectedData(selectedTemplateId)
        toast.success(`Folder "${archived.name}" archived`)
      }
    } catch (error) {
      toast.error(errorMessage(error, "Archive failed"))
    } finally {
      setMutationKey(null)
    }
  }

  const handleNodeAction = (action: NodeAction, node: FolderTreeNode) => {
    switch (action) {
      case "add":
        openCreateNode(node)
        break
      case "edit":
        openEditNode(node)
        break
      case "move":
        openMoveNode(node)
        break
      case "duplicate":
        void handleDuplicateNode(node)
        break
      case "archive":
        setConfirmAction({ kind: "archive-node", node })
        break
    }
  }

  const toggleNode = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const openAssignmentDialog = () => {
    setAssignmentType("UNIVERSITY")
    setAssignmentTargetId(NO_TARGET_VALUE)
    setAssignmentDialogOpen(true)
    void loadAssignmentTargets("UNIVERSITY")
  }

  const changeAssignmentType = (value: string) => {
    const type = value as FolderAssignmentTargetType
    setAssignmentType(type)
    void loadAssignmentTargets(type)
  }

  const handleAssignTemplate = async () => {
    if (!selectedTemplateId) return
    if (assignmentType !== "UNIVERSITY" && assignmentTargetId === NO_TARGET_VALUE) {
      toast.error(`Select a ${targetTypeLabel(assignmentType).toLowerCase()} target`)
      return
    }

    setMutationKey("assign-template")
    try {
      const updated = await assignFolderTemplate(
        selectedTemplateId,
        assignmentType,
        assignmentType === "UNIVERSITY" ? undefined : assignmentTargetId,
      )
      setAssignmentDialogOpen(false)
      setDetail(updated)
      await refreshSelectedData(selectedTemplateId)
      toast.success(`Template assigned to ${targetTypeLabel(assignmentType)}`)
    } catch (error) {
      toast.error(errorMessage(error, "Failed to assign template"))
    } finally {
      setMutationKey(null)
    }
  }

  const handleUnassignTemplate = async (assignment: FolderAssignment) => {
    setMutationKey(`unassign:${assignment.id}`)
    try {
      const updated = await unassignFolderTemplate(assignment.id)
      setDetail(updated)
      await refreshSelectedData(assignment.templateId)
      toast.success(
        `Assignment removed from ${assignment.targetName ?? targetTypeLabel(assignment.targetType)}`,
      )
    } catch (error) {
      toast.error(errorMessage(error, "Failed to remove assignment"))
    } finally {
      setMutationKey(null)
    }
  }

  const openVersions = (template: FolderTemplate) => {
    setVersionTemplate(template)
    setVersions([])
    setVersionsError(null)
    setRollbackTarget(null)
    setRollbackNote("")
    void loadVersionsFor(template.id)
  }

  const handleRollback = async () => {
    if (!versionTemplate || !rollbackTarget) return
    setMutationKey(`rollback:${versionTemplate.id}`)
    try {
      const rolledBack = await rollbackFolderTemplate(
        versionTemplate.id,
        rollbackTarget.version,
        rollbackNote.trim() || undefined,
      )
      detailRequestRef.current += 1
      setDetail(null)
      setAllNodes([])
      setExpandedNodeIds(new Set())
      setVersionTemplate(null)
      setVersions([])
      setRollbackTarget(null)
      setRollbackNote("")
      setSelectedTemplateId(rolledBack.template.id)
      await refreshSelectedData(rolledBack.template.id)
      toast.success(
        `Template rolled back to v${rollbackTarget.version}; current version is v${rolledBack.template.version}`,
      )
    } catch (error) {
      toast.error(errorMessage(error, "Failed to roll back template"))
    } finally {
      setMutationKey(null)
    }
  }

  const handleMainTabChange = (value: string) => {
    const tab = value as MainTab
    setMainTab(tab)
    if (tab === "assignments" && !selectedTemplateId && templateOptions.length > 0) {
      const firstActive = templateOptions.find((template) => !template.deletedAt)
      setSelectedTemplateId(firstActive?.id ?? templateOptions[0].id)
    }
  }

  const hasTemplateFilters =
    Boolean(templateSearch.trim()) || templateStatus !== ALL_VALUE || includeArchived
  const archivedNodes = flattenNodes(allNodes).filter((node) => Boolean(node.deletedAt))
  const activeFlatNodes = detail ? flattenNodes(detail.tree) : []
  const excludedMoveNodeIds = moveNode ? collectNodeIds(moveNode) : new Set<string>()
  const availableMoveParents = activeFlatNodes.filter(
    (node) => !excludedMoveNodeIds.has(node.id) && !node.deletedAt,
  )
  const baseSelectorTemplates = templateOptions.length > 0 ? templateOptions : templates
  const selectorTemplates =
    detail && !baseSelectorTemplates.some((template) => template.id === detail.template.id)
      ? [detail.template, ...baseSelectorTemplates]
      : baseSelectorTemplates
  const rollbackFieldChanges =
    versionTemplate && rollbackTarget
      ? snapshotFieldChanges(versionTemplate, rollbackTarget)
      : []
  const rollbackCurrentNodeCount =
    detail && versionTemplate && detail.template.id === versionTemplate.id
      ? countNodes(detail.tree)
      : versionTemplate?.nodeCount ?? 0
  const rollbackCurrentAssignmentCount =
    detail && versionTemplate && detail.template.id === versionTemplate.id
      ? detail.assignments.length
      : versionTemplate?.assignmentCount ?? 0
  const isMutating = mutationKey !== null

  return (
    <div className="min-w-0 content-padding">
      <PageHeader
        title="Dynamic Folder Builder"
        description="Design, version, and assign the folder structures used across the platform"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="shadow-soft"
              onClick={() => void handleRefresh()}
              disabled={refreshing || isMutating}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              size="sm"
              className="shadow-soft"
              onClick={openCreateTemplate}
              disabled={isMutating}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Template
            </Button>
          </>
        }
      />

      <Tabs value={mainTab} onValueChange={handleMainTabChange}>
        <TabsList className="mb-4 grid h-auto w-full grid-cols-3 sm:inline-grid sm:w-auto overflow-x-auto">
          <TabsTrigger value="templates" className="gap-1.5 px-2 sm:px-4">
            <GitBranch className="h-4 w-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="assignments" className="gap-1.5 px-2 sm:px-4">
            <Users className="h-4 w-4" />
            Assignments
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5 px-2 sm:px-4">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-0">
          <Card className="mb-4">
            <CardContent className="toolbar-padding flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  className="h-10 pl-9"
                  placeholder="Search templates by name, code, or description..."
                  value={templateSearch}
                  onChange={(event) => {
                    setTemplateSearch(event.target.value)
                    setTemplatePage(1)
                    setSelectedTemplateId(null)
                  }}
                />
              </div>
              <Select
                value={templateStatus}
                onValueChange={(value) => {
                  setTemplateStatus(value as TemplateStatusFilter)
                  setTemplatePage(1)
                  setSelectedTemplateId(null)
                }}
              >
                <SelectTrigger className="h-10 w-full lg:w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex h-10 items-center justify-between gap-3 rounded-lg border border-border px-3 lg:justify-start">
                <Label htmlFor="include-archived-templates" className="text-[13px] text-gray-600">
                  Include archived
                </Label>
                <Switch
                  id="include-archived-templates"
                  checked={includeArchived}
                  onCheckedChange={(checked) => {
                    setIncludeArchived(checked)
                    setTemplatePage(1)
                    setSelectedTemplateId(null)
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(270px,0.38fr)_minmax(0,1fr)] lg:items-start">
            <Card className="min-w-0 overflow-hidden lg:sticky lg:top-4">
              <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-gray-100 p-4">
                <div>
                  <CardTitle className="text-[14px]">Templates</CardTitle>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {templateTotal} total
                  </p>
                </div>
                <Badge variant="secondary">
                  {templatePage} / {templateTotalPages}
                </Badge>
              </CardHeader>
              <CardContent className="p-0">
                {templatesLoading ? (
                  <div className="space-y-2 p-3">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={index} variant="rectangular" className="h-[82px]" />
                    ))}
                  </div>
                ) : templatesError ? (
                  <InlineError message={templatesError} onRetry={() => void loadTemplates()} compact />
                ) : templates.length === 0 ? (
                  <EmptyState
                    variant={hasTemplateFilters ? "search" : "documents"}
                    title={hasTemplateFilters ? "No matching templates" : "No folder templates"}
                    description={
                      hasTemplateFilters
                        ? "Adjust the filters to find another template."
                        : "Create the first reusable folder structure."
                    }
                    action={{
                      label: hasTemplateFilters ? "Clear filters" : "Create template",
                      onClick: hasTemplateFilters ? clearTemplateFilters : openCreateTemplate,
                    }}
                    className="py-10"
                  />
                ) : (
                  <div className="max-h-[calc(100vh-330px)] min-h-[260px] space-y-1.5 overflow-y-auto p-2.5">
                    {templates.map((template) => {
                      const selected = template.id === selectedTemplateId
                      return (
                        <button
                          key={template.id}
                          type="button"
                          className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${
                            selected
                              ? "border-gray-900 bg-primary text-white shadow-soft"
                              : "border-gray-100 bg-white hover:border-border hover:bg-gray-50"
                          }`}
                          onClick={() => setSelectedTemplateId(template.id)}
                          aria-pressed={selected}
                        >
                          <div className="flex items-start gap-2.5">
                            <span
                              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                selected ? "bg-white/10" : "bg-amber-50"
                              }`}
                            >
                              <Folder
                                className={`h-4 w-4 ${
                                  selected ? "text-white" : "text-amber-600"
                                }`}
                                style={{ color: template.color ?? undefined }}
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-[13px] font-semibold">
                                  {template.name}
                                </span>
                                {template.deletedAt && (
                                  <span
                                    className={`shrink-0 text-[10px] font-medium uppercase ${
                                      selected ? "text-white/60" : "text-gray-400"
                                    }`}
                                  >
                                    Archived
                                  </span>
                                )}
                              </span>
                              <span
                                className={`mt-0.5 block truncate text-[11px] ${
                                  selected ? "text-white/60" : "text-gray-400"
                                }`}
                              >
                                {template.code} - v{template.version}
                              </span>
                              <span
                                className={`mt-2 flex items-center gap-3 text-[10px] ${
                                  selected ? "text-white/70" : "text-gray-500"
                                }`}
                              >
                                <span>{template.nodeCount} nodes</span>
                                <span>{template.assignmentCount} assignments</span>
                              </span>
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => changeTemplatePage(Math.max(1, templatePage - 1))}
                    disabled={templatePage <= 1 || templatesLoading}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      changeTemplatePage(Math.min(templateTotalPages, templatePage + 1))
                    }
                    disabled={templatePage >= templateTotalPages || templatesLoading}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="min-w-0">
              {detailLoading && !detail ? (
                <DetailSkeleton />
              ) : detailError && !detail ? (
                <Card>
                  <InlineError
                    message={detailError}
                    onRetry={() => {
                      if (selectedTemplateId) void loadTemplateDetail(selectedTemplateId)
                    }}
                  />
                </Card>
              ) : !detail ? (
                <Card>
                  <EmptyState
                    variant="documents"
                    title="Select a template"
                    description="Choose a template from the list to inspect and edit its folder structure."
                    className="min-h-[340px]"
                  />
                </Card>
              ) : (
                <Card className="min-w-0 overflow-hidden">
                  <div className="border-b border-gray-100 bg-gray-50/60 p-4 sm:p-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white shadow-soft">
                          <FolderOpen
                            className="h-5 w-5 text-amber-600"
                            style={{ color: detail.template.color ?? undefined }}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="truncate text-[17px] font-semibold text-gray-900">
                              {detail.template.name}
                            </h2>
                            <Badge
                              variant={
                                detail.template.deletedAt
                                  ? "archived"
                                  : detail.template.status === "ACTIVE"
                                    ? "success"
                                    : "warning"
                              }
                            >
                              {detail.template.deletedAt ? "ARCHIVED" : detail.template.status}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
                            <span className="font-mono">{detail.template.code}</span>
                            {detail.template.category && (
                              <span className="flex items-center gap-1">
                                <Tag className="h-3 w-3" />
                                {detail.template.category}
                              </span>
                            )}
                            <span>Updated {formatWireDate(detail.template.updatedAt)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openVersions(detail.template)}
                          disabled={isMutating}
                        >
                          <History className="mr-1.5 h-3.5 w-3.5" />
                          Versions
                        </Button>
                        {!detail.template.deletedAt && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditTemplate(detail.template)}
                              disabled={isMutating}
                            >
                              <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleDuplicateTemplate(detail.template)}
                              disabled={isMutating}
                            >
                              <Copy className="mr-1.5 h-3.5 w-3.5" />
                              Duplicate
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              onClick={() =>
                                setConfirmAction({
                                  kind: "archive-template",
                                  template: detail.template,
                                })
                              }
                              disabled={isMutating}
                            >
                              <Archive className="mr-1.5 h-3.5 w-3.5" />
                              Archive
                            </Button>
                          </>
                        )}
                        {detail.template.deletedAt && (
                          <Button
                            size="sm"
                            onClick={() => void handleRestoreTemplate(detail.template)}
                            disabled={isMutating}
                          >
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                            Restore
                          </Button>
                        )}
                      </div>
                    </div>

                    {detail.template.description && (
                      <p className="mt-4 max-w-3xl text-[13px] leading-5 text-gray-600">
                        {detail.template.description}
                      </p>
                    )}
                  </div>

                  <CardContent className="space-y-5 p-4 sm:p-5">
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          Version
                        </p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">
                          v{detail.template.version}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          Nodes
                        </p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">
                          {detail.template.nodeCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          Assigned
                        </p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">
                          {detail.template.assignmentCount}
                        </p>
                      </div>
                    </div>

                    <section className="min-w-0 overflow-hidden rounded-xl border border-border">
                      <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-[13px] font-semibold text-gray-900">
                            Folder structure
                          </h3>
                          <p className="mt-0.5 text-[11px] text-gray-400">
                            Expand branches to inspect nested folders. Use Move to reorganize.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => openCreateNode(null)}
                          disabled={Boolean(detail.template.deletedAt) || isMutating}
                        >
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Add root folder
                        </Button>
                      </div>

                      {detail.tree.length === 0 ? (
                        <EmptyState
                          variant="documents"
                          title="No folders yet"
                          description="Start this template by adding a root folder."
                          action={
                            detail.template.deletedAt
                              ? undefined
                              : { label: "Add root folder", onClick: () => openCreateNode(null) }
                          }
                          className="py-10"
                        />
                      ) : (
                        <div className="overflow-x-auto">
                          <ul className="min-w-[460px]">
                            {detail.tree.map((node) => (
                              <FolderNodeBranch
                                key={node.id}
                                node={node}
                                depth={0}
                                expandedIds={expandedNodeIds}
                                disabled={Boolean(detail.template.deletedAt) || isMutating}
                                onToggle={toggleNode}
                                onAction={handleNodeAction}
                              />
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>

                    {archivedNodes.length > 0 && (
                      <section className="overflow-hidden rounded-xl border border-border">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 bg-gray-50/60 px-4 py-3 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400"
                          onClick={() => setArchivedNodesExpanded((current) => !current)}
                        >
                          <span>
                            <span className="block text-[13px] font-semibold text-gray-900">
                              Archived nodes
                            </span>
                            <span className="mt-0.5 block text-[11px] text-gray-400">
                              {archivedNodes.length} restorable folder
                              {archivedNodes.length === 1 ? "" : "s"}
                            </span>
                          </span>
                          {archivedNodesExpanded ? (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          )}
                        </button>
                        {archivedNodesExpanded && (
                          <div className="divide-y divide-gray-100 border-t border-gray-100">
                            {archivedNodes.map((node) => (
                              <div
                                key={node.id}
                                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="truncate text-[13px] font-medium text-gray-700">
                                      {node.name}
                                    </span>
                                    <Badge variant="archived">ARCHIVED</Badge>
                                    {node.category && (
                                      <span className="text-[11px] text-gray-400">
                                        {node.category}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-gray-400">
                                    Level {node.level} - archived {node.deletedAt ? formatWireDate(node.deletedAt) : ""}
                                  </p>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="self-start sm:self-auto"
                                  onClick={() => void handleRestoreNode(node)}
                                  disabled={isMutating || Boolean(detail.template.deletedAt)}
                                >
                                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                  Restore
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )}

                    <section className="rounded-xl border border-border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-[13px] font-semibold text-gray-900">
                            Assignments
                          </h3>
                          <p className="mt-0.5 text-[11px] text-gray-400">
                            {detail.assignments.length === 0
                              ? "This template is not assigned to an organization target."
                              : `${detail.assignments.length} active assignment${
                                  detail.assignments.length === 1 ? "" : "s"
                                }`}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setMainTab("assignments")}
                        >
                          <Users className="mr-1.5 h-3.5 w-3.5" />
                          Manage assignments
                        </Button>
                      </div>
                      {detail.assignments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {detail.assignments.slice(0, 5).map((assignment) => (
                            <Badge key={assignment.id} variant="secondary">
                              {targetTypeLabel(assignment.targetType)}: {assignment.targetName ?? "University"}
                            </Badge>
                          ))}
                          {detail.assignments.length > 5 && (
                            <Badge variant="outline">+{detail.assignments.length - 5} more</Badge>
                          )}
                        </div>
                      )}
                    </section>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="assignments" className="mt-0 space-y-4">
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full sm:max-w-md">
                <Label className="mb-2 block text-[12px] font-medium text-gray-600">
                  Selected template
                </Label>
                <Select
                  value={selectedTemplateId ?? undefined}
                  onValueChange={setSelectedTemplateId}
                  disabled={templateOptionsLoading && selectorTemplates.length === 0}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectorTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name} ({template.code}){template.deletedAt ? " - archived" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="max-w-lg text-[12px] leading-5 text-gray-500">
                Assign one template per target. Assigning another template to the same target
                replaces its current assignment.
              </p>
            </CardContent>
          </Card>

          {templateOptionsError && templateOptions.length === 0 && (
            <Card>
              <InlineError
                message={templateOptionsError}
                onRetry={() => void loadTemplateOptions()}
                compact
              />
            </Card>
          )}

          {!templateOptionsLoading && selectorTemplates.length === 0 ? (
            <Card>
              <EmptyState
                variant="documents"
                title="No templates available"
                description="Create a folder template before configuring assignments."
                action={{ label: "Create template", onClick: openCreateTemplate }}
              />
            </Card>
          ) : detailLoading && !detail ? (
            <DetailSkeleton />
          ) : detailError && !detail ? (
            <Card>
              <InlineError
                message={detailError}
                onRetry={() => {
                  if (selectedTemplateId) void loadTemplateDetail(selectedTemplateId)
                }}
              />
            </Card>
          ) : detail ? (
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b border-gray-100 p-4 sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="truncate text-[16px]">
                      {detail.template.name}
                    </CardTitle>
                    <Badge
                      variant={detail.template.deletedAt ? "archived" : "success"}
                    >
                      {detail.template.deletedAt ? "ARCHIVED" : detail.template.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-gray-500">
                    {detail.template.code} - {detail.assignments.length} assignment
                    {detail.assignments.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={openAssignmentDialog}
                  disabled={Boolean(detail.template.deletedAt) || isMutating}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Assign template
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {detail.assignments.length === 0 ? (
                  <EmptyState
                    variant="users"
                    title="No active assignments"
                    description="Assign this structure to the university or an organization target."
                    action={
                      detail.template.deletedAt
                        ? undefined
                        : { label: "Add assignment", onClick: openAssignmentDialog }
                    }
                  />
                ) : (
                  <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                    {detail.assignments.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="flex min-w-0 flex-col justify-between gap-4 rounded-xl border border-border p-4"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="secondary">
                              {targetTypeLabel(assignment.targetType)}
                            </Badge>
                            <span className="text-[10px] text-gray-400">
                              {formatWireDate(assignment.createdAt)}
                            </span>
                          </div>
                          <p className="mt-3 truncate text-[14px] font-semibold text-gray-900">
                            {assignment.targetName ?? "University-wide"}
                          </p>
                          {assignment.targetId && (
                            <p className="mt-1 truncate font-mono text-[10px] text-gray-400">
                              {assignment.targetId}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="self-start text-red-600 hover:text-red-700"
                          onClick={() => void handleUnassignTemplate(assignment)}
                          disabled={isMutating}
                        >
                          <Archive className="mr-1.5 h-3.5 w-3.5" />
                          Unassign
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <EmptyState
                variant="documents"
                title="Select a template"
                description="Choose a template to view its target assignments."
              />
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-0 space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_220px_auto]">
              <Select
                value={historyTemplateFilter}
                onValueChange={(value) => {
                  setHistoryTemplateFilter(value)
                  setHistoryPage(1)
                }}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All templates</SelectItem>
                  {selectorTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name} ({template.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={historyActionFilter}
                onValueChange={(value) => {
                  setHistoryActionFilter(value as HistoryActionFilter)
                  setHistoryPage(1)
                }}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All actions</SelectItem>
                  {HISTORY_ACTIONS.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="h-10 sm:col-span-2 lg:col-span-1"
                onClick={() => void loadHistoryEntries()}
                disabled={historyLoading}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${historyLoading ? "animate-spin" : ""}`}
                />
                Refresh history
              </Button>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-gray-100 p-4">
              <div>
                <CardTitle className="text-[14px]">Recent folder builder activity</CardTitle>
                <p className="mt-0.5 text-[11px] text-gray-400">{historyTotal} events</p>
              </div>
              <Badge variant="secondary">
                {historyPage} / {historyTotalPages}
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              {historyLoading ? (
                <div className="space-y-3 p-5">
                  {Array.from({ length: 7 }).map((_, index) => (
                    <Skeleton key={index} variant="rectangular" className="h-12" />
                  ))}
                </div>
              ) : historyError ? (
                <InlineError
                  message={historyError}
                  onRetry={() => void loadHistoryEntries()}
                />
              ) : historyEntries.length === 0 ? (
                <EmptyState
                  variant="activity"
                  title="No history entries"
                  description="Folder template changes will appear here."
                />
              ) : (
                <>
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Action</TableHead>
                          <TableHead>Template ID</TableHead>
                          <TableHead>Version</TableHead>
                          <TableHead>Actor</TableHead>
                          <TableHead className="text-right">Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {historyEntries.map((entry) => {
                          const templateName = templateOptions.find(
                            (template) => template.id === entry.templateId,
                          )?.name
                          return (
                            <TableRow key={entry.id}>
                              <TableCell>
                                <Badge variant={historyBadgeVariant(entry.action)}>
                                  {entry.action}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {templateName && (
                                  <div className="text-[13px] font-medium text-gray-900">
                                    {templateName}
                                  </div>
                                )}
                                <div className="max-w-[260px] truncate font-mono text-[11px] text-gray-400">
                                  {entry.templateId}
                                </div>
                              </TableCell>
                              <TableCell className="text-[13px] text-gray-600">
                                {entry.versionFrom ?? "-"} -&gt; {entry.versionTo ?? "-"}
                              </TableCell>
                              <TableCell className="text-[13px] text-gray-600">
                                {entry.actorName ?? "System"}
                              </TableCell>
                              <TableCell
                                className="text-right text-[12px] text-gray-500"
                                title={entry.createdAt}
                              >
                                {formatWireDate(entry.createdAt)}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="divide-y divide-gray-100 md:hidden">
                    {historyEntries.map((entry) => (
                      <div key={entry.id} className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <Badge variant={historyBadgeVariant(entry.action)}>
                            {entry.action}
                          </Badge>
                          <span className="text-[10px] text-gray-400" title={entry.createdAt}>
                            {formatWireDate(entry.createdAt)}
                          </span>
                        </div>
                        <p className="mt-3 break-all font-mono text-[11px] text-gray-500">
                          {entry.templateId}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-[12px] text-gray-500">
                          <span>
                            v{entry.versionFrom ?? "-"} -&gt; v{entry.versionTo ?? "-"}
                          </span>
                          <span>{entry.actorName ?? "System"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                  disabled={historyPage <= 1 || historyLoading}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="text-[11px] text-gray-400">
                  Page {historyPage} of {historyTotalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setHistoryPage((page) => Math.min(historyTotalPages, page + 1))
                  }
                  disabled={historyPage >= historyTotalPages || historyLoading}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {templateDialog && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !isMutating) setTemplateDialog(null)
          }}
        >
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[620px]">
            <DialogHeader>
              <DialogTitle>
                {templateDialog.mode === "create" ? "Create folder template" : "Edit folder template"}
              </DialogTitle>
              <DialogDescription>
                {templateDialog.mode === "create"
                  ? "Create the template first, then add its folder nodes."
                  : `Editing v${templateDialog.template.version} creates a new version snapshot.`}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-3 sm:grid-cols-2">
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="template-name">Name</Label>
                <Input
                  id="template-name"
                  className="h-10"
                  value={templateForm.name}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Accreditation Evidence Library"
                  disabled={isMutating}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="template-code">Code</Label>
                <Input
                  id="template-code"
                  className="h-10 font-mono"
                  value={templateForm.code}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      code: event.target.value,
                    }))
                  }
                  placeholder="e.g. ACCREDITATION"
                  disabled={isMutating}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="template-category">Category</Label>
                <Input
                  id="template-category"
                  className="h-10"
                  value={templateForm.category}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                  placeholder="Optional category"
                  disabled={isMutating}
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="template-description">Description</Label>
                <Textarea
                  id="template-description"
                  className="min-h-[84px]"
                  value={templateForm.description}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Describe where this folder structure should be used."
                  disabled={isMutating}
                />
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={templateForm.status}
                  onValueChange={(value) =>
                    setTemplateForm((current) => ({
                      ...current,
                      status: value as FolderTemplateStatus,
                    }))
                  }
                  disabled={isMutating}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="template-icon">Icon</Label>
                <Input
                  id="template-icon"
                  className="h-10"
                  value={templateForm.icon}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      icon: event.target.value,
                    }))
                  }
                  placeholder="Optional icon key"
                  disabled={isMutating}
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="template-color">Color</Label>
                <div className="flex items-center gap-2">
                  <span
                    className="h-9 w-9 shrink-0 rounded-lg border border-border bg-gray-100"
                    style={{ backgroundColor: templateForm.color || undefined }}
                    aria-hidden="true"
                  />
                  <Input
                    id="template-color"
                    className="h-10"
                    value={templateForm.color}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        color: event.target.value,
                      }))
                    }
                    placeholder="Optional color, e.g. #2563EB"
                    disabled={isMutating}
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setTemplateDialog(null)}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleSaveTemplate()} disabled={isMutating}>
                {mutationKey === "save-template"
                  ? "Saving..."
                  : templateDialog.mode === "create"
                    ? "Create template"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {nodeDialog && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !isMutating) setNodeDialog(null)
          }}
        >
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[620px]">
            <DialogHeader>
              <DialogTitle>
                {nodeDialog.mode === "create" ? "Add folder" : "Edit folder"}
              </DialogTitle>
              <DialogDescription>
                {nodeDialog.mode === "create"
                  ? nodeDialog.parentName
                    ? `This folder will be added below "${nodeDialog.parentName}".`
                    : "This folder will be added at the template root."
                  : "Update this node without changing its current parent."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-3 sm:grid-cols-2">
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="node-name">Name</Label>
                <Input
                  id="node-name"
                  className="h-10"
                  value={nodeForm.name}
                  onChange={(event) =>
                    setNodeForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Folder name"
                  disabled={isMutating}
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="node-description">Description</Label>
                <Textarea
                  id="node-description"
                  className="min-h-[78px]"
                  value={nodeForm.description}
                  onChange={(event) =>
                    setNodeForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Optional guidance for this folder"
                  disabled={isMutating}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="node-category">Category</Label>
                <Input
                  id="node-category"
                  className="h-10"
                  value={nodeForm.category}
                  onChange={(event) =>
                    setNodeForm((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                  placeholder="Optional category"
                  disabled={isMutating}
                />
              </div>
              <div className="grid gap-2">
                <Label>Visibility</Label>
                <Select
                  value={nodeForm.visibility}
                  onValueChange={(value) =>
                    setNodeForm((current) => ({
                      ...current,
                      visibility: value as FolderNodeVisibility,
                    }))
                  }
                  disabled={isMutating}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VISIBLE">Visible</SelectItem>
                    <SelectItem value="HIDDEN">Hidden</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={nodeForm.status}
                  onValueChange={(value) =>
                    setNodeForm((current) => ({
                      ...current,
                      status: value as FolderNodeStatus,
                    }))
                  }
                  disabled={isMutating}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="node-icon">Icon</Label>
                <Input
                  id="node-icon"
                  className="h-10"
                  value={nodeForm.icon}
                  onChange={(event) =>
                    setNodeForm((current) => ({ ...current, icon: event.target.value }))
                  }
                  placeholder="Optional icon key"
                  disabled={isMutating}
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="node-color">Color</Label>
                <div className="flex items-center gap-2">
                  <span
                    className="h-9 w-9 shrink-0 rounded-lg border border-border bg-gray-100"
                    style={{ backgroundColor: nodeForm.color || undefined }}
                    aria-hidden="true"
                  />
                  <Input
                    id="node-color"
                    className="h-10"
                    value={nodeForm.color}
                    onChange={(event) =>
                      setNodeForm((current) => ({
                        ...current,
                        color: event.target.value,
                      }))
                    }
                    placeholder="Optional color, e.g. #F59E0B"
                    disabled={isMutating}
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setNodeDialog(null)}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleSaveNode()} disabled={isMutating}>
                {mutationKey === "save-node"
                  ? "Saving..."
                  : nodeDialog.mode === "create"
                    ? "Add folder"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {moveNode && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !isMutating) setMoveNode(null)
          }}
        >
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Move folder</DialogTitle>
              <DialogDescription>
                Choose a new parent for "{moveNode.name}". The folder and its subtree move together.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-4">
              <Label>New parent</Label>
              <Select
                value={moveParentValue}
                onValueChange={setMoveParentValue}
                disabled={isMutating}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select parent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_PARENT_VALUE}>Template root</SelectItem>
                  {availableMoveParents.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {`${"- ".repeat(Math.max(0, node.level))}${node.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-400">
                The selected folder and all descendants are excluded from this list.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setMoveNode(null)}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleMoveNode()} disabled={isMutating}>
                <Move className="mr-2 h-4 w-4" />
                {mutationKey?.startsWith("move-node:") ? "Moving..." : "Move folder"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {confirmAction && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !isMutating) setConfirmAction(null)
          }}
        >
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>
                Archive {confirmAction.kind === "archive-template" ? "template" : "folder"}?
              </DialogTitle>
              <DialogDescription>
                {confirmAction.kind === "archive-template"
                  ? `"${confirmAction.template.name}" will be removed from active use. Its versions remain available.`
                  : `"${confirmAction.node.name}" will be archived. Descendants remain stored but stay hidden until this parent is restored.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4 gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmAction(null)}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleConfirmAction()}
                disabled={isMutating}
              >
                <Archive className="mr-2 h-4 w-4" />
                {isMutating ? "Archiving..." : "Archive"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {assignmentDialogOpen && detail && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !isMutating) setAssignmentDialogOpen(false)
          }}
        >
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Assign template</DialogTitle>
              <DialogDescription>
                Apply "{detail.template.name}" to a platform or organization target.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-5 text-amber-800">
                Re-assignment replaces the current template assignment for the selected target.
              </div>
              <div className="grid gap-2">
                <Label>Target type</Label>
                <Select
                  value={assignmentType}
                  onValueChange={changeAssignmentType}
                  disabled={isMutating}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNMENT_TARGETS.map((target) => (
                      <SelectItem key={target.value} value={target.value}>
                        {target.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {assignmentType === "UNIVERSITY" ? (
                <div className="rounded-lg border border-border bg-gray-50 px-3 py-3 text-[12px] text-gray-600">
                  University assignments do not require a target record.
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label>{targetTypeLabel(assignmentType)} target</Label>
                  {assignmentTargetsError ? (
                    <div className="rounded-lg border border-red-100">
                      <InlineError
                        message={assignmentTargetsError}
                        onRetry={() => void loadAssignmentTargets(assignmentType)}
                        compact
                      />
                    </div>
                  ) : (
                    <Select
                      value={assignmentTargetId}
                      onValueChange={setAssignmentTargetId}
                      disabled={assignmentTargetsLoading || isMutating}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue
                          placeholder={
                            assignmentTargetsLoading ? "Loading targets..." : "Select target"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_TARGET_VALUE} disabled>
                          Select target
                        </SelectItem>
                        {assignmentTargets.map((target) => (
                          <SelectItem key={target.id} value={target.id}>
                            {target.name}{target.code ? ` (${target.code})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {!assignmentTargetsLoading &&
                    !assignmentTargetsError &&
                    assignmentTargets.length === 0 && (
                      <p className="text-[11px] text-amber-700">
                        No active {targetTypeLabel(assignmentType).toLowerCase()} targets are available.
                      </p>
                    )}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setAssignmentDialogOpen(false)}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleAssignTemplate()}
                disabled={
                  isMutating ||
                  assignmentTargetsLoading ||
                  Boolean(assignmentTargetsError) ||
                  (assignmentType !== "UNIVERSITY" && assignmentTargets.length === 0)
                }
              >
                <Users className="mr-2 h-4 w-4" />
                {mutationKey === "assign-template" ? "Assigning..." : "Assign template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {versionTemplate && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !isMutating) setVersionTemplate(null)
          }}
        >
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[780px]">
            <DialogHeader>
              <DialogTitle>Template versions - {versionTemplate.name}</DialogTitle>
              <DialogDescription>
                Current version v{versionTemplate.version}. Select an older snapshot to compare and roll back.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-3 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="max-h-[430px] min-h-[230px] overflow-y-auto pr-1">
                {versionsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={index} variant="rectangular" className="h-[86px]" />
                    ))}
                  </div>
                ) : versionsError ? (
                  <div className="rounded-lg border border-red-100">
                    <InlineError
                      message={versionsError}
                      onRetry={() => void loadVersionsFor(versionTemplate.id)}
                      compact
                    />
                  </div>
                ) : versions.length === 0 ? (
                  <EmptyState
                    variant="activity"
                    title="No versions recorded"
                    description="Version snapshots will appear after template changes."
                    className="py-10"
                  />
                ) : (
                  <div className="space-y-2">
                    {versions.map((version) => {
                      const isCurrent = version.version === versionTemplate.version
                      const isOlder = version.version < versionTemplate.version
                      const selected = rollbackTarget?.id === version.id
                      return (
                        <button
                          key={version.id}
                          type="button"
                          className={`w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${
                            selected
                              ? "border-gray-900 bg-primary text-white"
                              : isCurrent
                                ? "border-emerald-200 bg-emerald-50/50"
                                : "border-border hover:bg-gray-50"
                          } ${!isOlder ? "cursor-default" : ""}`}
                          onClick={() => {
                            if (isOlder) {
                              setRollbackTarget(version)
                              setRollbackNote("")
                            }
                          }}
                          disabled={!isOlder}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-semibold">v{version.version}</span>
                              <Badge
                                variant={isCurrent ? "success" : "secondary"}
                                className={selected ? "bg-white/10 text-white" : ""}
                              >
                                {isCurrent ? "CURRENT" : version.changeType}
                              </Badge>
                            </span>
                            <span
                              className={`text-[10px] ${selected ? "text-white/60" : "text-gray-400"}`}
                            >
                              {formatWireDate(version.createdAt)}
                            </span>
                          </span>
                          <span
                            className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] ${
                              selected ? "text-white/70" : "text-gray-500"
                            }`}
                          >
                            <span>{countNodes(version.data.nodes)} nodes</span>
                            <span>{version.data.assignments.length} assignments</span>
                            <span>by {version.changedByName ?? "System"}</span>
                          </span>
                          {version.changeNote && (
                            <span
                              className={`mt-1.5 block truncate text-[11px] ${
                                selected ? "text-white/60" : "text-gray-400"
                              }`}
                            >
                              {version.changeNote}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-gray-50/50 p-4">
                {rollbackTarget ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-[13px] font-semibold text-gray-900">
                        Current vs v{rollbackTarget.version}
                      </h3>
                      <p className="mt-1 text-[11px] leading-4 text-gray-500">
                        Rollback restores the selected snapshot and creates a new current version.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-border bg-white p-3">
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Current</p>
                        <p className="mt-1 text-[13px] font-semibold text-gray-900">
                          {rollbackCurrentNodeCount} nodes
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {rollbackCurrentAssignmentCount} assignments
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-white p-3">
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">
                          v{rollbackTarget.version}
                        </p>
                        <p className="mt-1 text-[13px] font-semibold text-gray-900">
                          {countNodes(rollbackTarget.data.nodes)} nodes
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {rollbackTarget.data.assignments.length} assignments
                        </p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-white p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                        Template fields changed
                      </p>
                      <p className="mt-1.5 text-[12px] text-gray-600">
                        {rollbackFieldChanges.length > 0
                          ? rollbackFieldChanges.join(", ")
                          : "No template metadata differences"}
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="rollback-note">Rollback note</Label>
                      <Textarea
                        id="rollback-note"
                        className="min-h-[72px] bg-white"
                        value={rollbackNote}
                        onChange={(event) => setRollbackNote(event.target.value)}
                        placeholder="Optional reason for rollback"
                        disabled={isMutating}
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => void handleRollback()}
                      disabled={isMutating}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      {mutationKey?.startsWith("rollback:")
                        ? "Rolling back..."
                        : `Confirm rollback to v${rollbackTarget.version}`}
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-h-[250px] flex-col items-center justify-center text-center">
                    <Clock className="h-8 w-8 text-gray-300" />
                    <p className="mt-3 text-[13px] font-medium text-gray-700">
                      Select an older version
                    </p>
                    <p className="mt-1 max-w-[210px] text-[11px] leading-4 text-gray-400">
                      The comparison and rollback confirmation will appear here.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
