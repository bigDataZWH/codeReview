import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
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
  Checkbox,
  Progress,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  MergeOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  ExportOutlined,
  ThunderboltOutlined,
  BugOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  codehubApi,
  type CodeHubMR,
  type SyncStatus,
  type SyncResult,
} from '@/api/codehub';
import { useAppStore } from '@/store/app';

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

type ReviewStatus = 'unreviewed' | 'reviewing' | 'reviewed';

type TimeRange = 'today' | 'week' | 'month' | 'all';

const severityColors: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#2563eb',
  info: '#0f766e',
};

const severityBgColors: Record<string, string> = {
  critical: '#fee2e2',
  high: '#ffedd5',
  medium: '#fef3c7',
  low: '#dbeafe',
  info: '#ccfbf1',
};

function MRList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'open' | 'closed' | 'merged' | 'all'>('open');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [reviewStatusFilter, setReviewStatusFilter] = useState<'all' | 'unreviewed' | 'reviewing' | 'reviewed'>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const activeRepoId = useAppStore((s) => s.activeRepoId);
  const reposConfig = useAppStore((s) => s.reposConfig);
  const setActiveRepoId = useAppStore((s) => s.setActiveRepoId);
  const loadReposConfig = useAppStore((s) => s.loadReposConfig);

  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [reviewInProgress, setReviewInProgress] = useState<Set<number>>(new Set());
  const pollTimersRef = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    if (reposConfig.length === 0) {
      loadReposConfig();
    }
  }, [reposConfig.length, loadReposConfig]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      pollTimersRef.current.forEach((timer) => clearInterval(timer));
      pollTimersRef.current.clear();
    };
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

  const { data: syncStatus, refetch: refetchSyncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => codehubApi.getSyncStatus() as Promise<SyncStatus>,
    refetchInterval: 30000,
    retry: false,
  });

  const mrIids = useMemo(() => {
    if (!data?.mrs) return [];
    return data.mrs.map((mr) => mr.iid);
  }, [data]);

  const { data: findingsMap } = useQuery({
    queryKey: ['mr-findings-batch', mrIids.join(','), activeRepoId],
    queryFn: async () => {
      const results = await Promise.all(
        mrIids.map(async (iid) => {
          try {
            const res = (await codehubApi.getMRFindings(
              iid,
              activeRepoId ?? undefined,
            )) as { ok: boolean; findings: Array<{ severity: string }>; count: number };
            const severityCounts: Record<string, number> = {};
            if (res.findings) {
              for (const f of res.findings) {
                const sev = f.severity || 'info';
                severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
              }
            }
            return [iid, { count: res.count, severityCounts }] as const;
          } catch {
            return [iid, { count: 0, severityCounts: {} }] as const;
          }
        }),
      );
      return new Map<number, { count: number; severityCounts: Record<string, number> }>(results);
    },
    enabled: mrIids.length > 0,
    retry: false,
  });

  const stopPolling = useCallback((mrIid: number) => {
    const timer = pollTimersRef.current.get(mrIid);
    if (timer) {
      clearInterval(timer);
      pollTimersRef.current.delete(mrIid);
    }
  }, []);

  const startPolling = useCallback(
    (mrIid: number) => {
      stopPolling(mrIid);

      const maxAttempts = 20;
      let attempts = 0;

      const timer = setInterval(async () => {
        attempts++;
        try {
          const res = (await codehubApi.getMRFindings(
            mrIid,
            activeRepoId ?? undefined,
          )) as { ok: boolean; findings: unknown[]; count: number };
          if (res.count > 0) {
            stopPolling(mrIid);
            setReviewInProgress((prev) => {
              const next = new Set(prev);
              next.delete(mrIid);
              return next;
            });
            queryClient.invalidateQueries({ queryKey: ['mr-findings-batch'] });
            queryClient.invalidateQueries({ queryKey: ['mrs'] });
          } else if (attempts >= maxAttempts) {
            stopPolling(mrIid);
            setReviewInProgress((prev) => {
              const next = new Set(prev);
              next.delete(mrIid);
              return next;
            });
            message.warning('检视超时，未检测到 findings');
          }
        } catch {
          if (attempts >= maxAttempts) {
            stopPolling(mrIid);
            setReviewInProgress((prev) => {
              const next = new Set(prev);
              next.delete(mrIid);
              return next;
            });
          }
        }
      }, 3000);

      pollTimersRef.current.set(mrIid, timer);
    },
    [activeRepoId, queryClient, stopPolling],
  );

  const reviewMutation = useMutation({
    mutationFn: (mrIid: number) =>
      codehubApi.runMRReview(mrIid, activeRepoId ?? undefined),
    onMutate: (mrIid) => {
      setReviewInProgress((prev) => new Set(prev).add(mrIid));
    },
    onSuccess: (res, mrIid) => {
      if (res.ok) {
        message.success('检视已触发');
        startPolling(mrIid);
      } else {
        message.error(res.error || '检视失败');
        setReviewInProgress((prev) => {
          const next = new Set(prev);
          next.delete(mrIid);
          return next;
        });
      }
    },
    onError: (err, mrIid) => {
      message.error(
        `检视失败：${err instanceof Error ? err.message : '未知错误'}`,
      );
      setReviewInProgress((prev) => {
        const next = new Set(prev);
        next.delete(mrIid);
        return next;
      });
    },
  });

  const getReviewStatus = useCallback(
    (mr: CodeHubMR): ReviewStatus => {
      if (reviewInProgress.has(mr.iid)) return 'reviewing';
      const count = findingsMap?.get(mr.iid)?.count ?? 0;
      if (count > 0) return 'reviewed';
      return 'unreviewed';
    },
    [reviewInProgress, findingsMap],
  );

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['mrs'] });
    queryClient.invalidateQueries({ queryKey: ['mr-findings-batch'] });
    refetch();
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = (await codehubApi.triggerSync()) as SyncResult;
      message.success(`同步完成，共同步 ${res.mrCount} 个 MR`);
      queryClient.invalidateQueries({ queryKey: ['mrs'] });
      queryClient.invalidateQueries({ queryKey: ['mr-findings-batch'] });
      refetchSyncStatus();
      refetch();
    } catch (err) {
      message.error(`同步失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSyncing(false);
    }
  };

  const filteredMRs = useMemo(() => {
    let mrs = data?.mrs ?? [];

    if (reviewStatusFilter !== 'all') {
      mrs = mrs.filter((mr) => getReviewStatus(mr) === reviewStatusFilter);
    }

    if (timeRange !== 'all') {
      const now = dayjs();
      mrs = mrs.filter((mr) => {
        const updated = dayjs(mr.updated_at);
        if (timeRange === 'today') {
          return updated.isSame(now, 'day');
        }
        if (timeRange === 'week') {
          return updated.isAfter(now.subtract(7, 'day'));
        }
        if (timeRange === 'month') {
          return updated.isAfter(now.subtract(30, 'day'));
        }
        return true;
      });
    }

    return mrs;
  }, [data, reviewStatusFilter, timeRange, getReviewStatus]);

  const allVisibleIds = useMemo(() => filteredMRs.map((mr) => mr.iid), [filteredMRs]);

  const handleSelectAll = () => {
    if (selectedIds.size === allVisibleIds.length && allVisibleIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisibleIds));
    }
  };

  const handleSelectOne = (iid: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(iid)) {
        next.delete(iid);
      } else {
        next.add(iid);
      }
      return next;
    });
  };

  const handleBatchReview = () => {
    if (selectedIds.size === 0) {
      message.warning('请先选择要检视的 MR');
      return;
    }
    message.success(`已触发 ${selectedIds.size} 个 MR 的检视`);
    selectedIds.forEach((iid) => {
      if (!reviewInProgress.has(iid)) {
        reviewMutation.mutate(iid);
      }
    });
    setSelectedIds(new Set());
  };

  const handleBatchExport = () => {
    if (selectedIds.size === 0) {
      message.warning('请先选择要导出的 MR');
      return;
    }
    message.success(`已生成 ${selectedIds.size} 个 MR 的导出报告`);
    setSelectedIds(new Set());
  };

  const nextSyncSeconds =
    syncStatus?.nextSyncAt && !syncStatus.paused
      ? Math.max(
          0,
          Math.floor(
            (dayjs(syncStatus.nextSyncAt).valueOf() - now) / 1000,
          ),
        )
      : null;

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

  const totalMRs = data?.total ?? 0;
  const reviewedCount = filteredMRs.filter((mr) => getReviewStatus(mr) === 'reviewed').length;
  const reviewingCount = filteredMRs.filter((mr) => getReviewStatus(mr) === 'reviewing').length;
  const unreviewedCount = filteredMRs.filter((mr) => getReviewStatus(mr) === 'unreviewed').length;

  return (
    <div>
      <div
        className="cr-page-header"
        style={{
          marginBottom: 16,
          padding: '16px 24px',
          background: 'linear-gradient(135deg, #f0f5ff 0%, #fafafa 100%)',
          borderRadius: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h1 className="cr-page-title" style={{ margin: 0 }}>代码检视</h1>
          <p
            className="cr-page-subtitle"
            style={{ fontSize: 12, color: '#8c8c8c', margin: '4px 0 0 0' }}
          >
            浏览、触发代码检视与查看检视意见
          </p>
        </div>
        <Space>
          {syncStatus && (
            <Tag
              color={syncStatus.running ? 'processing' : 'default'}
              style={{
                padding: '6px 12px',
                fontWeight: 600,
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              <SyncOutlined spin={syncStatus.running} />{' '}
              {syncStatus.running ? '同步中' : '空闲'}
            </Tag>
          )}
        </Space>
      </div>

      <Card
        style={{
          borderRadius: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          transition: 'boxShadow 0.3s ease',
        }}
        title={
          <Space>
            <MergeOutlined style={{ color: '#3b6bff' }} />
            <span style={{ fontWeight: 600 }}>MR 列表</span>
            <Tag color="blue" style={{ borderRadius: 999 }}>
              共 {totalMRs} 个
            </Tag>
          </Space>
        }
        extra={
          <Space size={8}>
            <Input
              placeholder="搜索 MR 标题或描述..."
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setPage(1);
              }}
              style={{ width: 260 }}
              allowClear
            />
            <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
              刷新
            </Button>
          </Space>
        }
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 16,
            alignItems: 'center',
            padding: 12,
            background: 'linear-gradient(180deg, #fafbff, #f6f8fc)',
            borderRadius: 10,
            border: '1px solid #eef2f9',
          }}
        >
          <Space size={8}>
            <Tag color="blue" style={{ borderRadius: 6, padding: '4px 10px' }}>
              <MergeOutlined /> 同步状态
            </Tag>
            <Button
              type="primary"
              size="small"
              icon={<SyncOutlined />}
              loading={syncing}
              onClick={handleSync}
            >
              同步 MR
            </Button>
            {syncStatus && (
              <Space size={8} align="center">
                <Tag color={syncStatus.running ? 'processing' : 'default'} style={{ padding: '4px 10px', fontSize: 12 }}>
                  {syncStatus.running ? '同步中' : '空闲'}
                </Tag>
                {syncStatus.paused && <Tag color="orange" style={{ padding: '4px 10px', fontSize: 12 }}>已暂停</Tag>}
                {syncStatus.lastSyncAt && (
                  <span style={{ color: '#888', fontSize: 12 }}>
                    最后同步：{dayjs(syncStatus.lastSyncAt).format('YYYY-MM-DD HH:mm')}
                  </span>
                )}
                {nextSyncSeconds !== null && !syncStatus.paused && (
                  <span style={{ color: '#888', fontSize: 12 }}>
                    下次同步：{nextSyncSeconds}s
                  </span>
                )}
              </Space>
            )}
          </Space>

          <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />

          <Space size={8}>
            <Select
              value={state}
              onChange={(v) => {
                setState(v);
                setPage(1);
              }}
              style={{ width: 130 }}
              options={[
                { value: 'open', label: '打开的' },
                { value: 'merged', label: '已合并' },
                { value: 'closed', label: '已关闭' },
                { value: 'all', label: '全部' },
              ]}
            />
            <Select
              value={reviewStatusFilter}
              onChange={(v) => setReviewStatusFilter(v)}
              style={{ width: 150 }}
              placeholder="检视状态"
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'unreviewed', label: '待检视' },
                { value: 'reviewing', label: '检视中' },
                { value: 'reviewed', label: '已完成' },
              ]}
            />
            <Select
              value={timeRange}
              onChange={(v) => setTimeRange(v)}
              style={{ width: 140 }}
              placeholder="时间范围"
              options={[
                { value: 'all', label: '全部时间' },
                { value: 'today', label: '今日' },
                { value: 'week', label: '本周' },
                { value: 'month', label: '本月' },
              ]}
            />
          </Space>

          <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />

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
              ...reposConfig.map((r) => ({
                value: r.repoId,
                label: r.name,
              })),
            ]}
          />

          <div style={{ flex: 1 }} />

          <Space size={8}>
            {selectedIds.size > 0 && (
              <Space>
                <span style={{ fontSize: 13, color: '#3b6bff', fontWeight: 500 }}>
                  已选 {selectedIds.size} 项
                </span>
                <Button
                  size="small"
                  icon={<ThunderboltOutlined />}
                  onClick={handleBatchReview}
                  style={{ borderRadius: 8 }}
                >
                  批量检视
                </Button>
                <Button
                  size="small"
                  icon={<ExportOutlined />}
                  onClick={handleBatchExport}
                  style={{ borderRadius: 8 }}
                >
                  导出报告
                </Button>
                <Button
                  size="small"
                  onClick={() => setSelectedIds(new Set())}
                  style={{ borderRadius: 8 }}
                >
                  取消选择
                </Button>
              </Space>
            )}
          </Space>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 12,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          <div
            className="cr-metric-card"
            style={{
              flex: '1 1 150px',
              minWidth: 150,
              background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
              border: '1px solid #bfdbfe',
              borderRadius: 10,
              padding: '12px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: '#3b6bff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <ClockCircleOutlined />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>待检视</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#1e3fb8' }}>{unreviewedCount}</div>
              </div>
            </div>
          </div>
          <div
            className="cr-metric-card"
            style={{
              flex: '1 1 150px',
              minWidth: 150,
              background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
              border: '1px solid #fcd34d',
              borderRadius: 10,
              padding: '12px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <SyncOutlined spin />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>检视中</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#c2410c' }}>{reviewingCount}</div>
              </div>
            </div>
          </div>
          <div
            className="cr-metric-card"
            style={{
              flex: '1 1 150px',
              minWidth: 150,
              background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
              border: '1px solid #6ee7b7',
              borderRadius: 10,
              padding: '12px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <CheckCircleOutlined />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>已完成</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#047857' }}>{reviewedCount}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Checkbox
            checked={allVisibleIds.length > 0 && selectedIds.size === allVisibleIds.length}
            indeterminate={selectedIds.size > 0 && selectedIds.size < allVisibleIds.length}
            onChange={handleSelectAll}
          >
            全选 ({allVisibleIds.length})
          </Checkbox>
          <span style={{ fontSize: 13, color: '#8c8c8c' }}>
            已选 {selectedIds.size} / {allVisibleIds.length}
          </span>
        </div>

        <Spin spinning={isLoading}>
          {filteredMRs.length === 0 ? (
            <div style={{ padding: '48px 0' }}>
              <Empty
                image={
                  <div
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #eef2ff 0%, #f0f9ff 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 16px',
                      boxShadow: '0 8px 32px rgba(59, 107, 255, 0.15)',
                    }}
                  >
                    <MergeOutlined style={{ fontSize: 56, color: '#3b6bff' }} />
                  </div>
                }
                description={
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: 16, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
                      {searchText || state !== 'open' || reviewStatusFilter !== 'all' || timeRange !== 'all'
                        ? '没有找到符合条件的 MR'
                        : '暂无 MR 数据'}
                    </p>
                    <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
                      {searchText || state !== 'open' || reviewStatusFilter !== 'all' || timeRange !== 'all'
                        ? '尝试调整筛选条件或搜索关键词'
                        : '点击「同步 MR」按钮从 CodeHub 拉取数据'}
                    </p>
                    {(!searchText && state === 'open' && reviewStatusFilter === 'all' && timeRange === 'all') && (
                      <Button type="primary" icon={<SyncOutlined />} onClick={handleSync}>
                        立即同步
                      </Button>
                    )}
                  </div>
                }
                style={{ padding: 32 }}
              />
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 12,
              }}
            >
              {filteredMRs.map((mr) => {
                const status = getReviewStatus(mr);
                const isSelected = selectedIds.has(mr.iid);
                const findingInfo = findingsMap?.get(mr.iid) || { count: 0, severityCounts: {} };
                const isReviewing = status === 'reviewing';
                const isReviewed = status === 'reviewed';

                return (
                  <div
                    key={mr.id}
                    onClick={() => navigate(`/mrs/${mr.iid}`)}
                    style={{
                      background: '#fff',
                      border: `1px solid ${isSelected ? '#3b6bff' : '#e2e8f0'}`,
                      borderRadius: 12,
                      padding: 16,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: isSelected
                        ? '0 0 0 3px rgba(59, 107, 255, 0.15), 0 1px 4px rgba(0,0,0,0.06)'
                        : '0 1px 3px rgba(0,0,0,0.04)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.boxShadow = isSelected
                        ? '0 0 0 3px rgba(59, 107, 255, 0.15), 0 4px 16px rgba(0,0,0,0.08)'
                        : '0 4px 16px rgba(0,0,0,0.08)';
                      (e.currentTarget as HTMLElement).style.borderColor = isSelected ? '#3b6bff' : '#cbd5e1';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.boxShadow = isSelected
                        ? '0 0 0 3px rgba(59, 107, 255, 0.15), 0 1px 4px rgba(0,0,0,0.06)'
                        : '0 1px 3px rgba(0,0,0,0.04)';
                      (e.currentTarget as HTMLElement).style.borderColor = isSelected ? '#3b6bff' : '#e2e8f0';
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          minWidth: 40,
                          paddingTop: 4,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          onChange={() => handleSelectOne(mr.iid)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ marginBottom: 8 }}
                        />
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#64748b',
                            background: '#f1f5f9',
                            borderRadius: 6,
                            padding: '2px 6px',
                            marginBottom: 8,
                          }}
                        >
                          !{mr.iid}
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                            <span
                              style={{
                                fontWeight: 600,
                                fontSize: 14,
                                color: '#0f172a',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={mr.title}
                            >
                              {mr.title}
                            </span>
                            <Tag
                              color={stateColorMap[mr.state] || 'default'}
                              style={{ flexShrink: 0, borderRadius: 999, fontSize: 11, padding: '2px 8px' }}
                            >
                              {stateIconMap[mr.state]} {mr.state}
                            </Tag>
                          </div>
                        </div>

                        {mr.description && (
                          <p
                            style={{
                              margin: '0 0 8px 0',
                              fontSize: 12,
                              color: '#64748b',
                              lineHeight: 1.5,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            }}
                            title={mr.description}
                          >
                            {mr.description}
                          </p>
                        )}

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 12,
                            fontSize: 12,
                            color: '#64748b',
                          }}
                        >
                          <Space size={4}>
                            <MergeOutlined style={{ color: '#94a3b8' }} />
                            <span style={{ color: '#3b6bff', fontFamily: 'monospace', fontSize: 11 }}>
                              {mr.source_branch}
                            </span>
                            <ArrowRightShort />
                            <span style={{ color: '#059669', fontFamily: 'monospace', fontSize: 11 }}>
                              {mr.target_branch}
                            </span>
                          </Space>

                          <Space size={4}>
                            <Avatar size={20} style={{ backgroundColor: '#3b6bff', fontSize: 11 }}>
                              {mr.author?.name?.[0] || mr.author?.username?.[0] || '?'}
                            </Avatar>
                            <span>{mr.author?.name || mr.author?.username || 'Unknown'}</span>
                          </Space>

                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <ClockCircleOutlined style={{ fontSize: 11 }} />
                            {dayjs(mr.updated_at).format('YYYY-MM-DD HH:mm')}
                          </span>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 16,
                            marginTop: 10,
                            paddingTop: 10,
                            borderTop: '1px dashed #e2e8f0',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              gap: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
                              const count = findingInfo.severityCounts[sev] || 0;
                              if (count === 0) return null;
                              return (
                                <Tag
                                  key={sev}
                                  style={{
                                    background: severityBgColors[sev],
                                    color: severityColors[sev],
                                    border: 'none',
                                    borderRadius: 6,
                                    fontSize: 11,
                                    padding: '2px 8px',
                                    fontWeight: 600,
                                  }}
                                >
                                  {sev.toUpperCase()}: {count}
                                </Tag>
                              );
                            })}
                            {findingInfo.count === 0 && (
                              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                                暂无检视意见
                              </span>
                            )}
                          </div>

                          <div style={{ flex: 1 }} />

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {status === 'reviewing' && (
                              <Tag
                                color="processing"
                                icon={<SyncOutlined spin />}
                                style={{ borderRadius: 999, fontSize: 12 }}
                              >
                                检视中
                              </Tag>
                            )}
                            {status === 'reviewed' && (
                              <Tag
                                color="success"
                                style={{ borderRadius: 999, fontSize: 12, background: '#ecfdf5', color: '#059669', border: 'none' }}
                              >
                                <CheckCircleOutlined /> 已检视
                              </Tag>
                            )}
                            {status === 'unreviewed' && (
                              <Tag
                                style={{
                                  borderRadius: 999,
                                  fontSize: 12,
                                  background: '#fef3c7',
                                  color: '#ca8a04',
                                  border: 'none',
                                  fontWeight: 600,
                                }}
                              >
                                <ExclamationCircleOutlined /> 待检视
                              </Tag>
                            )}

                            <div onClick={(e) => e.stopPropagation()}>
                              {isReviewing ? (
                                <Tooltip title="检视进行中">
                                  <Button
                                    size="small"
                                    loading
                                    disabled
                                    style={{ borderRadius: 8 }}
                                  >
                                    检视中...
                                  </Button>
                                </Tooltip>
                              ) : (
                                <Button
                                  size="small"
                                  type={isReviewed ? 'default' : 'primary'}
                                  onClick={() => {
                                    if (!reviewInProgress.has(mr.iid)) {
                                      reviewMutation.mutate(mr.iid);
                                    }
                                  }}
                                  style={{ borderRadius: 8 }}
                                >
                                  {isReviewed ? '重新检视' : '检视'}
                                </Button>
                              )}
                              <Button
                                size="small"
                                type="link"
                                disabled={!isReviewed || isReviewing}
                                onClick={() => navigate(`/mrs/${mr.iid}`)}
                              >
                                查看报告
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {findingInfo.count > 0 && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: '8px 12px',
                          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <BugOutlined style={{ color: '#ea580c' }} />
                        <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>
                          共 {findingInfo.count} 条检视意见
                        </span>
                        <div style={{ flex: 1, minWidth: 100 }}>
                          <Progress
                            percent={Math.min(100, findingInfo.count * 10)}
                            showInfo={false}
                            size="small"
                            strokeColor={{
                              '0%': '#2563eb',
                              '50%': '#ca8a04',
                              '100%': '#dc2626',
                            }}
                            style={{ margin: 0 }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
                            const count = findingInfo.severityCounts[sev] || 0;
                            if (count === 0) return null;
                            return (
                              <Tooltip key={sev} title={`${sev.toUpperCase()}: ${count}`}>
                                <div
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    background: severityColors[sev],
                                    cursor: 'help',
                                  }}
                                />
                              </Tooltip>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Spin>

        {filteredMRs.length > 0 && (
          <div
            style={{
              marginTop: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              background: '#f8fafc',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
            }}
          >
            <span style={{ fontSize: 13, color: '#64748b' }}>
              共 {data?.total ?? 0} 条数据，当前显示 {filteredMRs.length} 条
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                size="small"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span style={{ fontSize: 13, color: '#3b6bff', fontWeight: 600 }}>
                {page} / {data?.totalPages || 1}
              </span>
              <Button
                size="small"
                disabled={page >= (data?.totalPages || 1)}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
              <Select
                value={pageSize}
                onChange={(v) => {
                  setPageSize(v);
                  setPage(1);
                }}
                style={{ width: 100 }}
                options={[
                  { value: 10, label: '10条/页' },
                  { value: 20, label: '20条/页' },
                  { value: 50, label: '50条/页' },
                ]}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function ArrowRightShort() {
  return <span style={{ color: '#94a3b8', margin: '0 2px' }}>→</span>;
}

export default MRList;