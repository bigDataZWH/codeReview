import { create } from 'zustand';
import { codehubApi, type CodeHubConfig, type RepoConfig } from '@/api/codehub';

interface AppState {
  config: CodeHubConfig | null;
  isConfigured: boolean;
  sidebarCollapsed: boolean;
  currentMR: number | null;

  // 多仓配置相关状态
  activeRepoId: string | null;
  reposConfig: RepoConfig[];

  setConfig: (config: CodeHubConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  toggleSidebar: () => void;
  setCurrentMR: (mrIid: number | null) => void;

  // 多仓配置操作
  setActiveRepoId: (id: string | null) => void;
  setReposConfig: (repos: RepoConfig[]) => void;
  loadReposConfig: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  config: null,
  isConfigured: false,
  sidebarCollapsed: false,
  currentMR: null,

  activeRepoId: null,
  reposConfig: [],

  setConfig: (config) => set({ config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setCurrentMR: (mrIid) => set({ currentMR: mrIid }),

  setActiveRepoId: (id) => set({ activeRepoId: id }),
  setReposConfig: (repos) => set({ reposConfig: repos }),
  // 从后端拉取多仓配置及当前激活仓库，失败时保持空配置不抛出
  loadReposConfig: async () => {
    try {
      const data = await codehubApi.listReposConfig();
      set({
        reposConfig: data?.repos ?? [],
        activeRepoId: data?.activeRepoId ?? null,
      });
    } catch {
      // 后端不可用或未配置时静默处理
    }
  },
}));
