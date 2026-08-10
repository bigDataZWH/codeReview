import { useState, useCallback } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Row,
  Col,
  Spin,
  Segmented,
  message,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Form } from 'antd';
import dayjs from 'dayjs';
import { codehubApi, type RepoInfo, type RepoConfig } from '@/api/codehub';
import { useAppStore } from '@/store/app';
import RepoCard, { formatSize, getStatus } from '@/components/repos/RepoCard';
import { CloneRepoModal, CheckoutModal } from '@/components/repos/Modals';
import EmptyRepos from '@/components/repos/EmptyRepos';

function Repos() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setActiveRepoId = useAppStore((s) => s.setActiveRepoId);
  const [cloneModalVisible, setCloneModalVisible] = useState(false);
  const [checkoutModalVisible, setCheckoutModalVisible] = useState(false);
  const [currentRepo, setCurrentRepo] = useState<string | null>(null);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [cloneForm] = Form.useForm();
  const [checkoutForm] = Form.useForm();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['repos'],
    queryFn: () => codehubApi.getRepos() as Promise<{ ok: boolean; repos: RepoInfo[]; count: number }>,
    retry: false,
  });

  const { data: projectListData } = useQuery({
    queryKey: ['repos-config-list'],
    queryFn: () => codehubApi.listReposConfig() as Promise<{ repos: RepoConfig[]; activeRepoId: string | null }>,
    retry: false,
  });

  const repos = data?.repos ?? [];

  const projectOptions = (projectListData?.repos ?? []).map((r) => ({
    value: r.projectId.toString(),
    label: r.name || r.projectId.toString(),
  }));

  const cloneProjectId = Form.useWatch('projectId', cloneForm);

  const { data: branchesData } = useQuery({
    queryKey: ['repo-branches', cloneProjectId],
    queryFn: () => codehubApi.getRepoBranches(cloneProjectId!),
    enabled: !!cloneProjectId,
    retry: false,
  });

  const branchOptions = (() => {
    if (!branchesData) return [];
    const branches: string[] = branchesData.branches || branchesData.data?.branches || [];
    return branches.map((b: string) => ({ value: b, label: b }));
  })();

  const cloneMutation = useMutation({
    mutationFn: (d: { projectId: string; branch?: string; depth?: number }) =>
      codehubApi.cloneRepo(d.projectId, { branch: d.branch, depth: d.depth }),
    onSuccess: () => {
      message.success('克隆成功');
      setCloneModalVisible(false);
      cloneForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
    onError: (err) => {
      message.error(`克隆失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const fetchMutation = useMutation({
    mutationFn: (projectId: string) => codehubApi.fetchRepo(projectId),
    onSuccess: () => {
      message.success('Fetch 成功');
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
    onError: (err) => {
      message.error(`Fetch 失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const pullMutation = useMutation({
    mutationFn: (projectId: string) => codehubApi.pullRepo(projectId),
    onSuccess: () => {
      message.success('Pull 成功');
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
    onError: (err) => {
      message.error(`Pull 失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => codehubApi.deleteRepo(projectId),
    onSuccess: () => {
      message.success('删除成功');
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
    onError: (err) => {
      message.error(`删除失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: (d: { projectId: string; branch: string }) =>
      codehubApi.checkoutBranch(d.projectId, d.branch),
    onSuccess: () => {
      message.success('切换分支成功');
      setCheckoutModalVisible(false);
      checkoutForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
    onError: (err) => {
      message.error(`切换分支失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const batchSync = useCallback(async () => {
    if (repos.length === 0) return;
    setSyncing(true);
    try {
      let success = 0;
      let failed = 0;
      for (const repo of repos) {
        try {
          await codehubApi.fetchRepo(repo.projectId);
          success++;
        } catch {
          failed++;
        }
      }
      message.success(`批量同步完成：成功 ${success} 个，失败 ${failed} 个`);
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    } finally {
      setSyncing(false);
    }
  }, [repos, queryClient]);

  const handleClone = async () => {
    try {
      const values = await cloneForm.validateFields();
      cloneMutation.mutate(values);
    } catch {
      // validation error
    }
  };

  const handleCheckout = async () => {
    if (!currentRepo) return;
    try {
      const values = await checkoutForm.validateFields();
      checkoutMutation.mutate({ projectId: currentRepo, branch: values.branch });
    } catch {
      // validation error
    }
  };

  const openCheckout = (repoId: string) => {
    setCurrentRepo(repoId);
    const repo = repos.find((r) => r.projectId === repoId);
    checkoutForm.setFieldsValue({ branch: repo?.currentBranch ?? '' });
    setCheckoutModalVisible(true);
  };

  const openMRs = (repoId: string) => {
    if (repoId) {
      setActiveRepoId(repoId);
    }
    navigate('/mrs');
  };

  const tableColumns = [
    {
      title: '项目',
      dataIndex: 'projectId',
      key: 'projectId',
      render: (id: string, record: RepoInfo) => (
        <Space>
          <span style={{ color: 'var(--cr-brand-500)' }}>📁</span>
          <span style={{ fontFamily: 'monospace' }}>{record.projectName || id}</span>
        </Space>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_: unknown, record: RepoInfo) => {
        const s = getStatus(record.lastFetchedAt);
        return (
          <Tag color={s === 'online' ? 'success' : 'default'} style={{ margin: 0 }}>
            {s === 'online' ? '在线' : '离线'}
          </Tag>
        );
      },
    },
    {
      title: '当前分支',
      dataIndex: 'currentBranch',
      key: 'currentBranch',
      width: 140,
      render: (branch: string) => (
        <Tag color="blue" style={{ margin: 0 }}>{branch}</Tag>
      ),
    },
    {
      title: '本地路径',
      dataIndex: 'localPath',
      key: 'localPath',
      render: (p: string) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#666' }}>{p}</span>
      ),
    },
    {
      title: '大小',
      dataIndex: 'sizeBytes',
      key: 'sizeBytes',
      width: 100,
      render: (bytes?: number) => formatSize(bytes),
    },
    {
      title: '最后拉取',
      dataIndex: 'lastFetchedAt',
      key: 'lastFetchedAt',
      width: 170,
      render: (t: string) => (t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: unknown, record: RepoInfo) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<SyncOutlined />}
            loading={fetchMutation.isPending && fetchMutation.variables === record.projectId}
            onClick={() => fetchMutation.mutate(record.projectId)}
          >
            Fetch
          </Button>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            loading={pullMutation.isPending && pullMutation.variables === record.projectId}
            onClick={() => pullMutation.mutate(record.projectId)}
          >
            Pull
          </Button>
          <Button type="text" size="small" onClick={() => openCheckout(record.projectId)}>
            切换
          </Button>
          <Button
            type="text"
            size="small"
            danger
            onClick={() => deleteMutation.mutate(record.projectId)}
            loading={deleteMutation.isPending && deleteMutation.variables === record.projectId}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const renderListTable = () => (
    <Card style={{ borderRadius: 14 }} bodyStyle={{ padding: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr
            style={{
              background: 'var(--cr-bg-subtle)',
              fontSize: 12,
              color: 'var(--cr-ink-2)',
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
            }}
          >
            {tableColumns.map((col) => (
              <th
                key={col.key}
                style={{
                  textAlign: 'left',
                  padding: '12px 16px',
                  fontWeight: 600,
                  borderBottom: '1px solid var(--cr-border)',
                  width: (col as any).width,
                }}
              >
                {(col as any).title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {repos.map((repo) => (
            <tr
              key={repo.projectId}
              style={{ borderBottom: '1px solid var(--cr-divider)' }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(59,107,255,0.04)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = '';
              }}
            >
              {tableColumns.map((col) => {
                const dataIndex = (col as any).dataIndex;
                const value = dataIndex ? (repo as any)[dataIndex] : undefined;
                const render = (col as any).render;
                return (
                  <td key={col.key} style={{ padding: '10px 16px', verticalAlign: 'middle' }}>
                    {render ? render(value, repo) : String(value ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );

  return (
    <div>
      <div
        className="cr-page-header"
        style={{
          marginBottom: 20,
          padding: '24px 28px',
          background:
            'linear-gradient(135deg, rgba(59,107,255,0.08) 0%, rgba(14,165,164,0.05) 50%, rgba(255,255,255,0.9) 100%)',
          borderRadius: 16,
          border: '1px solid var(--cr-border)',
          boxShadow: 'var(--cr-shadow-sm)',
        }}
      >
        <div>
          <h1 className="cr-page-title" style={{ margin: 0, fontSize: 26 }}>
            <span style={{ marginRight: 8 }}>📦</span>
            代码仓库管理
          </h1>
          <p className="cr-page-subtitle" style={{ marginTop: 6 }}>
            管理本地克隆的 CodeHub 仓库，支持拉取更新、切换分支与批量同步
          </p>
        </div>
        <Space size={10}>
          <Button
            icon={<SyncOutlined spin={syncing} />}
            onClick={batchSync}
            loading={syncing}
            disabled={repos.length === 0}
          >
            批量同步
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCloneModalVisible(true)}
          >
            克隆仓库
          </Button>
        </Space>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : repos.length === 0 ? (
        <Card style={{ borderRadius: 14 }} bodyStyle={{ padding: 0 }}>
          <EmptyRepos onClone={() => setCloneModalVisible(true)} />
        </Card>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--cr-ink-1)' }}>
                我的仓库
              </span>
              <Tag color="blue">{repos.length} 个仓库</Tag>
            </div>
            <Segmented
              value={viewMode}
              onChange={(val) => setViewMode(val as 'grid' | 'list')}
              options={[
                { label: '卡片网格', value: 'grid' },
                { label: '列表视图', value: 'list' },
              ]}
            />
          </div>

          {viewMode === 'grid' ? (
            <Row gutter={[16, 16]}>
              {repos.map((repo) => (
                <Col xs={24} sm={12} md={8} xl={6} key={repo.projectId}>
                  <RepoCard
                    repo={repo}
                    isExpanded={expandedRepo === repo.projectId}
                    onToggle={() =>
                      setExpandedRepo((prev) => (prev === repo.projectId ? null : repo.projectId))
                    }
                    onFetch={(id) => fetchMutation.mutate(id)}
                    onPull={(id) => pullMutation.mutate(id)}
                    onCheckout={openCheckout}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    onOpenMRs={openMRs}
                    onViewReports={() => navigate('/reports')}
                    isFetching={fetchMutation.isPending && fetchMutation.variables === repo.projectId}
                    isPulling={pullMutation.isPending && pullMutation.variables === repo.projectId}
                    isDeleting={deleteMutation.isPending && deleteMutation.variables === repo.projectId}
                  />
                </Col>
              ))}
            </Row>
          ) : (
            renderListTable()
          )}
        </>
      )}

      <CloneRepoModal
        open={cloneModalVisible}
        onOk={handleClone}
        onCancel={() => setCloneModalVisible(false)}
        confirmLoading={cloneMutation.isPending}
        form={cloneForm}
        projectOptions={projectOptions}
        branchOptions={branchOptions}
        cloneProjectId={cloneProjectId}
        onValuesChange={() => {}}
      />

      <CheckoutModal
        open={checkoutModalVisible}
        onOk={handleCheckout}
        onCancel={() => setCheckoutModalVisible(false)}
        confirmLoading={checkoutMutation.isPending}
        form={checkoutForm}
      />
    </div>
  );
}

export default Repos;