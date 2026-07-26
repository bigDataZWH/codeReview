import { Layout, Menu } from 'antd';
import {
  DashboardOutlined,
  MergeOutlined,
  FolderOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';

const { Sider } = Layout;

interface SidebarProps {
  collapsed: boolean;
}

const menuItems = [
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: '概览',
  },
  {
    key: '/mrs',
    icon: <MergeOutlined />,
    label: '合并请求',
  },
  {
    key: '/repos',
    icon: <FolderOutlined />,
    label: '代码仓库',
  },
  {
    key: '/settings',
    icon: <SettingOutlined />,
    label: '设置',
  },
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
      width={220}
      theme="dark"
    >
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: collapsed ? 14 : 18,
          fontWeight: 600,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {collapsed ? 'CR' : 'CodeReview'}
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{ borderRight: 0 }}
      />
    </Sider>
  );
}

export default AppSidebar;
