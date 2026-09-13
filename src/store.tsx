import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  USERS,
  loadDB,
  saveDB,
  nowIso,
  uid,
  applyAction,
} from "./domain";
import type { Action, ActResult, DB, User } from "./domain";

export interface Toast {
  id: number;
  kind: "ok" | "error";
  title: string;
  messages: string[];
}

interface StoreShape {
  db: DB;
  user: User;
  setUser: (id: string) => void;
  dispatch: (action: Action) => ActResult;
  /** 仅应用变更，不弹全局提示；供弹窗自行展示行内错误 */
  run: (action: Action) => ActResult;
  toasts: Toast[];
  dismissToast: (id: number) => void;
}

const StoreContext = createContext<StoreShape | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(() => loadDB());
  const [user, setUserState] = useState<User>(USERS[0]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  useEffect(() => {
    saveDB(db);
  }, [db]);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (t: Omit<Toast, "id">) => {
      toastSeq.current += 1;
      const id = toastSeq.current;
      setToasts((list) => [...list, { ...t, id }]);
      window.setTimeout(() => dismissToast(id), t.kind === "error" ? 7000 : 3500);
    },
    [dismissToast],
  );

  const dispatch = useCallback(
    (action: Action): ActResult => {
      const res = applyAction(db, action, { user, at: nowIso(), uid });
      if (res.ok) {
        setDb(res.db);
        pushToast({ kind: "ok", title: res.message, messages: [] });
      } else {
        pushToast({ kind: "error", title: "操作被阻止", messages: res.errors });
      }
      return res;
    },
    [db, user, pushToast],
  );

  const setUser = useCallback((id: string) => {
    const next = USERS.find((u) => u.id === id);
    if (next) setUserState(next);
  }, []);

  const run = useCallback(
    (action: Action): ActResult => {
      const res = applyAction(db, action, { user, at: nowIso(), uid });
      if (res.ok) {
        setDb(res.db);
        if (res.message && res.message !== "没有改动" && res.message !== "联系方式未变化" && res.message !== "负责医生未变化")
          pushToast({ kind: "ok", title: res.message, messages: [] });
      }
      return res;
    },
    [db, user, pushToast],
  );

  const value = useMemo(
    () => ({ db, user, setUser, dispatch, run, toasts, dismissToast }),
    [db, user, setUser, dispatch, run, toasts, dismissToast],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreShape {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
