import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { AlertCircle, CheckCircle2, Loader2, Mail } from "lucide-react"
import { AuthLayout } from "@/components/auth"
import { AuthCard, AuthCardDescription, AuthCardHeader, AuthCardTitle } from "@/components/auth/AuthCard"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Label } from "@/components/ui/Label"
import { apiPost } from "@/lib/http"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => { document.title = "Forgot Password | URS-QA DMS" }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      await apiPost("/auth/forgot-password", { email })
      setSent(true)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to send the reset link.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <AuthCard className="w-full max-w-md">
        <AuthCardHeader>
          <AuthCardTitle>Forgot your password?</AuthCardTitle>
          <AuthCardDescription>Enter your email and we will send you a secure link to reset it.</AuthCardDescription>
        </AuthCardHeader>
        {error && <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
        {sent ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5 text-center text-sm text-emerald-700">
            <CheckCircle2 className="mx-auto mb-3 h-7 w-7" />
            If an account exists for this email, reset instructions have been sent. Check your inbox and spam folder.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email address</Label>
              <div className="relative"><Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input id="forgot-email" type="email" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@urs.edu.ph" className="h-11 pl-9" /></div>
            </div>
            <Button type="submit" disabled={submitting} className="h-11 w-full">{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending link...</> : "Send reset link"}</Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-slate-500"><Link to="/login" className="font-medium text-primary-600 hover:underline">Back to sign in</Link></p>
      </AuthCard>
    </AuthLayout>
  )
}
