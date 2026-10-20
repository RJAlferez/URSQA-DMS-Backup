import { useEffect } from "react"
import { LoginForm } from "@/components/auth"
import { AuthLayout } from "@/components/auth"

export default function LoginPage() {
  useEffect(() => {
    document.title = "URS-QA DMS | Quality Assurance Data Management System"
  }, [])

  return (
    <AuthLayout className="login-page">
      <LoginForm />
    </AuthLayout>
  )
}
