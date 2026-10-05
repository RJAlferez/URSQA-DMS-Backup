import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn(
      "flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6 lg:mb-8",
      className
    )}>
      <div>
        <h1 className="text-2xl sm:text-[26px] font-extrabold text-navy-900 tracking-tight dark:text-gray-100">{title}</h1>
        {description && (
          <p className="mt-1.5 hidden text-[13px] text-gray-500 dark:text-gray-300 sm:block sm:text-[14px]">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  )
}
