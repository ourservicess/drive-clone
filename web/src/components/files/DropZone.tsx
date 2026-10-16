import { Upload } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useDrive } from '../../context/DriveContext';

/** Wraps a page so files dragged from the computer are uploaded to `folderId`. */
export function DropZone({ folderId, children }: { folderId: string | null; children: ReactNode }) {
  const { startUploads } = useDrive();
  const [active, setActive] = useState(false);
  const depth = useRef(0); // dragenter/leave fire for every child element

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setActive(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setActive(false);
        startUploads(Array.from(e.dataTransfer.files), folderId);
      }}
    >
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-500 bg-brand-50/80">
          <div className="flex flex-col items-center gap-2 rounded-xl bg-brand-500 px-6 py-4 text-white shadow-lg">
            <Upload className="size-6" aria-hidden />
            <span className="text-sm font-medium">Drop files to upload them here</span>
          </div>
        </div>
      )}
    </div>
  );
}
