import { Layout, Button, Breadcrumb, Space } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/app';

const { Header } = Layout;

const breadcrumbMap: Record<string, string> = {
  '/dashboard': '概览',
  '/mrs': '合并请求',
  '/repos': '代码仓库',
  '/settings': '设置',
};

function AppHeader() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const location = useLocation();

  const currentPath =
    Object.keys(breadcrumbMap).find((key) =>
      location.pathname.startsWith(key),
    ) ?? '/dashboard';

  return (
    <Header
      style={{
        padding: '0 16px',
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
      }}
    >
      <Space>
        <Button
          type="text"
          icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={toggleSidebar}
          style={{ fontSize: '16px', width: 48, height: 48 }}
        />
        <Breadcrumb style={{ marginLeft: 8 }}>
          <Breadcrumb.Item>首页</Breadcrumb.Item>
          <Breadcrumb.Item>{breadcrumbMap[currentPath]}</Breadcrumb.Item>
        </Breadcrumb>
      </Space>
      <Space>
        <span style={{ color: '#666', fontSize: 14 }}>CodeHub 代码审查</span>
      </Space>
    </Header>
  );
}

export default AppHeader;
