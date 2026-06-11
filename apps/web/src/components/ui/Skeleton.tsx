import { cn } from '@/lib/utils';

/** Pulsing placeholder block. Size it with className (`h-4 w-32`, etc.). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-gray-200/80', className)} aria-hidden="true" />;
}

/**
 * Full-screen app-shell placeholder shown while the session / bootstrap
 * loads — sidebar rail + content blocks, so the first paint already has the
 * app's shape instead of a bare "Loading…" string.
 */
export function ShellSkeleton({ label }: { label?: string }) {
  return (
    <div className="h-screen overflow-hidden flex bg-gray-50" role="status" aria-label={label ?? 'Loading'}>
      <div className="hidden lg:flex w-60 shrink-0 h-full bg-white border-r border-gray-200 flex-col px-4 pt-5 gap-3">
        <div className="flex items-center gap-2.5 mb-4">
          <Skeleton className="w-9 h-9 rounded-xl" />
          <Skeleton className="h-4 w-24" />
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-lg" />
        ))}
      </div>
      <div className="flex-1 min-w-0 px-6 py-6 space-y-4 max-w-7xl mx-auto w-full">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
      <span className="sr-only">{label ?? 'Loading'}</span>
    </div>
  );
}
