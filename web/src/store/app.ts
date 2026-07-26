import { create } from 'zustand';
import type { CodeHubConfig } from '@/api/codehub';

interface AppState {
  config: CodeHubConfig | null;
  isConfigured: boolean;
  sidebarCollapsed: boolean;
  currentMR: number | null;

  setConfig: (config: CodeHubConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  toggleSidebar: () => void;
  setCurrentMR: (mrIid: number | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  config: null,
  isConfigured: false,
  sidebarCollapsed: false,
  currentMR: null,

  setConfig: (config) => set({ config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setCurrentMR: (mrIid) => set({ currentMR: mrIid }),
}));
