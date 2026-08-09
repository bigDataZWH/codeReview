import { useEffect, useState, useRef } from 'react';
import { Layout, Button, Space, Select, Tooltip, Badge, Dropdown, Avatar, Popover, List, Tag, message } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BulbOutlined,
  BulbFilled,
  BellOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  DatabaseOutlined,
  CheckCircleFilled,
  WarningFilled,
  CloseCircleFilled,
  InfoCircleFilled,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore, type NotificationItem } from '@/store/app';
import { codehubApi } from '@/api/codehub';

const { Header } = Layout;

const titleMap: Record<string, string> = {
  '/dashboard': '概览',
  '/mrs': '代码检视',
  '/repos': '代码仓库',
  '/reports': '报表分析',
  '/profile': '个人中心',
  '/settings': '设置',
};

function AppHeader() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const activeRepoId = useAppStore((s) => s.activeRepoId);
  const reposConfig = useAppStore((s) => s.reposConfig);
  const loadReposConfig = useAppStore((s) => s.loadReposConfig);
  const setActiveRepoId = useAppStore((s) => s.setActiveRepoId);
  const themeMode = useAppStore((s) => s.themeMode);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const notifications = useAppStore((s) => s.notifications);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const markAllRead = useAppStore((s) => s.markAllRead);
  const addNotification = useAppStore((s) => s.addNotification);

  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [notifOpen, setNotifOpen] = useState(false);
  const notifOpenRef = useRef(false);

  useEffect(() => {
    notifOpenRef.current = notifOpen;
  }, [notifOpen]);

  useEffect(() => {
    if (reposConfig.length === 0) {
      loadReposConfig();
    }
  }, [reposConfig.length, loadReposConfig]);

  const currentTitle =
    Object.keys(titleMap).find((key) => location.pathname.startsWith(key)) ??
    '概览';

  const handleRepoChange = async (repoId: string) => {
    try {
      const res = await codehubApi.activateRepo(repoId);
      if (res?.ok) {
        setActiveRepoId(res.activeRepoId ?? repoId);
        message.success('已切换仓库');
        queryClient.invalidateQueries();
      } else {
        message.error(res?.error || '切换仓库失败');
      }
    } catch (err) {
      message.error(`切换仓库失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const activeRepo = reposConfig.find((r) => r.repoId === activeRepoId);

  const handleToggleTheme = () => {
    toggleTheme();
    addNotification({
      id: `theme-${Date.now()}`,
      type: 'info',
      title: '主题已切换',
      message: `已切换至${themeMode === 'light' ? '暗色' : '亮色'}模式`,
      timestamp: Date.now(),
      read: false,
    });
  };

  const handleMarkAllRead = () => {
    markAllRead();
  };

  const notifIconMap: Record<NotificationItem['type'], React.ReactNode> = {
    info: <InfoCircleFilled style={{ color: '#3b6bff' }} />,
    success: <CheckCircleFilled style={{ color: '#10b981' }} />,
    warning: <WarningFilled style={{ color: '#f59e0b' }} />,
    error: <CloseCircleFilled style={{ color: '#ef4444' }} />,
  };

  const notifContent = (
    <div style={{ width: 360 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>通知</span>
        {unreadCount > 0 && (
          <Button type="link" size="small" onClick={handleMarkAllRead} style={{ padding: 0, fontSize: 12 }}>
            全部已读
          </Button>
        )}
      </div>
      {notifications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--cr-ink-3)', fontSize: 13 }}>
          暂无通知
        </div>
      ) : (
        <List
          dataSource={notifications.slice(0, 10)}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: '10px 8px',
                background: item.read ? 'transparent' : 'var(--cr-bg-subtle)',
                borderRadius: 8,
                border: 'none',
              }}
            >
              <List.Item.Meta
                avatar={notifIconMap[item.type]}
                title={
                  <span style={{ fontSize: 13, fontWeight: item.read ? 400 : 600 }}>
                    {item.title}
                  </span>
                }
                description={
                  <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 2 }}>
                    {item.message}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人中心',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出',
    },
  ];

  const handleUserMenuClick = ({ key }: { key: string }) => {
    if (key === 'profile') navigate('/profile');
    else if (key === 'settings') navigate('/settings');
    else if (key === 'logout') message.info('退出登录功能待实现');
  };

  return (
    <Header className="cr-header">
      <Space size={8} align="center">
        <Button
          type="text"
          icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={toggleSidebar}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            color: 'var(--cr-ink-2)',
            fontSize: 16,
          }}
        />
        <div
          style={{
            width: 1,
            height: 24,
            background: 'var(--cr-border)',
            margin: '0 4px',
          }}
        />
        <span className="cr-header-title">{currentTitle}</span>
      </Space>

      <Space size={12} align="center">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 12,
            background: 'var(--cr-bg-subtle)',
            border: '1px solid var(--cr-border)',
          }}
        >
          <DatabaseOutlined style={{ color: 'var(--cr-brand-600)' }} />
          <span style={{ fontSize: 12, color: 'var(--cr-ink-3)', fontWeight: 500 }}>
            当前仓库
          </span>
          <Select
            className="cr-repo-select"
            style={{ width: 200 }}
            value={activeRepoId ?? undefined}
            placeholder={reposConfig.length === 0 ? '未配置仓库' : '选择仓库'}
            disabled={reposConfig.length === 0}
            options={reposConfig.map((r) => ({ value: r.repoId, label: r.name }))}
            onChange={handleRepoChange}
          />
        </div>

        <Tooltip title={themeMode === 'light' ? '切换到暗色模式' : '切换到亮色模式'}>
          <Button
            type="text"
            icon={themeMode === 'light' ? <BulbOutlined /> : <BulbFilled />}
            onClick={handleToggleTheme}
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              color: 'var(--cr-ink-2)',
              fontSize: 16,
            }}
          />
        </Tooltip>

        <Popover
          content={notifContent}
          trigger="click"
          open={notifOpen}
          onOpenChange={(open) => {
            setNotifOpen(open);
            if (open) notifOpenRef.current = true;
          }}
          placement="bottomRight"
          overlayStyle={{ padding: 12 }}
        >
          <Badge
            count={unreadCount}
            size="small"
            offset={[-2, 2]}
            style={{ boxShadow: 'none' }}
          >
            <Button
              type="text"
              icon={<BellOutlined />}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                color: 'var(--cr-ink-2)',
                fontSize: 16,
              }}
            />
          </Badge>
        </Popover>

        <Dropdown
          menu={{ items: userMenuItems, onClick: handleUserMenuClick }}
          placement="bottomRight"
          trigger={['click']}
        >
          <Avatar
            icon={<UserOutlined />}
            style={{
              backgroundColor: 'var(--cr-brand-500)',
              cursor: 'pointer',
              width: 36,
              height: 36,
            }}
          />
        </Dropdown>
      </Space>
    </Header>
  );
}

export default AppHeader;