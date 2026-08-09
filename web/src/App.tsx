import { useEffect } from 'react';
import { Layout } from 'antd';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppSidebar from '@/components/layout/Sidebar';
import AppHeader from '@/components/layout/Header';
import Dashboard from '@/pages/Dashboard';
import Reports from '@/pages/Reports';
import MRList from '@/pages/MRList';
import MRDetail from '@/pages/MRDetail';
import Repos from '@/pages/Repos';
import Settings from '@/pages/Settings';
import { useAppStore } from '@/store/app';

const { Content } = Layout;

// 窄屏断点：与 CSS 媒体查询保持一致
const MOBILE_BREAKPOINT = 768;

function App() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  // 挂载时根据窗口宽度初始化侧边栏折叠状态：窄屏默认折叠
  useEffect(() => {
    if (window.innerWidth < MOBILE_BREAKPOINT && !sidebarCollapsed) {
      toggleSidebar();
    }
    // 仅在挂载时执行一次，避免覆盖用户后续手动操作
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <AppSidebar collapsed={sidebarCollapsed} />
      <Layout>
        <AppHeader />
        <Content style={{ margin: '16px', padding: 0, maxWidth: '100%' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/mrs" element={<MRList />} />
            <Route path="/mrs/:mrIid" element={<MRDetail />} />
            <Route path="/repos" element={<Repos />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
