import { useCallback, useEffect, useState } from "react";

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, refreshMs = 0) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    load(controller.signal)
      .then((result) => {
        if (active) setValue(result);
      })
      .catch((e) => {
        if (active) {
          setValue(undefined);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [load, revision]);
  useEffect(() => {
    if (refreshMs <= 0 || loading) return;
    const timer = setInterval(reload, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, loading, reload]);
  return { value, error, loading, reload };
}

export function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
