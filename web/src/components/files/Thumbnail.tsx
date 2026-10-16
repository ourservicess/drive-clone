import { useEffect, useRef, useState } from 'react';
import { filesApi } from '../../api/endpoints';
import type { FileItem } from '../../api/types';
import { FileIcon } from './FileIcon';

// Thumbnail URLs are valid for 5 minutes; cache them for 4 to avoid refetching.
const cache = new Map<string, { url: string | null; until: number }>();
const SAFE_IMAGE = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)$/;

/** Image thumbnail (loaded only when scrolled into view) or a big file icon. */
export function Thumbnail({ file }: { file: FileItem }) {
  const isImage = SAFE_IMAGE.test(file.mimeType);
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(() => {
    const hit = cache.get(file.id);
    return hit && hit.until > Date.now() ? hit.url : null;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isImage || url || !ref.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      filesApi
        .thumbnail(file.id)
        .then((res) => {
          cache.set(file.id, { url: res.url, until: Date.now() + 4 * 60 * 1000 });
          if (!cancelled) setUrl(res.url);
        })
        .catch(() => !cancelled && setFailed(true));
    });
    observer.observe(ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [file.id, isImage, url]);

  return (
    <div ref={ref} className="flex h-32 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
      {isImage && url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <FileIcon mimeType={file.mimeType} className="size-14" />
      )}
    </div>
  );
}
