import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  FileCog,
  GripVertical,
  History,
  ListChecks,
  MoreVertical,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { toast } from "@/lib/toast";
import {
  archiveWorkflowDefinition,
  archiveWorkflowStep,
  archiveWorkflowTransition,
  assignWorkflowDefinition,
  createWorkflowDefinition,
  createWorkflowStep,
  createWorkflowTransition,
  getWorkflowDefinition,
  getWorkflowInstance,
  listWorkflowAssignments,
  listWorkflowDefinitions,
  listWorkflowHistory,
  listWorkflowInstances,
  listWorkflowTargetOptions,
  listWorkflowVersions,
  publishWorkflowDefinition,
  restoreWorkflowDefinition,
  restoreWorkflowStep,
  restoreWorkflowTransition,
  rollbackWorkflowDefinition,
  unassignWorkflow,
  updateWorkflowDefinition,
  updateWorkflowStep,
  updateWorkflowTransition,
  validateWorkflowDefinition,
  type WorkflowAssignment,
  type WorkflowAssignmentTargetType,
  type WorkflowChangeType,
  type WorkflowDefinition,
  type WorkflowDefinitionDetail,
  type WorkflowDefinitionStatus,
  type WorkflowEntityType,
  type WorkflowHistoryEntry,
  type WorkflowInstanceView,
  type WorkflowInstanceStatus,
  type WorkflowStep,
  type WorkflowStepType,
  type WorkflowTargetOption,
  type WorkflowTransition,
  type WorkflowValidationIssue,
  type WorkflowValidationResult,
  type WorkflowVersion,
} from "@/services/root";
import { apiPost } from "@/lib/http";

const PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 20;
const ALL = "ALL";
const NO_TARGET = "__NO_TARGET__";

type MainTab = "builder" | "assignments" | "instances" | "history";
type DefinitionDialog =
  | { mode: "create" }
  | { mode: "edit"; definition: WorkflowDefinition };
type StepDialog =
  | { mode: "create" }
  | { mode: "edit"; step: WorkflowStep };
type TransitionDialog =
  | { mode: "create" }
  | { mode: "edit"; transition: WorkflowTransition };

interface DefinitionForm {
  name: string;
  code: string;
  description: string;
  entityType: WorkflowEntityType;
}

interface StepForm {
  code: string;
  name: string;
  description: string;
  type: WorkflowStepType;
  roleName: string;
  permissionCode: string;
  sortOrder: string;
}

interface TransitionForm {
  fromStepId: string;
  toStepId: string;
  actionCode: string;
  requiredPermission: string;
  sortOrder: string;
}

const EMPTY_DEFINITION: DefinitionForm = {
  name: "",
  code: "",
  description: "",
  entityType: "DOCUMENT_REQUEST",
};

const EMPTY_STEP: StepForm = {
  code: "",
  name: "",
  description: "",
  type: "TASK",
  roleName: "",
  permissionCode: "",
  sortOrder: "0",
};

const EMPTY_TRANSITION: TransitionForm = {
  fromStepId: "",
  toStepId: "",
  actionCode: "",
  requiredPermission: "",
  sortOrder: "0",
};

const ENTITY_TYPES: Array<{ value: WorkflowEntityType; label: string }> = [
  { value: "DOCUMENT_REQUEST", label: "Document Request" },
  { value: "AACCUP_SUBMISSION", label: "AACCUP Submission" },
  { value: "DOCUMENT", label: "Document" },
];

const STEP_TYPES: Array<{ value: WorkflowStepType; label: string }> = [
  { value: "START", label: "Start" },
  { value: "TASK", label: "Task" },
  { value: "REVIEW", label: "Review" },
  { value: "APPROVAL", label: "Approval" },
  { value: "END", label: "End" },
];

const TARGET_TYPES: Array<{ value: WorkflowAssignmentTargetType; label: string }> = [
  { value: "UNIVERSITY", label: "University" },
  { value: "COLLEGE", label: "College" },
  { value: "DEPARTMENT", label: "Department" },
  { value: "PROGRAM", label: "Program" },
  { value: "OFFICE", label: "Office" },
  { value: "AACCUP_AREA", label: "AACCUP Area" },
  { value: "ACCREDITATION_CYCLE", label: "Accreditation Cycle" },
];

const HISTORY_ACTIONS: WorkflowChangeType[] = [
  "CREATED",
  "UPDATED",
  "VALIDATED",
  "PUBLISHED",
  "ASSIGNED",
  "UNASSIGNED",
  "ARCHIVED",
  "RESTORED",
  "ROLLED_BACK",
];

