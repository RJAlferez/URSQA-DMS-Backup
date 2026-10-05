import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular" | "card"
  width?: string | number
  height?: string | number
}

function Skeleton({ className, variant = "rectangular", width, height, style, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden bg-slate-200/70 dark:bg-slate-700/60 before:absolute before:inset-0 before:-translate-x-[120%] before:bg-gradient-to-r before:from-transparent before:via-white/55 before:to-transparent before:animate-[skeleton-shimmer_2.2s_cubic-bezier(0.4,0,0.2,1)_infinite] dark:before:via-white/10",
        variant === "circular" && "rounded-full",
        variant === "text" && "rounded h-4",
        variant === "rectangular" && "rounded-lg",
        variant === "card" && "rounded-xl",
        className
      )}
      style={{ width, height, ...style }}
      {...props}
    />
  )
}

function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" variant="text" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-8 flex-1" variant="rectangular" />
          ))}
        </div>
      ))}
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border/60 bg-white p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10" variant="circular" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-3/4" variant="text" />
          <Skeleton className="h-3 w-1/2" variant="text" />
        </div>
      </div>
      <Skeleton className="h-2 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16" variant="text" />
        <Skeleton className="h-6 w-16" variant="text" />
      </div>
    </div>
  )
}

export { Skeleton, SkeletonTable, SkeletonCard }
