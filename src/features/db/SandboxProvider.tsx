import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { createWorkerClient } from './client';
import { createSandbox, type Sandbox } from './sandbox';

interface SandboxState {
  sandbox: Sandbox | null;
  status: Sandbox['status'];
  version: string | null;
}

const SandboxContext = createContext<SandboxState>({ sandbox: null, status: 'booting', version: null });

// Песочница создаётся после первого рендера оболочки. Worker с PGlite (отдельный чанк)
// стартует только на первом loadLesson, поэтому теория видна сразу.
export function SandboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SandboxState>({ sandbox: null, status: 'booting', version: null });

  useEffect(() => {
    const sandbox = createSandbox((dataDir) => createWorkerClient({ dataDir }));
    const off = sandbox.subscribe((e) => {
      if (e.type !== 'status') return;
      setState((s) => ({ ...s, status: e.status }));
      if (e.status === 'ready') {
        sandbox
          .client()
          .version()
          .then(
            (version) => setState((s) => ({ ...s, version })),
            () => {},
          );
      }
    });
    setState({ sandbox, status: sandbox.status, version: null });
    // ручка для e2e и отладки в консоли
    if (import.meta.env.DEV) (window as { __vsSandbox?: Sandbox }).__vsSandbox = sandbox;
    // worker не закрываем: провайдер живёт всё время работы приложения, а в StrictMode
    // первый экземпляр песочницы снимается раньше, чем кто-то успевает вызвать loadLesson
    return off;
  }, []);

  return <SandboxContext.Provider value={state}>{children}</SandboxContext.Provider>;
}

export function useSandbox(): SandboxState {
  return useContext(SandboxContext);
}
