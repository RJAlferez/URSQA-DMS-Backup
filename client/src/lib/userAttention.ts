import { listMyOnlineTasks } from "@/services/aaccup"
import { listAllOnlineSubmissions } from "@/services/aaccup"
import { listRequests } from "@/services/requests"
import type { OnlineAaccupTask, OnlineSubmissionListItem } from "@/services/aaccup"
import type { DocumentRequest } from "@/types/domain"

export interface UserAttention {
  returnedSubmissions: number
  dueSoonTasks: number
  overdueTasks: number
  openTasks: number
  pendingRequests: number
  approvedRequests: number
  fulfilledRequests: number
  refusedRequests: number
  allSubmissions: OnlineSubmissionListItem[]
  returnedSubmissionsList: OnlineSubmissionListItem[]
  overdueTasksList: OnlineAaccupTask[]
  dueSoonTasksList: OnlineAaccupTask[]
  recentRequestUpdates: DocumentRequest[]
  loading: boolean
}

let cached: UserAttention | null = null
let cachedUserId: string | null = null
let lastFetch = 0
const listeners = new Set<(a: UserAttention) => void>()
const FETCH_COOLDOWN_MS = 5000
const NOW = () => Date.now()
const within7Days = (dateStr: string | null) => {
  if (!dateStr) return false
  const d = new Date(dateStr).getTime()
  return d >= NOW() && d <= NOW() + 7 * 24 * 60 * 60 * 1000
}
const isOverdue = (dateStr: string | null, status: string) => {
  if (!dateStr || status === "COMPLETED" || status === "CANCELLED") return false
  return new Date(dateStr).getTime() < NOW()
}

export async function refreshUserAttention(userId: string, permissions?: string[]): Promise<void> {
  if (cachedUserId !== userId) {
    cached = null
    lastFetch = 0
    cachedUserId = userId
  }
  if (cached && NOW() - lastFetch < FETCH_COOLDOWN_MS) {
    listeners.forEach((l) => l(cached!))
    return
  }
  // Only call endpoints the user is authorized for. A READ_ONLY account has no
  // aaccup.* / request.create permissions; calling anyway produced a
  // PERMISSION_DENIED audit event per endpoint on every 30s poll.
  const can = (code: string) => !permissions || permissions.includes(code)
  try {
    const [tasks, submissions, requests] = await Promise.all([
      can("aaccup.read") ? listMyOnlineTasks() : Promise.resolve([]),
      can("aaccup.submission.read") ? listAllOnlineSubmissions() : Promise.resolve([]),
      can("request.create") || can("request.manage")
        ? listRequests({ submittedBy: userId })
        : Promise.resolve([]),
    ])
    const returnedSubs = submissions.filter((s) => s.status === "NEEDS_REVISION")
    const dueSoon = tasks.filter((t) => within7Days(t.dueDate) && t.status !== "COMPLETED" && t.status !== "CANCELLED")
    const overdue = tasks.filter((t) => isOverdue(t.dueDate, t.status))
    const openTaskList = tasks.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS")
    const pendingReqs = requests.filter((r) => r.status === "Pending")
    const approvedReqs = requests.filter((r) => r.status === "Approved")
    const fulfilledReqs = requests.filter((r) => r.status === "Fulfilled")
    const rejectedReqs = requests.filter((r) => r.status === "Rejected")
    const requestUpdates = requests
      .filter((r) => r.status !== "Pending")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5)

    // Preserve array identity when the poll returns identical data so effects
    // keyed on the arrays (e.g. the accreditation progress loader) do not
    // refetch the entire area/requirement tree every 30 seconds.
    const stable = <T,>(next: T[], prev: T[] | undefined, same: (a: T, b: T) => boolean): T[] => {
      if (prev && prev.length === next.length && prev.every((item, i) => same(item, next[i]!))) return prev
      return next
    }
    const sameSubmission = (a: OnlineSubmissionListItem, b: OnlineSubmissionListItem) =>
      a.id === b.id && a.status === b.status && a.submittedAt === b.submittedAt
    const sameTask = (a: OnlineAaccupTask, b: OnlineAaccupTask) =>
      a.id === b.id && a.status === b.status && a.dueDate === b.dueDate
    const sameRequest = (a: DocumentRequest, b: DocumentRequest) =>
      a.id === b.id && a.status === b.status && a.updatedAt === b.updatedAt

    cached = {
      returnedSubmissions: returnedSubs.length,
      dueSoonTasks: dueSoon.length,
      overdueTasks: overdue.length,
      openTasks: openTaskList.length,
      pendingRequests: pendingReqs.length,
      approvedRequests: approvedReqs.length,
      fulfilledRequests: fulfilledReqs.length,
      refusedRequests: rejectedReqs.length,
      allSubmissions: stable(submissions, cached?.allSubmissions, sameSubmission),
      returnedSubmissionsList: stable(returnedSubs, cached?.returnedSubmissionsList, sameSubmission),
      overdueTasksList: stable(overdue, cached?.overdueTasksList, sameTask),
      dueSoonTasksList: stable(dueSoon, cached?.dueSoonTasksList, sameTask),
      recentRequestUpdates: stable(requestUpdates, cached?.recentRequestUpdates, sameRequest),
      loading: false,
    }
    lastFetch = NOW()
    listeners.forEach((l) => l(cached!))
  } catch {
    cached = cached ?? {
      returnedSubmissions: 0,
      dueSoonTasks: 0,
      overdueTasks: 0,
      openTasks: 0,
      pendingRequests: 0,
      approvedRequests: 0,
      fulfilledRequests: 0,
      refusedRequests: 0,
      allSubmissions: [],
      returnedSubmissionsList: [],
      overdueTasksList: [],
      dueSoonTasksList: [],
      recentRequestUpdates: [],
      loading: false,
    }
    listeners.forEach((l) => l(cached!))
  }
}

export function getCachedAttention(): UserAttention {
  return cached ?? {
    returnedSubmissions: 0,
    dueSoonTasks: 0,
    overdueTasks: 0,
    openTasks: 0,
    pendingRequests: 0,
    approvedRequests: 0,
    fulfilledRequests: 0,
    refusedRequests: 0,
    allSubmissions: [],
    returnedSubmissionsList: [],
    overdueTasksList: [],
    dueSoonTasksList: [],
    recentRequestUpdates: [],
    loading: true,
  }
}

export function subscribeUserAttention(
  fn: (a: UserAttention) => void,
  userId?: string,
): () => void {
  listeners.add(fn)
  // Never replay another user's cached counts after an account switch.
  if (cached && (!userId || cachedUserId === userId)) fn(cached)
  return () => { listeners.delete(fn) }
}
