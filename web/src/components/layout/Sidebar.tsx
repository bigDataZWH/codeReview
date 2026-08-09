import { Layout, Menu } from 'antd';
import {
  DashboardOutlined,
  BarChartOutlined,
  EyeOutlined,
  FolderOutlined,
  SettingOutlined,
  CodeOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';

const { Sider } = Layout;

interface SidebarProps {
  collapsed: boolean;
}

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
  { key: '/mrs', icon: <EyeOutlined />, label: '代码检视' },
  { key: '/repos', icon: <FolderOutlined />, label: '代码仓库' },
  { key: '/reports', icon: <BarChartOutlined />, label: '报表分析' },
  { key: '/profile', icon: <UserOutlined />, label: '个人中心' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

function AppSidebar({ collapsed }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const selectedKey =
    menuItems.find((item) => location.pathname.startsWith(item.key))?.key ??
    '/dashboard';

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={232}
      theme="dark"
      style={{
        background:
          'linear-gradient(180deg, var(--cr-sider-top) 0%, var(--cr-sider-bottom) 100%)',
        boxShadow: '2px 0 16px rgba(2, 6, 23, 0.25)',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        transition: 'width 0.2s ease',
      }}
    >
      <div
        style={{
          height: 72,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 18px',
          color: '#fff',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(240px 80px at 0% 0%, rgba(59,107,255,0.28), transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background:
              'linear-gradient(135deg, #3b6bff 0%, #0ea5a4 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 6px 18px rgba(59, 107, 255, 0.45)',
            flexShrink: 0,
          }}
        >
          <CodeOutlined style={{ color: '#fff', fontSize: 18 }} />
        </div>
        {!collapsed && (
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.02em' }}>
              CodeReview
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#8ea0d0',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginTop: 2,
              }}
            >
              AI 代码审查平台
            </div>
          </div>
        )}
      </div>

      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{
          borderRight: 0,
          background: 'transparent',
          padding: '14px 12px',
        }}
        className="cr-sider-menu"
      />

      {!collapsed && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            right: 16,
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: '#9fb0d8',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.8)',
              }}
            />
            <span style={{ fontWeight: 600, color: '#dce6ff' }}>System Online</span>
          </div>
          <div style={{ opacity: 0.7 }}>AI · CodeHub · Multi-Repo</div>
        </div>
      )}
    </Sider>
  );
}

export default AppSidebar;