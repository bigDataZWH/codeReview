import { useState, useEffect } from 'react';
import {
  Table,
  Tag,
  Input,
  Select,
  Space,
  Card,
  Button,
  Tooltip,
  Avatar,
  Spin,
  Alert,
  Empty,
  message,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  MergeOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  codehubApi,
  type CodeHubMR,
  type SyncStatus,
  type SyncResult,
} from '@/api/codehub';
import { useAppStore } from '@/store/app';

// 状态 → Tag 配色：open=蓝 / merged=绿 / closed=红 / locked=灰
const stateColorMap: Record<string, string> = {
  open: 'blue',
  merged: 'green',
  closed: 'red',
  locked: 'default',
};

const stateIconMap: Record<string, React.ReactNode> = {
  open: <PlayCircleOutlined style={{ color: '#1677ff' }} />,
  merged: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  closed: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
  locked: <MergeOutlined style={{ color: '#8c8c8c' }} />,
};

function MRList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'open' | 'closed' | 'merged' | 'all'>('open');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 多仓筛选：直接复用 store.activeRepoId（null 表示"全部仓库"）
  const activeRepoId = useAppStore((s) => s.activeRepoId);
  const reposConfig = useAppStore((s) => s.reposConfig);
  const setActiveRepoId = useAppStore((s) => s.setActiveRepoId);
  const loadReposConfig = useAppStore((s) => s.loadReposConfig);

  // 同步按钮 loading 态
  const [syncing, setSyncing] = useState(false);
  // 用于下次同步倒计时每秒刷新
  const [now, setNow] = useState(() => Date.now());

  // 挂载时拉取多仓配置（若 store 中尚无数据）
  useEffect(() => {
    if (reposConfig.length === 0) {
      loadReposConfig();
    }
  }, [reposConfig.length, loadReposConfig]);

  // 每秒刷新"现在"以驱动倒计时
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mrs', state, page, pageSize, searchText, activeRepoId],
    queryFn: () =>
      codehubApi.getMRList(
        {
          state,
          page,
          per_page: pageSize,
          search: searchText || undefined,
          order_by: 'updated_at',
          sort: 'desc',
        },
        activeRepoId ?? undefined,
      ) as Promise<{
        ok: boolean;
        mrs: CodeHubMR[];
        total: number;
        page: number;
        perPage: number;
        totalPages: number;
      }>,
    retry: false,
  });

  // 同步状态：挂载即取，每 30s 轮询一次
  const { data: syncStatus, refetch: refetchSyncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => codehubApi.getSyncStatus() as Promise<SyncStatus>,
    refetchInterval: 30000,
    retry: false,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['mrs'] });
    refetch();
  };

  // 触发一次手动同步
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = (await codehubApi.triggerSync()) as SyncResult;
      message.success(`同步完成，共同步 ${res.mrCount} 个 MR`);
      // 同步成功后刷新 MR 列表与同步状态
      queryClient.invalidateQueries({ queryKey: ['mrs'] });
      refetchSyncStatus();
      refetch();
    } catch (err) {
      message.error(`同步失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSyncing(false);
    }
  };

  if (error) {
    return (
      <Alert
        type="warning"
        message="无法加载 MR 列表"
        description={
          <div>
            <p>请检查 CodeHub 配置是否正确。</p>
            <p>错误信息：{error instanceof Error ? error.message : '未知错误'}</p>
          </div>
        }
        showIcon
      />
    );
  }

  const columns = [
    {
      title: 'ID',
      dataIndex: 'iid',
      key: 'iid',
      width: 80,
      render: (iid: number) => <span style={{ color: '#999' }}>!{iid}</span>,
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: CodeHubMR) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <a
            onClick={() => navigate(`/mrs/${record.iid}`)}
            style={{ fontWeight: 500 }}
          >
            {title}
          </a>
          <Space size={8} style={{ fontSize: 12, color: '#999' }}>
            <span>
              {record.source_branch} → {record.target_branch}
            </span>
          </Space>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 100,
      render: (s: string) => (
        <Tag color={stateColorMap[s] || 'default'}>
          {stateIconMap[s]} {s}
        </Tag>
      ),
    },
    {
      // 检视状态列（简化方案）：基于 MR 状态与评论数衍生
      //   - 有评论 (user_notes_count>0) 或已合并 → "已检视"（绿）
      //   - 否则 → "未检视"（灰）
      // 精确状态待后续接入 findings 后再细化。
      title: '检视状态',
      key: 'reviewState',
      width: 100,
      render: (_: unknown, record: CodeHubMR) => {
        const reviewed =
          (record.user_notes_count ?? 0) > 0 || record.state === 'merged';
        return reviewed ? (
          <Tag color="green">已检视</Tag>
        ) : (
          <Tag color="default">未检视</Tag>
        );
      },
    },
    {
      title: '作者',
      dataIndex: 'author',
      key: 'author',
      width: 140,
      render: (author: CodeHubMR['author']) => (
        <Space>
          <Avatar size={24} style={{ backgroundColor: '#1677ff' }}>
            {author?.name?.[0] || author?.username?.[0] || '?'}
          </Avatar>
          <span>{author?.name || author?.username || 'Unknown'}</span>
        </Space>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 160,
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
      sorter: (a: CodeHubMR, b: CodeHubMR) =>
        dayjs(a.updated_at).valueOf() - dayjs(b.updated_at).valueOf(),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: CodeHubMR) => (
        <Space>
          <Button type="link" size="small" onClick={() => navigate(`/mrs/${record.iid}`)}>
            查看
          </Button>
          <Button
            type="primary"
            size="small"
            onClick={() => navigate(`/mrs/${record.iid}`)}
          >
            检视
          </Button>
        </Space>
      ),
    },
  ];

  // 计算下次同步倒计时（秒）
  const nextSyncSeconds =
    syncStatus?.nextSyncAt && !syncStatus.paused
      ? Math.max(0, Math.floor((dayjs(syncStatus.nextSyncAt).valueOf() - now) / 1000))
      : null;

  return (
    <Card
      title={
        <Space>
          <MergeOutlined />
          <span>合并请求</span>
        </Space>
      }
      extra={
        <Space>
          <Input
            placeholder="搜索 MR..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setPage(1);
            }}
            style={{ width: 240 }}
            allowClear
          />
          <Select
            value={state}
            onChange={(v) => {
              setState(v);
              setPage(1);
            }}
            style={{ width: 120 }}
            options={[
              { value: 'open', label: '打开的' },
              { value: 'merged', label: '已合并' },
              { value: 'closed', label: '已关闭' },
              { value: 'all', label: '全部' },
            ]}
          />
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} />
          </Tooltip>
        </Space>
      }
    >
      {/* 顶部工具栏：同步按钮 + 同步状态徽标 + 仓库筛选 */}
      <Space
        wrap
        style={{ marginBottom: 16, width: '100%' }}
        size={[12, 8]}
      >
        <Button
          type="primary"
          icon={<SyncOutlined />}
          loading={syncing}
          onClick={handleSync}
        >
          同步 MR
        </Button>

        {syncStatus && (
          <Space size={8} align="center">
            <Tag color={syncStatus.running ? 'processing' : 'default'}>
              {syncStatus.running ? '同步中' : '空闲'}
            </Tag>
            {syncStatus.paused && <Tag color="orange">已暂停</Tag>}
            {syncStatus.lastSyncAt && (
              <span style={{ color: '#888', fontSize: 12 }}>
                最后同步：{dayjs(syncStatus.lastSyncAt).format('YYYY-MM-DD HH:mm')}
              </span>
            )}
            {nextSyncSeconds !== null && (
              <span style={{ color: '#888', fontSize: 12 }}>
                下次同步：{nextSyncSeconds}s 后
              </span>
            )}
          </Space>
        )}

        <Select
          value={activeRepoId ?? ''}
          onChange={(v) => {
            setActiveRepoId(v || null);
            setPage(1);
          }}
          style={{ width: 200 }}
          placeholder="选择仓库"
          options={[
            { value: '', label: '全部仓库' },
            ...reposConfig.map((r) => ({ value: r.repoId, label: r.name })),
          ]}
        />
      </Space>

      <Spin spinning={isLoading}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.mrs ?? []}
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          size="middle"
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={'暂无 MR，点击上方「同步 MR」按钮拉取'}
                style={{ padding: 32 }}
              />
            ),
          }}
        />
      </Spin>
    </Card>
  );
}

export default MRList;
