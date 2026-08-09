import { useEffect, useMemo } from 'react';
import { Layout, ConfigProvider, App as AntApp, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppSidebar from '@/components/layout/Sidebar';
import AppHeader from '@/components/layout/Header';
import Dashboard from '@/pages/Dashboard';
import Reports from '@/pages/Reports';
import MRList from '@/pages/MRList';
import MRDetail from '@/pages/MRDetail';
import Repos from '@/pages/Repos';
import Settings from '@/pages/Settings';
import Profile from '@/pages/Profile';
import { useAppStore } from '@/store/app';

const { Content } = Layout;

const MOBILE_BREAKPOINT = 768;

const lightTokens = {
  token: {
    colorPrimary: '#3b6bff',
    colorInfo: '#3b6bff',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    colorBgLayout: '#f4f6fb',
    colorBgContainer: '#ffffff',
    colorText: '#0f172a',
    colorTextSecondary: '#334155',
    colorTextTertiary: '#64748b',
    colorBorder: '#e2e8f0',
    colorBorderSecondary: '#eef2f9',
    colorFillAlter: '#eef2f9',
    borderRadius: 10,
    fontSize: 14,
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: {
      headerBg: 'rgba(255,255,255,0.78)',
      headerHeight: 68,
      siderBg: '#0b1228',
      bodyBg: '#f4f6fb',
      triggerBg: 'transparent',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(59,107,255,0.18)',
      darkItemHoverBg: 'rgba(255,255,255,0.05)',
      darkItemColor: '#c8d1e8',
      darkItemSelectedColor: '#ffffff',
      darkItemHoverColor: '#ffffff',
      itemBorderRadius: 10,
      itemHeight: 42,
    },
    Card: {
      borderRadiusLG: 14,
      headerFontSize: 14,
      headerHeight: 48,
    },
    Button: {
      borderRadius: 8,
      controlHeight: 36,
      primaryShadow: '0 1px 2px rgba(59, 107, 255, 0.2), 0 2px 6px rgba(59, 107, 255, 0.18)',
    },
    Input: { controlHeight: 38 },
    Select: { controlHeight: 38 },
    Table: {
      headerBg: '#eef2f9',
      headerColor: '#334155',
      headerSplitColor: '#e2e8f0',
      rowHoverBg: 'rgba(59, 107, 255, 0.04)',
    },
    Tabs: {
      itemSelectedColor: '#2a54e6',
      inkBarColor: '#3b6bff',
      itemHoverColor: '#3b6bff',
    },
    Tag: { defaultBg: '#f1f5f9', defaultColor: '#475569' },
    Breadcrumb: { fontSize: 13, separatorColor: '#94a3b8' },
    Alert: { borderRadiusLG: 10 },
    Modal: { contentBg: '#ffffff', headerBg: '#ffffff' },
    Segmented: {
      trackBg: '#eef2f9',
      itemColor: '#64748b',
      itemHoverColor: '#3b6bff',
      itemSelectedBg: '#ffffff',
      itemSelectedColor: '#2a54e6',
    },
  },
};

const darkTokens = {
  token: {
    colorPrimary: '#3b6bff',
    colorInfo: '#3b6bff',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    colorBgLayout: '#0f172a',
    colorBgContainer: '#1e293b',
    colorText: '#f1f5f9',
    colorTextSecondary: '#cbd5e1',
    colorTextTertiary: '#94a3b8',
    colorBorder: '#334155',
    colorBorderSecondary: '#1e293b',
    colorFillAlter: '#1e293b',
    borderRadius: 10,
    fontSize: 14,
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: {
      headerBg: 'rgba(15,23,42,0.85)',
      headerHeight: 68,
      siderBg: '#0b1228',
      bodyBg: '#0f172a',
      triggerBg: 'transparent',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(59,107,255,0.18)',
      darkItemHoverBg: 'rgba(255,255,255,0.05)',
      darkItemColor: '#c8d1e8',
      darkItemSelectedColor: '#ffffff',
      darkItemHoverColor: '#ffffff',
      itemBorderRadius: 10,
      itemHeight: 42,
    },
    Card: {
      borderRadiusLG: 14,
      headerFontSize: 14,
      headerHeight: 48,
    },
    Button: {
      borderRadius: 8,
      controlHeight: 36,
      primaryShadow: '0 1px 2px rgba(59, 107, 255, 0.2), 0 2px 6px rgba(59, 107, 255, 0.18)',
    },
    Input: { controlHeight: 38 },
    Select: { controlHeight: 38 },
    Table: {
      headerBg: '#1e293b',
      headerColor: '#cbd5e1',
      headerSplitColor: '#334155',
      rowHoverBg: 'rgba(59, 107, 255, 0.08)',
    },
    Tabs: {
      itemSelectedColor: '#7ba6ff',
      inkBarColor: '#3b6bff',
      itemHoverColor: '#7ba6ff',
    },
    Tag: { defaultBg: '#334155', defaultColor: '#cbd5e1' },
    Breadcrumb: { fontSize: 13, separatorColor: '#64748b' },
    Alert: { borderRadiusLG: 10 },
    Modal: { contentBg: '#1e293b', headerBg: '#1e293b' },
    Segmented: {
      trackBg: '#1e293b',
      itemColor: '#94a3b8',
      itemHoverColor: '#7ba6ff',
      itemSelectedBg: '#334155',
      itemSelectedColor: '#7ba6ff',
    },
  },
};

function App() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const themeMode = useAppStore((s) => s.themeMode);

  useEffect(() => {
    if (window.innerWidth < MOBILE_BREAKPOINT && !sidebarCollapsed) {
      toggleSidebar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const themeConfig = useMemo(() => {
    const algorithm = themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm;
    const tokens = themeMode === 'dark' ? darkTokens : lightTokens;
    return {
      algorithm,
      ...tokens,
    };
  }, [themeMode]);

  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntApp>
        <Layout style={{ minHeight: '100vh' }}>
          <AppSidebar collapsed={sidebarCollapsed} />
          <Layout>
            <AppHeader />
            <Content style={{ margin: '20px', padding: 0, maxWidth: '100%' }}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/mrs" element={<MRList />} />
                <Route path="/mrs/:mrIid" element={<MRDetail />} />
                <Route path="/repos" element={<Repos />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Content>
          </Layout>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}

export default App;