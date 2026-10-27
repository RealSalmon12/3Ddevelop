import { useCallback, useRef, useState } from "react";

const LIMIT = 80;

/**
 * 실행 취소가 되는 상태. set 은 기록을 남기고, preview 는 끄는 중처럼 기록 없이 바꾼다.
 * 끄는 동작은 begin() 으로 시작 모습을 기억하고 commit() 으로 한 칸만 남긴다.
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState(initial);
  // 저장 표시만 바뀔 때도 화면을 다시 그리게 한다.
  const [, bump] = useState(0);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const pending = useRef<T | null>(null);
  const saved = useRef<T>(initial);
  const current = useRef(initial);
  current.current = state;

  const push = (before: T) => {
    past.current.push(before);
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
  };

  const set = useCallback((next: T | ((s: T) => T)) => {
    const value = typeof next === "function" ? (next as (s: T) => T)(current.current) : next;
    if (value === current.current) return;
    push(current.current);
    current.current = value;
    setState(value);
  }, []);

  const preview = useCallback((next: T | ((s: T) => T)) => {
    const value = typeof next === "function" ? (next as (s: T) => T)(current.current) : next;
    pending.current ??= current.current;
    current.current = value;
    setState(value);
  }, []);

  const commit = useCallback(() => {
    if (pending.current === null) return;
    if (pending.current !== current.current) push(pending.current);
    pending.current = null;
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(current.current);
    current.current = prev;
    setState(prev);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(current.current);
    current.current = next;
    setState(next);
  }, []);

  /** 새 파일처럼 기록을 지우고 시작 */
  const reset = useCallback((value: T, dirty = false) => {
    past.current = [];
    future.current = [];
    pending.current = null;
    current.current = value;
    saved.current = dirty ? (undefined as T) : value;
    setState(value);
    bump((n) => n + 1);
  }, []);

  const markSaved = useCallback(() => {
    saved.current = current.current;
    bump((n) => n + 1);
  }, []);

  return {
    state,
    set,
    preview,
    commit,
    undo,
    redo,
    reset,
    markSaved,
    get: () => current.current,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    dirty: state !== saved.current,
  };
}
