// App-level UI state: boot phase, background jobs, toasts and the confirm dialog.
import { create } from 'zustand';
import type { ExtractProgress } from '@shared/types';

export type Phase = 'loading' | 'setup' | 'building' | 'ready';

interface ConfirmReq {
  title: string;
  text: string;
  buttons: { label: string; value: string; primary?: boolean }[];
  resolve(v: string): void;
}

interface UiState {
  phase: Phase;
  buildProgress: ExtractProgress | null;
  buildError: string | null;
  thumbJob: { done: number; total: number } | null;
  toast: { text: string; error?: boolean; id: number } | null;
  confirm: ConfirmReq | null;
  exportOpen: boolean;
  logicOpen: boolean; // the block editor
  logicFocus: string | null; // the object it was opened for
  setPhase(p: Phase): void;
  setBuild(p: ExtractProgress | null, error?: string | null): void;
  setThumbJob(j: { done: number; total: number } | null): void;
  notify(text: string, error?: boolean): void;
  ask(title: string, text: string, buttons: ConfirmReq['buttons']): Promise<string>;
  closeConfirm(v: string): void;
}

export const useUi = create<UiState>((set, get) => ({
  phase: 'loading',
  buildProgress: null,
  buildError: null,
  thumbJob: null,
  toast: null,
  confirm: null,
  exportOpen: false,
  logicOpen: false,
  logicFocus: null,
  setPhase: (phase) => set({ phase }),
  setBuild: (buildProgress, buildError = null) => set({ buildProgress, buildError }),
  setThumbJob: (thumbJob) => set({ thumbJob }),
  notify: (text, error) => {
    const id = Date.now();
    set({ toast: { text, error, id } });
    setTimeout(() => get().toast?.id === id && set({ toast: null }), error ? 6000 : 3200);
  },
  ask: (title, text, buttons) => new Promise((resolve) => set({ confirm: { title, text, buttons, resolve } })),
  closeConfirm: (v) => {
    get().confirm?.resolve(v);
    set({ confirm: null });
  },
}));
