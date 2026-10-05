import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { AlertCircle, Loader2 } from "lucide-react"
import { AuthLayout } from "@/components/auth"
import { AuthCard, AuthCardDescription, AuthCardHeader, AuthCardTitle } from "@/components/auth/AuthCard"
import { PasswordInput } from "@/components/auth/PasswordInput"
import { PasswordStrength } from "@/components/auth/PasswordStrength"
import { passwordMeetsRequirements } from "@/components/auth/passwordRules"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Label } from "@/components/ui/Label"
import { apiGet, apiPost } from "@/lib/http"

interface RegistrationOptions {
  campuses: Array<{ id: string; name: string; code: string }>
  colleges: Array<{ id: string; name: string; code: string; campusId: string | null }>
  programs: Array<{ id: string; name: string; code: string; campusId: string | null; collegeId: string }>
  offices: Array<{ id: string; name: string; code: string; campusId: string | null; collegeId: string | null; departmentId: string | null }>
}

const selectClass = "h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm transition-colors focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"

export default function RegisterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const [email, setEmail] = useState("")
  const [options, setOptions] = useState<RegistrationOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [requestSent, setRequestSent] = useState(false)
  const [requestEmail, setRequestEmail] = useState("")
  const [form, setForm] = useState({ firstName: "", middleName: "", lastName: "", suffix: "", employeeId: "", campusId: "", collegeId: "", programId: "", officeId: "", password: "", confirmPassword: "" })

  useEffect(() => {
    document.title = "Register | URS-DMS"
    if (!token) {
      setLoading(false)
      return
    }
    Promise.all([
      apiPost<{ email: string }>("/auth/registration/validate", { token }),
      apiGet<RegistrationOptions>("/auth/registration-options"),
    ]).then(([invite, registrationOptions]) => {
      setEmail(invite.email)
      setOptions(registrationOptions)
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "This registration link is invalid or expired.")
    }).finally(() => setLoading(false))
  }, [token])

  const colleges = useMemo(
    () => options?.colleges.filter((college) => college.campusId === form.campusId) ?? [],
    [form.campusId, options],
  )

  // Programs can live under a college OR directly on a campus (collegeId null).
  // When a college is chosen, list its programs; otherwise list every program
  // that belongs to the selected campus (campus-level AND college-bound ones)
  // so a program is never hidden just because no college was picked yet.
  const programs = useMemo(() => {
    const all = options?.programs ?? []
    if (form.collegeId) return all.filter((program) => program.collegeId === form.collegeId)
    const campusCollegeIds = new Set(
      (options?.colleges ?? [])
        .filter((college) => college.campusId === form.campusId)
        .map((college) => college.id),
    )
    return all.filter((program) =>
      program.collegeId === null
        ? program.campusId === form.campusId || program.campusId === null
        : campusCollegeIds.has(program.collegeId),
    )
  }, [form.collegeId, form.campusId, options])

  const handleProgramChange = (programId: string) => {
    const picked = options?.programs.find((program) => program.id === programId)
    setForm((current) => ({
      ...current,
      programId,
      officeId: "",
      // Auto-fill the program's college so a college-bound program (e.g. BS
      // Computer Science under College of Science) registers cleanly even when
      // the user picked it without choosing a college first.
      ...(picked?.collegeId ? { collegeId: picked.collegeId } : {}),
    }))
  }

  // Offices belong to a campus (directly or through a college). When a college
  // is chosen, keep campus-wide offices + offices of that college; otherwise
  // list every office on the selected campus.
  const offices = useMemo(
    () => (options?.offices ?? []).filter((office) => {
      if (office.campusId !== form.campusId) return false
      if (!form.collegeId) return true
      return office.collegeId === null || office.collegeId === form.collegeId
    }),
    [form.campusId, form.collegeId, options],
  )

  const formIsComplete = Boolean(
    email.trim()
      && form.firstName.trim()
      && form.lastName.trim()
      && form.employeeId.trim()
      && form.campusId
       && passwordMeetsRequirements(form.password)
      && form.confirmPassword
      && form.password === form.confirmPassword,
  )

  const passwordValid = passwordMeetsRequirements(form.password)

  const update = (field: keyof typeof form, value: string) =>
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "campusId" ? { collegeId: "", programId: "", officeId: "" } : {}),
      ...(field === "collegeId" ? { programId: "", officeId: "" } : {}),
      // A program is a faculty assignment; an office is a staff assignment.
      ...(field === "programId" && value ? { officeId: "" } : {}),
      ...(field === "officeId" && value ? { programId: "" } : {}),
    }))

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    if (!formIsComplete) {
      setError("Please complete all required fields before creating your account.")
      return
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.")
      return
    }
    setSubmitting(true)
    try {
      await apiPost("/auth/registration", {
        token,
        email,
        ...form,
        middleName: form.middleName.trim() || undefined,
        suffix: form.suffix.trim() || undefined,
      })
      setSuccess(true)
      window.setTimeout(() => navigate("/login"), 1800)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequestInvitation = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      await apiPost("/auth/registration/request", { email: requestEmail })
      setRequestSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to request an invitation.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout maxWidthClass="max-w-2xl">
      <AuthCard className="w-full p-5 sm:p-8">
        <AuthCardHeader>
          <AuthCardTitle>Create your account</AuthCardTitle>
          <AuthCardDescription>Complete your profile to activate your URS-DMS account.</AuthCardDescription>
        </AuthCardHeader>
        {error && <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600"><AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span></div>}
        {success ? (
          <div className="rounded-xl bg-emerald-50 p-5 text-center text-sm text-emerald-700">Account created successfully. Redirecting you to sign in...</div>
        ) : loading ? (
          <div className="py-10 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />Validating invitation...</div>
        ) : !token ? (
          requestSent ? (
            <div className="rounded-xl bg-emerald-50 p-5 text-center text-sm text-emerald-700">If the email is eligible, a registration link will arrive shortly. Check your inbox and spam folder.</div>
          ) : (
            <form onSubmit={handleRequestInvitation} className="space-y-5">
              <div className="rounded-xl border border-blue-100 bg-primary-50 p-4 text-sm text-blue-800">Enter your email address and we will send you a secure registration link.</div>
              <div className="space-y-2"><Label htmlFor="request-email">Email address</Label><Input id="request-email" type="email" autoFocus value={requestEmail} onChange={(event) => setRequestEmail(event.target.value)} placeholder="you@urs.edu.ph" className="h-11" required /></div>
              <Button type="submit" disabled={submitting} className="h-11 w-full">{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending link...</> : "Send registration link"}</Button>
            </form>
          )
        ) : options && !error ? (
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div className="space-y-2"><Label htmlFor="registration-email">Email address</Label><Input id="registration-email" value={email} readOnly className="h-11 bg-slate-50 text-slate-600" /></div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="firstName">First name <span className="text-red-500">*</span></Label><Input id="firstName" value={form.firstName} onChange={(event) => update("firstName", event.target.value)} className="h-11" placeholder="Juan" required /></div>
              <div className="space-y-2"><Label htmlFor="lastName">Last name <span className="text-red-500">*</span></Label><Input id="lastName" value={form.lastName} onChange={(event) => update("lastName", event.target.value)} className="h-11" placeholder="Dela Cruz" required /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="middleName">Middle name <span className="text-slate-400 font-normal">(optional)</span></Label><Input id="middleName" value={form.middleName} onChange={(event) => update("middleName", event.target.value)} className="h-11" placeholder="Santos" /></div>
              <div className="space-y-2"><Label htmlFor="suffix">Suffix <span className="text-slate-400 font-normal">(optional)</span></Label><Input id="suffix" value={form.suffix} onChange={(event) => update("suffix", event.target.value)} className="h-11" placeholder="Jr., III" /></div>
            </div>

            <div className="space-y-2"><Label htmlFor="employeeId">Employee/Student ID <span className="text-red-500">*</span></Label><Input id="employeeId" value={form.employeeId} onChange={(event) => update("employeeId", event.target.value)} className="h-11" placeholder="e.g. 2020-00123" required /></div>

            <div className="space-y-2"><Label htmlFor="campusId">Campus <span className="text-red-500">*</span></Label><select id="campusId" value={form.campusId} onChange={(event) => update("campusId", event.target.value)} className={selectClass} required><option value="">Select campus</option>{options.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select><p className="text-xs text-slate-400">Required — your campus is your home unit</p></div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="collegeId">College <span className="text-slate-400 font-normal">(optional)</span></Label><select id="collegeId" value={form.collegeId} onChange={(event) => update("collegeId", event.target.value)} className={selectClass} disabled={!form.campusId}><option value="">Select college</option>{colleges.map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}</select></div>
              <div className="space-y-2"><Label htmlFor="programId">Program <span className="text-slate-400 font-normal">(optional)</span></Label><select id="programId" value={form.programId} onChange={(event) => handleProgramChange(event.target.value)} className={selectClass} disabled={!form.campusId}><option value="">Select program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></div>
            </div>

            <div className="space-y-2"><Label htmlFor="officeId">Office <span className="text-slate-400 font-normal">(optional)</span></Label><select id="officeId" value={form.officeId} onChange={(event) => update("officeId", event.target.value)} className={selectClass} disabled={!form.campusId}><option value="">Select office</option>{offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}</select></div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="registration-password">Password <span className="text-red-500">*</span></Label><PasswordInput id="registration-password" value={form.password} onChange={(event) => update("password", event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="registration-confirm-password">Confirm password <span className="text-red-500">*</span></Label><PasswordInput id="registration-confirm-password" value={form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} error={form.confirmPassword && form.password !== form.confirmPassword ? "Passwords do not match" : undefined} /></div>
            </div>
            {form.password && <PasswordStrength password={form.password} className="rounded-lg bg-slate-50 p-3" />}
            {form.password && !passwordValid && <p className="text-xs font-medium text-red-600">Your password cannot be used yet. Complete all requirements before creating your account.</p>}
            <Button type="submit" disabled={submitting || !formIsComplete} className="h-11 w-full">{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</> : "Create account"}</Button>
          </form>
        ) : null}
        <p className="mt-6 text-center text-sm text-slate-500"><Link to="/login" className="font-medium text-primary-600 hover:underline">Back to sign in</Link></p>
      </AuthCard>
    </AuthLayout>
  )
}
