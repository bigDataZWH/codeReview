import { Layout } from 'antd';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppSidebar from '@/components/layout/Sidebar';
import AppHeader from '@/components/layout/Header';
import Dashboard from '@/pages/Dashboard';
import MRList from '@/pages/MRList';
import MRDetail from '@/pages/MRDetail';
import Repos from '@/pages/Repos';
import Settings from '@/pages/Settings';
import { useAppStore } from '@/store/app';

const { Content } = Layout;

function App() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <AppSidebar collapsed={sidebarCollapsed} />
      <Layout>
        <AppHeader />
        <Content style={{ margin: '16px', padding: 0 }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
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
