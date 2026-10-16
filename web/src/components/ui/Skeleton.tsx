function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

export function GridSkeleton() {
  return (
    <div role="status" aria-label="Loading files" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 p-3">
            <Bar className="size-5" />
            <Bar className="h-3 flex-1" />
          </div>
          <Bar className="mx-3 mb-3 h-28 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading files" className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Bar className="size-5" />
          <Bar className="h-3 w-1/3" />
          <Bar className="ml-auto hidden h-3 w-20 sm:block" />
          <Bar className="hidden h-3 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}
