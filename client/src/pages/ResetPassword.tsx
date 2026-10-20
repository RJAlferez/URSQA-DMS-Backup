import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { AuthLayout } from "@/components/auth"
import { AuthCard, AuthCardDescription, AuthCardHeader, AuthCardTitle } from "@/components/auth/AuthCard"
import { PasswordInput } from "@/components/auth/PasswordInput"
import { PasswordStrength } from "@/components/auth/PasswordStrength"
import { passwordMeetsRequirements } from "@/components/auth/passwordRules"
import { Button } from "@/components/ui/Button"
import { Label } from "@/components/ui/Label"
import { apiPost } from "@/lib/http"

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")
  const passwordValid = useMemo(() => passwordMeetsRequirements(password), [password])
  const formValid = Boolean(token && passwordValid && password === confirmPassword)

  useEffect(() => { document.title = "Reset Password | URS-QA DMS" }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    if (!token) { setError("This reset link is missing or invalid."); return }
    if (!passwordValid) { setError("Please use a password that meets all the requirements."); return }
    if (password !== confirmPassword) { setError("Passwords do not match."); return }
    setSubmitting(true)
    try {
      await apiPost("/auth/reset-password", { token, newPassword: password })
      setSuccess(true)
      window.setTimeout(() => navigate("/login"), 1800)
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset your password.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <AuthCard className="w-full max-w-md">
        <AuthCardHeader>
          <AuthCardTitle>Set a new password</AuthCardTitle>
          <AuthCardDescription>Choose a strong password for your URS-QA DMS account.</AuthCardDescription>
        </AuthCardHeader>
        {error && <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
        {success ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5 text-center text-sm text-emerald-700"><CheckCircle2 className="mx-auto mb-3 h-7 w-7" />Password reset successfully. Redirecting you to sign in...</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2"><Label htmlFor="new-password">New password</Label><PasswordInput id="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
            {password && <PasswordStrength password={password} className="rounded-lg bg-slate-50 p-3" />}
            {password && !passwordValid && <p className="text-xs font-medium text-red-600">Your password is not ready yet. Complete all requirements before continuing.</p>}
            <div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><PasswordInput id="confirm-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} error={confirmPassword && password !== confirmPassword ? "Passwords do not match" : undefined} /></div>
            <Button type="submit" disabled={submitting || !formValid} className="h-11 w-full">{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving password...</> : "Reset password"}</Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-slate-500"><Link to="/login" className="font-medium text-primary-600 hover:underline">Back to sign in</Link></p>
      </AuthCard>
    </AuthLayout>
  )
}
