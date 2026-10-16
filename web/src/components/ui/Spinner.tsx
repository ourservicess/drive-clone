import { LoaderCircle } from 'lucide-react';

export function Spinner({ className = 'size-6' }: { className?: string }) {
  return <LoaderCircle className={`animate-spin ${className}`} aria-hidden />;
}

export function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center text-brand-500" role="status">
      <Spinner className="size-8" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