const WORKFLOW_ENTITY_ACTIONS: Record<WorkflowEntityType, string> = {
  DOCUMENT_REQUEST: "APPROVE, REJECT, FULFILL, CANCEL",
  AACCUP_SUBMISSION: "APPROVE, REJECT, REQUEST_REVISION",
  DOCUMENT: "SUBMIT_FOR_REVIEW, APPROVE, PUBLISH, ARCHIVE, RESET_TO_DRAFT",
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function entityTypeLabel(type: WorkflowEntityType): string {
  return ENTITY_TYPES.find((item) => item.value === type)?.label ?? type;
}

function stepTypeLabel(type: WorkflowStepType): string {
  return STEP_TYPES.find((item) => item.value === type)?.label ?? type;
}

function targetLabel(type: WorkflowAssignmentTargetType): string {
  return TARGET_TYPES.find((item) => item.value === type)?.label ?? type;
}

function statusBadge(status: WorkflowDefinitionStatus) {
  switch (status) {
    case "PUBLISHED":
      return <Badge className="bg-emerald-100 text-emerald-700">Published</Badge>;
    case "ARCHIVED":
      return <Badge variant="secondary">Archived</Badge>;
    default:
      return <Badge variant="outline" className="text-amber-700">Draft</Badge>;
  }
}

function instanceStatusBadge(status: WorkflowInstanceStatus) {
  switch (status) {
    case "COMPLETED":
      return <Badge className="bg-emerald-100 text-emerald-700">Completed</Badge>;
    case "TERMINATED":
      return <Badge variant="danger">Terminated</Badge>;
    default:
      return <Badge className="bg-sky-100 text-sky-700">Running</Badge>;
  }
}

function InlineError({ message, retry, compact = false }: { message: string; retry?: () => void; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${compact ? "py-4" : "py-12"} px-4 text-center`}>
      <CircleAlert className="h-6 w-6 text-red-400" />
      <p className="text-[13px] text-slate-600">{message}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </div>
  );
}

export default function RootWorkflowBuilder() {
  const [mainTab, setMainTab] = useState<MainTab>("builder");

  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [definitionPage, setDefinitionPage] = useState(1);
  const [definitionPages, setDefinitionPages] = useState(1);
  const [definitionTotal, setDefinitionTotal] = useState(0);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<WorkflowDefinitionStatus | typeof ALL>(ALL);
  const [entityFilter, setEntityFilter] = useState<WorkflowEntityType | typeof ALL>(ALL);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [definitionsLoading, setDefinitionsLoading] = useState(true);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);
  const definitionRequest = useRef(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowDefinitionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);
  const [busy, setBusy] = useState<string | null>(null);

  const [definitionDialog, setDefinitionDialog] = useState<DefinitionDialog | null>(null);
  const [definitionForm, setDefinitionForm] = useState<DefinitionForm>({ ...EMPTY_DEFINITION });
  const [stepDialog, setStepDialog] = useState<StepDialog | null>(null);
  const [stepForm, setStepForm] = useState<StepForm>({ ...EMPTY_STEP });
  const [transitionDialog, setTransitionDialog] = useState<TransitionDialog | null>(null);
  const [transitionForm, setTransitionForm] = useState<TransitionForm>({ ...EMPTY_TRANSITION });

  const [validationResult, setValidationResult] = useState<WorkflowValidationResult | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState("");

  const [assignments, setAssignments] = useState<WorkflowAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentType, setAssignmentType] = useState<WorkflowAssignmentTargetType>("UNIVERSITY");
  const [assignmentTarget, setAssignmentTarget] = useState(NO_TARGET);
  const [assignmentPriority, setAssignmentPriority] = useState("0");
  const [targetOptions, setTargetOptions] = useState<WorkflowTargetOption[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);

  const [historyRows, setHistoryRows] = useState<WorkflowHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPages, setHistoryPages] = useState(1);
  const [historyAction, setHistoryAction] = useState<WorkflowChangeType | typeof ALL>(ALL);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [versionDefinition, setVersionDefinition] = useState<WorkflowDefinition | null>(null);
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<WorkflowVersion | null>(null);
  const [rollbackNote, setRollbackNote] = useState("");

  const [instances, setInstances] = useState<WorkflowInstanceView[]>([]);
  const [instancePage, setInstancePage] = useState(1);
  const [instancePages, setInstancePages] = useState(1);
  const [instanceStatus, setInstanceStatus] = useState<WorkflowInstanceStatus | typeof ALL>(ALL);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [instancesError, setInstancesError] = useState<string | null>(null);
  const [instanceDetail, setInstanceDetail] = useState<WorkflowInstanceView | null>(null);
  const [instanceDetailLoading, setInstanceDetailLoading] = useState(false);
  const [performAction, setPerformAction] = useState("");

  const loadDefinitions = useCallback(async () => {
    const requestId = ++definitionRequest.current;
    setDefinitionsLoading(true);
    setDefinitionsError(null);
    try {
      const result = await listWorkflowDefinitions({
        page: definitionPage,
        pageSize: PAGE_SIZE,
        q: deferredSearch.trim() || undefined,
        status: statusFilter === ALL ? undefined : statusFilter,
        entityType: entityFilter === ALL ? undefined : entityFilter,
        includeArchived: includeArchived || undefined,
      });
      if (requestId !== definitionRequest.current) return;
      setDefinitions(result.items);
      setDefinitionPages(Math.max(1, result.meta.totalPages));
      setDefinitionTotal(result.meta.total);
      setSelectedId((current) => {
        if (current && result.items.some((definition) => definition.id === current))
          return current;
        return result.items[0]?.id ?? null;
      });
    } catch (error) {
      if (requestId === definitionRequest.current)
        setDefinitionsError(errorText(error, "Failed to load workflow definitions"));
    } finally {
      if (requestId === definitionRequest.current) setDefinitionsLoading(false);
    }
  }, [deferredSearch, entityFilter, includeArchived, statusFilter, definitionPage]);

  const loadDetail = useCallback(async (id: string, showLoading = true) => {
    const requestId = ++detailRequest.current;
    if (showLoading) setDetailLoading(true);
    setDetailError(null);
    try {
      const nextDetail = await getWorkflowDefinition(id);
      if (requestId !== detailRequest.current) return;
      setDetail(nextDetail);
    } catch (error) {
      if (requestId === detailRequest.current)
        setDetailError(errorText(error, "Failed to load workflow detail"));
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  }, []);

  const loadAssignments = useCallback(async () => {
    setAssignmentsLoading(true);
    setAssignmentsError(null);
    try {
      setAssignments(await listWorkflowAssignments());
    } catch (error) {
      setAssignmentsError(errorText(error, "Failed to load assignments"));
    } finally {
      setAssignmentsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await listWorkflowHistory({
        page: historyPage,
        pageSize: HISTORY_PAGE_SIZE,
        action: historyAction === ALL ? undefined : historyAction,
      });
      setHistoryRows(result.items);
      setHistoryPages(Math.max(1, result.meta.totalPages));
    } catch (error) {
      setHistoryError(errorText(error, "Failed to load workflow history"));
    } finally {
      setHistoryLoading(false);
    }
  }, [historyAction, historyPage]);

  const loadInstances = useCallback(async () => {
    setInstancesLoading(true);
    setInstancesError(null);
    try {
      const result = await listWorkflowInstances({
        page: instancePage,
        pageSize: PAGE_SIZE,
        status: instanceStatus === ALL ? undefined : instanceStatus,
      });
      setInstances(result.items);
      setInstancePages(Math.max(1, result.meta.totalPages));
    } catch (error) {
      setInstancesError(errorText(error, "Failed to load workflow instances"));
    } finally {
      setInstancesLoading(false);
    }
  }, [instancePage, instanceStatus]);

  const loadVersions = useCallback(async (definition: WorkflowDefinition) => {
    setVersionDefinition(definition);
    setVersionsLoading(true);
    try {
      setVersions(await listWorkflowVersions(definition.id));
    } catch (error) {
      toast.error(errorText(error, "Failed to load versions"));
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDefinitions();
  }, [loadDefinitions]);
  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [loadDetail, selectedId]);
  useEffect(() => {
    if (mainTab === "assignments") void loadAssignments();
  }, [loadAssignments, mainTab]);
  useEffect(() => {
    if (mainTab === "history") void loadHistory();
  }, [loadHistory, mainTab]);
  useEffect(() => {
    if (mainTab === "instances") void loadInstances();
  }, [loadInstances, mainTab]);

  const refresh = useCallback(async () => {
    await loadDefinitions();
    if (selectedId) await loadDetail(selectedId, false);
    if (mainTab === "assignments") await loadAssignments();
    if (mainTab === "history") await loadHistory();
    if (mainTab === "instances") await loadInstances();
  }, [
    loadAssignments,
    loadDefinitions,
    loadDetail,
    loadHistory,
    loadInstances,
    mainTab,
    selectedId,
  ]);

  const run = async (key: string, task: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await task();
      toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(errorText(error, "Operation failed"));
    } finally {
      setBusy(null);
    }
  };

  const editable = detail?.status === "DRAFT";

  const openCreateDefinition = () => {
    setDefinitionForm({ ...EMPTY_DEFINITION });
    setDefinitionDialog({ mode: "create" });
  };

  const openEditDefinition = (definition: WorkflowDefinition) => {
    setDefinitionForm({
      name: definition.name,
      code: definition.code,
      description: definition.description ?? "",
      entityType: definition.entityType,
    });
    setDefinitionDialog({ mode: "edit", definition });
  };

  const saveDefinition = async () => {
    if (!definitionDialog || !definitionForm.name.trim() || !definitionForm.code.trim()) return;
    await run(
      "definition",
      async () => {
        if (definitionDialog.mode === "create") {
          const created = await createWorkflowDefinition({
            name: definitionForm.name,
            code: definitionForm.code,
            description: definitionForm.description || null,
            entityType: definitionForm.entityType,
          });
          setSelectedId(created.id);
        } else {
          await updateWorkflowDefinition(definitionDialog.definition.id, {
            name: definitionForm.name,
            code: definitionForm.code,
            description: definitionForm.description || null,
            entityType: definitionForm.entityType,
          });
        }
        setDefinitionDialog(null);
      },
      definitionDialog.mode === "create"
        ? "Workflow definition created"
        : "Workflow definition updated",
    );
  };

  const openCreateStep = () => {
    setStepForm({
      ...EMPTY_STEP,
      sortOrder: String(detail?.steps.filter((step) => step.deletedAt === null).length ?? 0),
    });
    setStepDialog({ mode: "create" });
  };

  const openEditStep = (step: WorkflowStep) => {
    setStepForm({
      code: step.code,
      name: step.name,
      description: step.description ?? "",
      type: step.type,
      roleName: step.roleName ?? "",
      permissionCode: step.permissionCode ?? "",
      sortOrder: String(step.sortOrder),
    });
    setStepDialog({ mode: "edit", step });
  };

  const saveStep = async () => {
    if (!stepDialog || !detail || !stepForm.code.trim() || !stepForm.name.trim()) return;
    const input = {
      code: stepForm.code,
      name: stepForm.name,
      description: stepForm.description || null,
      type: stepForm.type,
      roleName: stepForm.roleName || null,
      permissionCode: stepForm.permissionCode || null,
      sortOrder: Number(stepForm.sortOrder) || 0,
    };
    await run(
      "step",
      async () => {
        if (stepDialog.mode === "create") {
          await createWorkflowStep(detail.id, input);
        } else {
          await updateWorkflowStep(detail.id, stepDialog.step.id, input);
        }
        setStepDialog(null);
      },
      stepDialog.mode === "create" ? "Step created" : "Step updated",
    );
  };

  const openCreateTransition = () => {
    const activeSteps = detail?.steps.filter((step) => step.deletedAt === null) ?? [];
    setTransitionForm({
      fromStepId: activeSteps[0]?.id ?? "",
      toStepId: activeSteps[activeSteps.length - 1]?.id ?? "",
      actionCode: "",
      requiredPermission: "",
      sortOrder: String(detail?.transitions.filter((transition) => transition.deletedAt === null).length ?? 0),
    });
    setTransitionDialog({ mode: "create" });
  };

  const openEditTransition = (transition: WorkflowTransition) => {
    setTransitionForm({
      fromStepId: transition.fromStepId,
      toStepId: transition.toStepId,
      actionCode: transition.actionCode,
      requiredPermission: transition.requiredPermission ?? "",
      sortOrder: String(transition.sortOrder),
    });
    setTransitionDialog({ mode: "edit", transition });
  };

  const saveTransition = async () => {
    if (!transitionDialog || !detail || !transitionForm.actionCode.trim()) return;
    const input = {
      fromStepId: transitionForm.fromStepId,
      toStepId: transitionForm.toStepId,
      actionCode: transitionForm.actionCode,
      requiredPermission: transitionForm.requiredPermission || null,
      sortOrder: Number(transitionForm.sortOrder) || 0,
    };
    await run(
      "transition",
      async () => {
        if (transitionDialog.mode === "create") {
          await createWorkflowTransition(detail.id, input);
        } else {
          await updateWorkflowTransition(detail.id, transitionDialog.transition.id, {
            toStepId: input.toStepId,
            actionCode: input.actionCode,
            requiredPermission: input.requiredPermission,
            sortOrder: input.sortOrder,
          });
        }
        setTransitionDialog(null);
      },
      transitionDialog.mode === "create" ? "Transition created" : "Transition updated",
    );
  };

  const runValidation = async () => {
    if (!detail) return;
    setBusy("validate");
    try {
      setValidationResult(await validateWorkflowDefinition(detail.id));
      toast.success("Validation completed");
      await refresh();
    } catch (error) {
      toast.error(errorText(error, "Validation failed"));
    } finally {
      setBusy(null);
    }
  };

  const runPublish = async () => {
    if (!detail) return;
    await run(
      "publish",
      async () => {
        await publishWorkflowDefinition(detail.id, publishNote.trim() || undefined);
        setPublishOpen(false);
        setPublishNote("");
      },
      "Workflow published",
    );
  };

  const openAssign = () => {
    if (!detail) {
      toast.error("Select a workflow definition first");
      return;
    }
    setAssignmentType("UNIVERSITY");
    setAssignmentTarget(NO_TARGET);
    setAssignmentPriority("0");
    setTargetOptions([]);
    setAssignmentOpen(true);
  };

  const loadTargets = async (type: WorkflowAssignmentTargetType) => {
    if (type === "UNIVERSITY") {
      setTargetOptions([]);
      setAssignmentTarget(NO_TARGET);
      return;
    }
    setTargetsLoading(true);
    try {
      const options = await listWorkflowTargetOptions(type);
      setTargetOptions(options);
      setAssignmentTarget(options[0]?.id ?? NO_TARGET);
    } catch (error) {
      toast.error(errorText(error, "Failed to load assignment targets"));
      setTargetOptions([]);
    } finally {
      setTargetsLoading(false);
    }
  };

  const saveAssignment = async () => {
    if (!detail || !assignmentOpen) return;
    await run(
      "assign",
      async () => {
        await assignWorkflowDefinition(
          detail.id,
          assignmentType,
          assignmentType === "UNIVERSITY" ? null : assignmentTarget === NO_TARGET ? null : assignmentTarget,
          assignmentPriority.trim() ? Number(assignmentPriority.trim()) : undefined,
        );
        setAssignmentOpen(false);
      },
      "Workflow assigned",
    );
  };

  const openInstanceDetail = async (instance: WorkflowInstanceView) => {
    setInstanceDetail(instance);
    setInstanceDetailLoading(true);
    setPerformAction("");
    try {
      const next = await getWorkflowInstance(instance.id);
      setInstanceDetail(next);
    } catch (error) {
      toast.error(errorText(error, "Failed to load instance detail"));
    } finally {
      setInstanceDetailLoading(false);
    }
  };

  const performInstanceAction = async () => {
    if (!instanceDetail || !performAction) return;
    setBusy("perform");
    try {
      await apiPost<{ performed: boolean }>(
        `/workflows/instances/${instanceDetail.entityType}/${instanceDetail.entityId}/actions`,
        { actionCode: performAction },
      );
      toast.success("Workflow action performed");
      const next = await getWorkflowInstance(instanceDetail.id);
      setInstanceDetail(next);
      setPerformAction("");
      await loadInstances();
    } catch (error) {
      toast.error(errorText(error, "Failed to perform action"));
    } finally {
      setBusy(null);
    }
  };

  const overrideInstance = async (action: "COMPLETE" | "TERMINATE") => {
    if (!instanceDetail) return;
    setBusy(`override-${action}`);
    try {
      await apiPost<{ id: string }>(`/workflows/instances/${instanceDetail.id}/override`, { action });
      toast.success(action === "COMPLETE" ? "Instance completed" : "Instance terminated");
      const next = await getWorkflowInstance(instanceDetail.id);
      setInstanceDetail(next);
      await loadInstances();
    } catch (error) {
      toast.error(errorText(error, "Override failed"));
    } finally {
      setBusy(null);
    }
  };

  const stepById = (id: string): WorkflowStep | undefined =>
    detail?.steps.find((step) => step.id === id);

  const activeSteps = detail?.steps.filter((step) => step.deletedAt === null) ?? [];
  const activeTransitions =
    detail?.transitions.filter((transition) => transition.deletedAt === null) ?? [];

  return (
    <div className="content-padding">
      <PageHeader
        title="Workflow Builder"
        description="Author versioned, publishable approval flows and assign them to scopes. Published workflows control submissions, requests, and documents."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={Boolean(busy)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={openCreateDefinition}>
              <Plus className="mr-2 h-4 w-4" />
              New Workflow
            </Button>
          </div>
        }
      />

      <Tabs value={mainTab} onValueChange={(value) => setMainTab(value as MainTab)} className="mt-6">
        <TabsList className="grid w-full max-w-xl grid-cols-4 overflow-x-auto">
          <TabsTrigger value="builder">
            <Workflow className="mr-2 h-4 w-4" />
            Builder
          </TabsTrigger>
          <TabsTrigger value="assignments">
            <Users className="mr-2 h-4 w-4" />
            Assignments
          </TabsTrigger>
          <TabsTrigger value="instances">
            <Play className="mr-2 h-4 w-4" />
            Instances
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-2 h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="builder" className="mt-5">
          <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
            <Card className="h-fit overflow-hidden border-slate-200/80">
              <CardHeader className="space-y-4 border-b border-slate-100 bg-slate-50/60 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-[14px]">Workflow Library</CardTitle>
                  <Badge variant="secondary">{definitionTotal}</Badge>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setDefinitionPage(1);
                    }}
                    placeholder="Search workflows"
                    className="pl-9"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => {
                      setStatusFilter(value as typeof statusFilter);
                      setDefinitionPage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="PUBLISHED">Published</SelectItem>
                      <SelectItem value="ARCHIVED">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={entityFilter}
                    onValueChange={(value) => {
                      setEntityFilter(value as typeof entityFilter);
                      setDefinitionPage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All entities</SelectItem>
                      {ENTITY_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 text-[11px] text-slate-600">
                  <Switch
                    checked={includeArchived}
                    onCheckedChange={(value) => {
                      setIncludeArchived(value);
                      setDefinitionPage(1);
                    }}
                  />
                  Archived
                </label>
              </CardHeader>
              <CardContent className="p-0">
                {definitionsLoading ? (
                  <div className="space-y-2 p-3">
                    {Array.from({ length: 4 }, (_, index) => (
                      <Skeleton key={index} variant="rectangular" className="h-20" />
                    ))}
                  </div>
                ) : definitionsError ? (
                  <InlineError message={definitionsError} retry={() => void loadDefinitions()} />
                ) : definitions.length === 0 ? (
                  <EmptyState
                    variant="documents"
                    title="No workflows"
                    description="Create a workflow to replace hardcoded approval flows."
                    action={{ label: "New Workflow", onClick: openCreateDefinition }}
                  />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {definitions.map((definition) => (
                      <button
                        key={definition.id}
                        type="button"
                        onClick={() => setSelectedId(definition.id)}
                        className={`w-full px-4 py-3 text-left transition-colors ${selectedId === definition.id ? "bg-primary-50/80 ring-1 ring-inset ring-primary-100" : "hover:bg-slate-50"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-medium text-slate-800">
                              {definition.name}
                            </p>
                            <p className="mt-0.5 truncate text-[11.5px] text-slate-500">
                              {definition.code}
                            </p>
                          </div>
                          {statusBadge(definition.status)}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          <span>{entityTypeLabel(definition.entityType)}</span>
                          <span>v{definition.version}</span>
                          <span>{definition.stepCount} steps</span>
                          <span>{definition.transitionCount} transitions</span>
                          <span>{definition.assignmentCount} assignments</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {!definitionsLoading && !definitionsError && definitionPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={definitionPage <= 1}
                      onClick={() => setDefinitionPage((page) => Math.max(1, page - 1))}
                    >
                      Previous
                    </Button>
                    <span className="text-[11.5px] text-slate-500">
                      {definitionPage} / {definitionPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={definitionPage >= definitionPages}
                      onClick={() => setDefinitionPage((page) => Math.min(definitionPages, page + 1))}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="min-w-0 space-y-5">
              {detailLoading ? (
                <Card>
                  <CardContent className="space-y-3 p-5">
                    <Skeleton variant="rectangular" className="h-8 w-1/2" />
                    <Skeleton variant="rectangular" className="h-4 w-full" />
                    <Skeleton variant="rectangular" className="h-24 w-full" />
                  </CardContent>
                </Card>
              ) : detailError ? (
                <Card>
                  <CardContent className="p-0">
                    <InlineError message={detailError} retry={() => selectedId && void loadDetail(selectedId)} />
                  </CardContent>
                </Card>
              ) : detail ? (
                <>
                  <Card className="border-slate-200/80">
                    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 border-b border-slate-100 bg-slate-50/60">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-[16px]">{detail.name}</CardTitle>
                          {statusBadge(detail.status)}
                        </div>
                        <p className="mt-1 text-[12.5px] text-slate-500">
                          {detail.code} · {entityTypeLabel(detail.entityType)} · v{detail.version}
                        </p>
                        {detail.description && (
                          <p className="mt-1.5 text-[12.5px] text-slate-600">{detail.description}</p>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                        {detail.status === "DRAFT" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={runValidation}
                              disabled={Boolean(busy)}
                            >
                              <ListChecks className="mr-2 h-4 w-4" />
                              Validate
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setPublishNote("");
                                setPublishOpen(true);
                              }}
                              disabled={Boolean(busy)}
                            >
                              <Play className="mr-2 h-4 w-4" />
                              Publish
                            </Button>
                          </>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" disabled={Boolean(busy)}>
                              More
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDefinition(detail)}>
                              <FileCog className="mr-2 h-4 w-4" />
                              Edit details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void loadVersions(detail)}
                              disabled={detail.status !== "DRAFT"}
                            >
                              <History className="mr-2 h-4 w-4" />
                              Versions &amp; rollback
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {detail.status === "ARCHIVED" ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  void run(
                                    "restore",
                                    () => restoreWorkflowDefinition(detail.id),
                                    "Workflow restored",
                                  )
                                }
                              >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Restore
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() =>
                                  void run(
                                    "archive",
                                    () => archiveWorkflowDefinition(detail.id),
                                    "Workflow archived",
                                  )
                                }
                              >
                                <Archive className="mr-2 h-4 w-4" />
                                Archive
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent className="p-5">
                      {!editable && (
                        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800">
                          <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>
                            Published workflows are immutable. Roll back to an earlier version to
                            reopen this definition for editing, or create a new draft.
                          </span>
                        </div>
                      )}

                      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-center">
                          <p className="text-xl font-semibold text-slate-800">{detail.stepCount}</p>
                          <p className="text-[11px] text-slate-500">Steps</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-center">
                          <p className="text-xl font-semibold text-slate-800">
                            {detail.transitionCount}
                          </p>
                          <p className="text-[11px] text-slate-500">Transitions</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-center">
                          <p className="text-xl font-semibold text-slate-800">
                            {detail.assignmentCount}
                          </p>
                          <p className="text-[11px] text-slate-500">Assignments</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-center">
                          <p className="text-xl font-semibold text-slate-800">
                            {detail.instanceCount}
                          </p>
                          <p className="text-[11px] text-slate-500">Instances</p>
                        </div>
                      </div>

                      <div className="mb-5 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[12px] text-slate-600">
                        <span className="font-semibold text-slate-700">Runtime action adapter: </span>
                        {WORKFLOW_ENTITY_ACTIONS[detail.entityType]}
                        <span className="text-slate-400">
                          {" "}— transition action codes should use these verbs so live entities can
                          advance the flow.
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <h3 className="text-[13.5px] font-semibold text-slate-800">Steps</h3>
                        {editable && (
                          <Button variant="outline" size="sm" onClick={openCreateStep}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Step
                          </Button>
                        )}
                      </div>
                      <Table className="mt-3">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-9" />
                            <TableHead>Code</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Role / Permission</TableHead>
                            <TableHead className="w-24">Status</TableHead>
                            <TableHead className="w-20 text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeSteps.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="py-8 text-center text-[12.5px] text-slate-500">
                                No steps yet. Add a START step, then TASK/REVIEW/APPROVAL steps and an
                                END step.
                              </TableCell>
                            </TableRow>
                          ) : (
                            [...activeSteps]
                              .sort((a, b) => a.sortOrder - b.sortOrder)
                              .map((step) => (
                                <TableRow key={step.id}>
                                  <TableCell>
                                    <GripVertical className="h-4 w-4 text-slate-300" />
                                  </TableCell>
                                  <TableCell className="font-mono text-[12px]">{step.code}</TableCell>
                                  <TableCell className="text-[13px] text-slate-700">
                                    {step.name}
                                    {step.description && (
                                      <span className="block text-[11px] text-slate-400">
                                        {step.description}
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="text-[11px]">
                                      {stepTypeLabel(step.type)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-[11.5px] text-slate-500">
                                    {step.roleName && <span>Role: {step.roleName}</span>}
                                    {step.permissionCode && (
                                      <span className="block font-mono">{step.permissionCode}</span>
                                    )}
                                    {!step.roleName && !step.permissionCode && (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="secondary" className="text-[11px]">
                                      {step.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" disabled={Boolean(busy)}>
                                          <MoreVertical />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => openEditStep(step)} disabled={!editable}>
                                          <FileCog className="mr-2 h-4 w-4" />
                                          Edit
                                        </DropdownMenuItem>
                                        {step.status === "ACTIVE" ? (
                                          <DropdownMenuItem
                                            disabled={!editable}
                                            onClick={() =>
                                              void run(
                                                "step",
                                                () => archiveWorkflowStep(detail.id, step.id),
                                                "Step archived",
                                              )
                                            }
                                          >
                                            <Archive className="mr-2 h-4 w-4" />
                                            Archive
                                          </DropdownMenuItem>
                                        ) : (
                                          <DropdownMenuItem
                                            onClick={() =>
                                              void run(
                                                "step",
                                                () => restoreWorkflowStep(detail.id, step.id),
                                                "Step restored",
                                              )
                                            }
                                          >
                                            <RotateCcw className="mr-2 h-4 w-4" />
                                            Restore
                                          </DropdownMenuItem>
                                        )}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </TableRow>
                              ))
                          )}
                        </TableBody>
                      </Table>

                      <div className="mt-6 flex items-center justify-between">
                        <h3 className="text-[13.5px] font-semibold text-slate-800">Transitions</h3>
                        {editable && (
                          <Button variant="outline" size="sm" onClick={openCreateTransition} disabled={activeSteps.length < 2}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Transition
                          </Button>
                        )}
                      </div>
                      <Table className="mt-3">
                        <TableHeader>
                          <TableRow>
                            <TableHead>From</TableHead>
                            <TableHead />
                            <TableHead>To</TableHead>
                            <TableHead>Action Code</TableHead>
                            <TableHead>Required Permission</TableHead>
                            <TableHead className="w-20 text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeTransitions.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="py-8 text-center text-[12.5px] text-slate-500">
                                No transitions yet. Connect steps with actions like APPROVE, REJECT,
                                REQUEST_REVISION, FULFILL, or CANCEL.
                              </TableCell>
                            </TableRow>
                          ) : (
                            [...activeTransitions]
                              .sort((a, b) => a.sortOrder - b.sortOrder)
                              .map((transition) => {
                                const from = stepById(transition.fromStepId);
                                const to = stepById(transition.toStepId);
                                return (
                                  <TableRow key={transition.id}>
                                    <TableCell className="text-[12.5px] text-slate-700">
                                      {from ? `${from.code} · ${from.name}` : "—"}
                                    </TableCell>
                                    <TableCell>
                                      <ArrowRight className="h-4 w-4 text-slate-400" />
                                    </TableCell>
                                    <TableCell className="text-[12.5px] text-slate-700">
                                      {to ? `${to.code} · ${to.name}` : "—"}
                                    </TableCell>
                                    <TableCell className="font-mono text-[12px] text-indigo-700">
                                      {transition.actionCode}
                                    </TableCell>
                                    <TableCell className="font-mono text-[11.5px] text-slate-500">
                                      {transition.requiredPermission ?? "—"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="sm" disabled={Boolean(busy)}>
                                            <MoreVertical />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem
                                            onClick={() => openEditTransition(transition)}
                                            disabled={!editable}
                                          >
                                            <FileCog className="mr-2 h-4 w-4" />
                                            Edit
                                          </DropdownMenuItem>
                                          {transition.deletedAt === null ? (
                                            <DropdownMenuItem
                                              disabled={!editable}
                                              onClick={() =>
                                                void run(
                                                  "transition",
                                                  () => archiveWorkflowTransition(detail.id, transition.id),
                                                  "Transition archived",
                                                )
                                              }
                                            >
                                              <Archive className="mr-2 h-4 w-4" />
                                              Archive
                                            </DropdownMenuItem>
                                          ) : (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                void run(
                                                  "transition",
                                                  () => restoreWorkflowTransition(detail.id, transition.id),
                                                  "Transition restored",
                                                )
                                              }
                                            >
                                              <RotateCcw className="mr-2 h-4 w-4" />
                                              Restore
                                            </DropdownMenuItem>
                                          )}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <EmptyState
                      variant="documents"
                      title="Select a workflow"
                      description="Choose a workflow from the library to view and edit its steps, transitions, and assignments."
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="assignments" className="mt-5">
          <Card className="border-slate-200/80">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-100 bg-slate-50/60">
              <CardTitle className="text-[14px]">Scope Assignments</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={openAssign} disabled={Boolean(busy)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Assign Workflow
                </Button>
                <Button variant="outline" size="sm" onClick={() => void loadAssignments()} disabled={Boolean(busy)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {assignmentsLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} variant="rectangular" className="h-14" />
                  ))}
                </div>
              ) : assignmentsError ? (
                <InlineError message={assignmentsError} retry={() => void loadAssignments()} />
              ) : assignments.length === 0 ? (
                <EmptyState
                  variant="documents"
                  title="No assignments"
                  description="Assign a workflow to a scope to control real entities. More specific scopes win at runtime."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {assignments.map((assignment) => (
                    <div key={assignment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium text-slate-800">
                          {assignment.definitionName}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-slate-500">
                          {targetLabel(assignment.targetType)} · {assignment.targetName}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <Badge variant="secondary">priority {assignment.priority}</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void run(
                              "unassign",
                              () => unassignWorkflow(assignment.id),
                              "Assignment removed",
                            )
                          }
                          disabled={Boolean(busy)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="instances" className="mt-5">
          <Card className="border-slate-200/80">
            <CardHeader className="space-y-3 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[14px]">Live Workflow Instances</CardTitle>
                <Select
                  value={instanceStatus}
                  onValueChange={(value) => {
                    setInstanceStatus(value as typeof instanceStatus);
                    setInstancePage(1);
                  }}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All statuses</SelectItem>
                    <SelectItem value="RUNNING">Running</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="TERMINATED">Terminated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {instancesLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} variant="rectangular" className="h-14" />
                  ))}
                </div>
              ) : instancesError ? (
                <InlineError message={instancesError} retry={() => void loadInstances()} />
              ) : instances.length === 0 ? (
                <EmptyState
                  variant="documents"
                  title="No instances"
                  description="Live instances appear here once published workflows are assigned and entities are created."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {instances.map((instance) => (
                    <button
                      key={instance.id}
                      type="button"
                      onClick={() => void openInstanceDetail(instance)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-medium text-slate-800">
                            {instance.definitionName}
                          </p>
                          <p className="mt-0.5 text-[11.5px] text-slate-500">
                            {entityTypeLabel(instance.entityType)} · {instance.entityId} · v
                            {instance.version}
                          </p>
                        </div>
                        {instanceStatusBadge(instance.status)}
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-slate-500">
                        Current step:{" "}
                        <span className="font-medium text-slate-700">
                          {instance.currentStepName ?? "—"}
                        </span>
                        <span className="text-slate-400"> · started {formatDate(instance.startedAt)}</span>
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {!instancesLoading && !instancesError && instancePages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={instancePage <= 1}
                    onClick={() => setInstancePage((page) => Math.max(1, page - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-[11.5px] text-slate-500">
                    {instancePage} / {instancePages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={instancePage >= instancePages}
                    onClick={() => setInstancePage((page) => Math.min(instancePages, page + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-5">
          <Card className="border-slate-200/80">
            <CardHeader className="space-y-3 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[14px]">Change History</CardTitle>
                <Select
                  value={historyAction}
                  onValueChange={(value) => {
                    setHistoryAction(value as typeof historyAction);
                    setHistoryPage(1);
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All actions</SelectItem>
                    {HISTORY_ACTIONS.map((action) => (
                      <SelectItem key={action} value={action}>
                        {action}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {historyLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 5 }, (_, index) => (
                    <Skeleton key={index} variant="rectangular" className="h-10" />
                  ))}
                </div>
              ) : historyError ? (
                <InlineError message={historyError} retry={() => void loadHistory()} />
              ) : historyRows.length === 0 ? (
                <EmptyState variant="documents" title="No history" description="Workflow changes will appear here." />
              ) : (
                <div className="divide-y divide-slate-100">
                  {historyRows.map((entry) => (
                    <div key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-slate-800">{entry.action}</p>
                        <p className="mt-0.5 text-[11.5px] text-slate-500">
                          {entry.actorName ?? "System"}
                          <span className="text-slate-400"> · {formatDate(entry.createdAt)}</span>
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2 text-[11.5px] text-slate-500">
                        {entry.versionFrom !== null && entry.versionTo !== null && (
                          <Badge variant="secondary">
                            v{entry.versionFrom} → v{entry.versionTo}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!historyLoading && !historyError && historyPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-[11.5px] text-slate-500">
                    {historyPage} / {historyPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={historyPage >= historyPages}
                    onClick={() => setHistoryPage((page) => Math.min(historyPages, page + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create / edit definition */}
      <Dialog open={definitionDialog !== null} onOpenChange={(open) => !open && setDefinitionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {definitionDialog?.mode === "create" ? "New Workflow Definition" : "Edit Workflow Definition"}
            </DialogTitle>
            <DialogDescription>
              Define the metadata of a versioned workflow. Steps and transitions are added next.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                value={definitionForm.name}
                onChange={(event) => setDefinitionForm((form) => ({ ...form, name: event.target.value }))}
                placeholder="Document Request Approval"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wf-code">Code</Label>
              <Input
                id="wf-code"
                value={definitionForm.code}
                onChange={(event) => setDefinitionForm((form) => ({ ...form, code: event.target.value }))}
                placeholder="document_request.approval"
              />
            </div>
            <div className="grid gap-2">
              <Label>Entity Type</Label>
              <Select
                value={definitionForm.entityType}
                onValueChange={(value) =>
                  setDefinitionForm((form) => ({ ...form, entityType: value as WorkflowEntityType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wf-description">Description</Label>
              <Textarea
                id="wf-description"
                value={definitionForm.description}
                onChange={(event) => setDefinitionForm((form) => ({ ...form, description: event.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefinitionDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveDefinition()} disabled={Boolean(busy)}>
              {definitionDialog?.mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / edit step */}
      <Dialog open={stepDialog !== null} onOpenChange={(open) => !open && setStepDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{stepDialog?.mode === "create" ? "Add Step" : "Edit Step"}</DialogTitle>
            <DialogDescription>
              Steps execute in sort order. START and END are markers; TASK, REVIEW, and APPROVAL can
              gate on a role or permission.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="step-code">Code</Label>
                <Input
                  id="step-code"
                  value={stepForm.code}
                  onChange={(event) => setStepForm((form) => ({ ...form, code: event.target.value }))}
                  placeholder="start"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="step-name">Name</Label>
                <Input
                  id="step-name"
                  value={stepForm.name}
                  onChange={(event) => setStepForm((form) => ({ ...form, name: event.target.value }))}
                  placeholder="Submitted"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select
                  value={stepForm.type}
                  onValueChange={(value) => setStepForm((form) => ({ ...form, type: value as WorkflowStepType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STEP_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="step-sort">Sort Order</Label>
                <Input
                  id="step-sort"
                  type="number"
                  value={stepForm.sortOrder}
                  onChange={(event) => setStepForm((form) => ({ ...form, sortOrder: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="step-role">Role (optional)</Label>
                <Input
                  id="step-role"
                  value={stepForm.roleName}
                  onChange={(event) => setStepForm((form) => ({ ...form, roleName: event.target.value }))}
                  placeholder="QUALITY_ASSURANCE_OFFICER"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="step-perm">Permission (optional)</Label>
                <Input
                  id="step-perm"
                  value={stepForm.permissionCode}
                  onChange={(event) => setStepForm((form) => ({ ...form, permissionCode: event.target.value }))}
                  placeholder="aaccup.submission.review"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="step-description">Description</Label>
              <Textarea
                id="step-description"
                value={stepForm.description}
                onChange={(event) => setStepForm((form) => ({ ...form, description: event.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStepDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveStep()} disabled={Boolean(busy)}>
              {stepDialog?.mode === "create" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / edit transition */}
      <Dialog open={transitionDialog !== null} onOpenChange={(open) => !open && setTransitionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {transitionDialog?.mode === "create" ? "Add Transition" : "Edit Transition"}
            </DialogTitle>
            <DialogDescription>
              A transition lets the current step advance to another step when the action is
              performed. Only one transition per action code per step is allowed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>From Step</Label>
                <Select
                  value={transitionForm.fromStepId}
                  onValueChange={(value) => setTransitionForm((form) => ({ ...form, fromStepId: value }))}
                  disabled={transitionDialog?.mode === "edit"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSteps.map((step) => (
                      <SelectItem key={step.id} value={step.id}>
                        {step.code} · {step.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>To Step</Label>
                <Select
                  value={transitionForm.toStepId}
                  onValueChange={(value) => setTransitionForm((form) => ({ ...form, toStepId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSteps.map((step) => (
                      <SelectItem key={step.id} value={step.id}>
                        {step.code} · {step.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="tr-action">Action Code</Label>
                <Input
                  id="tr-action"
                  value={transitionForm.actionCode}
                  onChange={(event) => setTransitionForm((form) => ({ ...form, actionCode: event.target.value }))}
                  placeholder="APPROVE"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tr-perm">Required Permission</Label>
                <Input
                  id="tr-perm"
                  value={transitionForm.requiredPermission}
                  onChange={(event) =>
                    setTransitionForm((form) => ({ ...form, requiredPermission: event.target.value }))
                  }
                  placeholder="workflow.review"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tr-sort">Sort Order</Label>
              <Input
                id="tr-sort"
                type="number"
                value={transitionForm.sortOrder}
                onChange={(event) => setTransitionForm((form) => ({ ...form, sortOrder: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransitionDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveTransition()} disabled={Boolean(busy)}>
              {transitionDialog?.mode === "create" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Validation results */}
      <Dialog open={validationResult !== null} onOpenChange={(open) => !open && setValidationResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Validation Results</DialogTitle>
            <DialogDescription>
              {validationResult?.checksRun} checks run ·{" "}
              {validationResult?.valid ? "all checks passed" : "fix the errors before publishing"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {validationResult?.issues.length === 0 && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-800">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                The workflow definition is valid and can be published.
              </div>
            )}
            {validationResult?.issues.map((issue: WorkflowValidationIssue, index) => (
              <div
                key={`${issue.code}-${index}`}
                className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-[12.5px] ${
                  issue.severity === "ERROR"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <p className="font-medium">{issue.code}</p>
                  <p>{issue.message}</p>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setValidationResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish confirm */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Workflow</DialogTitle>
            <DialogDescription>
              Publishing snapshots the current steps, transitions, and assignments into an
              immutable version. New entities will bind to this version immediately; the draft
              becomes read-only.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="publish-note">Change note (optional)</Label>
            <Textarea
              id="publish-note"
              value={publishNote}
              onChange={(event) => setPublishNote(event.target.value)}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void runPublish()} disabled={Boolean(busy)}>
              <Play className="mr-2 h-4 w-4" />
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Versions + rollback */}
      <Dialog
        open={versionDefinition !== null}
        onOpenChange={(open) => !open && setVersionDefinition(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Versions</DialogTitle>
            <DialogDescription>
              Published versions are immutable snapshots. Rollback restores the exact steps,
              transitions, and assignments of an earlier version and reopens the definition as a
              draft.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {versionsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} variant="rectangular" className="h-12" />
                ))}
              </div>
            ) : versions.length === 0 ? (
              <p className="py-8 text-center text-[12.5px] text-slate-500">No versions yet.</p>
            ) : (
              versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-800">
                      v{version.version} · {version.changeType}
                    </p>
                    <p className="truncate text-[11.5px] text-slate-500">
                      {version.changedByName ?? "System"} · {formatDate(version.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={version.version >= (versionDefinition?.version ?? 0)}
                    onClick={() => {
                      setRollbackTarget(version);
                      setRollbackNote("");
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Rollback
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionDefinition(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback confirm */}
      <Dialog open={rollbackTarget !== null} onOpenChange={(open) => !open && setRollbackTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rollback to v{rollbackTarget?.version}</DialogTitle>
            <DialogDescription>
              This restores the steps, transitions, and assignments from that version, sets the
              definition to DRAFT, and demotes the current version. Existing live instances are
              unaffected.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="rollback-note">Change note (optional)</Label>
            <Textarea
              id="rollback-note"
              value={rollbackNote}
              onChange={(event) => setRollbackNote(event.target.value)}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!rollbackTarget || !detail) return;
                void run(
                  "rollback",
                  async () => {
                    await rollbackWorkflowDefinition(detail.id, rollbackTarget.version, rollbackNote.trim() || undefined);
                    setRollbackTarget(null);
                    setVersionDefinition(null);
                  },
                  "Workflow rolled back",
                );
              }}
              disabled={Boolean(busy)}
            >
              Rollback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign workflow */}
      <Dialog open={assignmentOpen} onOpenChange={setAssignmentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Workflow</DialogTitle>
            <DialogDescription>
              Assign {detail?.name ?? "this workflow"} to a scope. At runtime the most specific
              matching assignment wins; ties break by priority, then creation time.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Target Type</Label>
              <Select
                value={assignmentType}
                onValueChange={(value) => {
                  const next = value as WorkflowAssignmentTargetType;
                  setAssignmentType(next);
                  void loadTargets(next);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {assignmentType !== "UNIVERSITY" && (
              <div className="grid gap-2">
                <Label>Target</Label>
                <Select value={assignmentTarget} onValueChange={setAssignmentTarget}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {targetsLoading ? (
                      <SelectItem value={NO_TARGET} disabled>
                        Loading targets…
                      </SelectItem>
                    ) : targetOptions.length === 0 ? (
                      <SelectItem value={NO_TARGET} disabled>
                        No targets available
                      </SelectItem>
                    ) : (
                      targetOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="assign-priority">Priority</Label>
              <Input
                id="assign-priority"
                type="number"
                value={assignmentPriority}
                onChange={(event) => setAssignmentPriority(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignmentOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveAssignment()} disabled={Boolean(busy)}>
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Instance detail */}
      <Dialog open={instanceDetail !== null} onOpenChange={(open) => !open && setInstanceDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Workflow Instance</DialogTitle>
            <DialogDescription>
              {instanceDetail?.definitionName} · {entityTypeLabel(instanceDetail?.entityType ?? "DOCUMENT")} ·{" "}
              {instanceDetail?.entityId}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 space-y-4 overflow-y-auto">
            {instanceDetailLoading ? (
              <Skeleton variant="rectangular" className="h-40 w-full" />
            ) : instanceDetail ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {instanceStatusBadge(instanceDetail.status)}
                  <Badge variant="secondary">v{instanceDetail.version}</Badge>
                  <span className="text-[12px] text-slate-500">
                    Started {formatDate(instanceDetail.startedAt)}
                  </span>
                  {instanceDetail.completedAt && (
                    <span className="text-[12px] text-slate-500">
                      · Completed {formatDate(instanceDetail.completedAt)}
                    </span>
                  )}
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Current Step
                  </p>
                  <p className="mt-1 text-[13.5px] font-medium text-slate-800">
                    {instanceDetail.currentStepName ?? "—"}
                    <span className="ml-2 font-mono text-[11.5px] text-slate-500">
                      {instanceDetail.currentStepCode ?? ""}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-[12px] font-semibold text-slate-700">
                    Steps ({instanceDetail.stepInstances.length})
                  </p>
                  <div className="space-y-1.5">
                    {instanceDetail.stepInstances.map((stepInstance) => (
                      <div
                        key={stepInstance.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-slate-700">
                            {stepInstance.stepName}
                            <span className="ml-2 font-mono text-[11px] text-slate-400">
                              {stepInstance.stepCode}
                            </span>
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {stepInstance.actorName ?? "System"} · {stepInstance.note ?? ""}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[11px]">
                          {stepInstance.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[12px] font-semibold text-slate-700">
                    Actions ({instanceDetail.actions.length})
                  </p>
                  <div className="space-y-1.5">
                    {instanceDetail.actions.map((action) => (
                      <div
                        key={action.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-[12px] text-indigo-700">{action.actionCode}</p>
                          <p className="truncate text-[11px] text-slate-500">
                            → {action.stepCode} · {action.actorName ?? "System"} ·{" "}
                            {formatDate(action.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {instanceDetail.status === "RUNNING" && (
                  <>
                    {instanceDetail.allowedActions.length > 0 && (
                      <div className="flex items-end gap-2 rounded-md border border-slate-200 p-3">
                        <div className="min-w-0 flex-1">
                          <Label>Perform action</Label>
                          <Select value={performAction} onValueChange={setPerformAction}>
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder="Select an action" />
                            </SelectTrigger>
                            <SelectContent>
                              {instanceDetail.allowedActions.map((action) => (
                                <SelectItem key={action} value={action}>
                                  {action}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button onClick={() => void performInstanceAction()} disabled={!performAction || Boolean(busy)}>
                          <Play className="mr-2 h-4 w-4" />
                          Run
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={Boolean(busy)}
                        onClick={() => void overrideInstance("COMPLETE")}
                      >
                        <CircleDot className="mr-2 h-4 w-4" />
                        Complete
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={Boolean(busy)}
                        onClick={() => void overrideInstance("TERMINATE")}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Terminate
                      </Button>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstanceDetail(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
