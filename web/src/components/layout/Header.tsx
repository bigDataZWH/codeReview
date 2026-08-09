import { useEffect } from 'react';
import { Layout, Button, Breadcrumb, Space, Select, message } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/store/app';
import { codehubApi } from '@/api/codehub';

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
  const activeRepoId = useAppStore((s) => s.activeRepoId);
  const reposConfig = useAppStore((s) => s.reposConfig);
  const loadReposConfig = useAppStore((s) => s.loadReposConfig);
  const setActiveRepoId = useAppStore((s) => s.setActiveRepoId);
  const location = useLocation();
  const queryClient = useQueryClient();

  // 挂载时若多仓配置为空，拉取一次仓库列表及当前激活仓库
  useEffect(() => {
    if (reposConfig.length === 0) {
      loadReposConfig();
    }
  }, [reposConfig.length, loadReposConfig]);

  const currentPath =
    Object.keys(breadcrumbMap).find((key) =>
      location.pathname.startsWith(key),
    ) ?? '/dashboard';

  // 切换激活仓库：调用后端激活接口，成功后同步 store 并清空查询缓存以刷新当前页面数据
  const handleRepoChange = async (repoId: string) => {
    try {
      const res = await codehubApi.activateRepo(repoId);
      if (res?.ok) {
        setActiveRepoId(res.activeRepoId ?? repoId);
        message.success('已切换仓库');
        // 清空所有查询缓存，触发当前页面数据重新拉取
        queryClient.invalidateQueries();
      } else {
        message.error(res?.error || '切换仓库失败');
      }
    } catch (err) {
      message.error(`切换仓库失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

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
        {/* 仓库切换下拉框 */}
        <Space size={6}>
          <DatabaseOutlined style={{ color: '#666' }} />
          <Select
            style={{ width: 200 }}
            value={activeRepoId ?? undefined}
            placeholder={reposConfig.length === 0 ? '未配置仓库' : '选择仓库'}
            disabled={reposConfig.length === 0}
            options={reposConfig.map((r) => ({ value: r.repoId, label: r.name }))}
            onChange={handleRepoChange}
          />
        </Space>
        <span style={{ color: '#666', fontSize: 14 }}>CodeHub 代码审查</span>
      </Space>
    </Header>
  );
}

export default AppHeader;
