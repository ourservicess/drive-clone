import { useCallback, useEffect, useState, type DependencyList } from 'react';
import { errorMessage } from '../api/client';
import { useDrive } from '../context/DriveContext';

interface LoaderState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
}

/**
 * Loads data for a page and reloads it whenever `deps` change or anything in
 * the drive changes (uploads, renames, deletes...). Old data stays on screen
 * while reloading so the page does not flicker.
 */
export function useLoader<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList) {
  const { version } = useDrive();
  const [state, setState] = useState<LoaderState<T>>({ data: undefined, loading: true, error: undefined });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: undefined });
      })
      .catch((err) => {
        if (!controller.signal.aborted) setState({ data: undefined, loading: false, error: errorMessage(err) });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, retry]);

  const reload = useCallback(() => setRetry((r) => r + 1), []);
  return { ...state, reload };
}
