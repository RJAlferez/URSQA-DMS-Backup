import { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { cn } from "@/lib/utils"

interface ChartCardProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export function ChartCard({ title, description, children, className }: ChartCardProps) {
  return (
    <Card className={cn("border-border/70 shadow-soft", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold text-gray-900">{title}</CardTitle>
        {description && (
          <p className="text-[13px] text-gray-500 mt-0.5">{description}</p>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}