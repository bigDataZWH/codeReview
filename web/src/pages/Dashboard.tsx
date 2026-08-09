import { useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Spin,
  Alert,
  Space,
  Tag,
  Button,
  Progress,
  List,
  Empty,
  Divider,
} from 'antd';
import {
  MergeOutlined,
  CheckCircleOutlined,
  BugOutlined,
  StopOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  FileTextOutlined,
  SettingOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
  SafetyOutlined,
  ClockCircleOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  codehubApi,
  type DashboardStats,
  type ReportsOverview,
  type EnvironmentHealth,
  type CodeHubMR,
  type SyncStatus,
} from '@/api/codehub';
import { useAppStore } from '@/store/app';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return { text: '夜深了，注意休息', emoji: '🌙' };
  if (h < 9) return { text: '早上好，新的一天开始了', emoji: '☀️' };
  if (h < 12) return { text: '上午好，开启代码检视工作', emoji: '🚀' };
  if (h < 14) return { text: '中午好，适当休息一下', emoji: '🍱' };
  if (h < 18) return { text: '下午好，继续加油', emoji: '💪' };
  if (h < 22) return { text: '晚上好，辛苦了', emoji: '🌆' };
  return { text: '夜深了，注意休息', emoji: '🌙' };
}

function Dashboard() {
  const navigate = useNavigate();
  const activeRepoId = useAppStore((s) => s.activeRepoId);
  const reposConfig = useAppStore((s) => s.reposConfig);

  const greeting = getGreeting();
  const todayStr = dayjs().format('YYYY年MM月DD日 dddd');
  const activeRepo = reposConfig.find((r) => r.repoId === activeRepoId);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () =>
      codehubApi.getDashboard() as Promise<{ ok: boolean; dashboard: DashboardStats }>,
    retry: false,
  });

  const { data: reportsData } = useQuery({
    queryKey: ['reports-overview'],
    queryFn: () =>
      codehubApi.getReportsOverview() as Promise<{ ok: boolean; overview: ReportsOverview }>,
    retry: false,
  });

  const { data: healthData } = useQuery({
    queryKey: ['opencode-health'],
    queryFn: () => codehubApi.getOpencodeHealth() as Promise<EnvironmentHealth>,
    retry: false,
  });

  const { data: recentMRs } = useQuery({
    queryKey: ['dashboard-recent-mrs', activeRepoId],
    queryFn: () =>
      codehubApi.getMRList(
        { state: 'all', per_page: 5, order_by: 'updated_at', sort: 'desc' },
        activeRepoId ?? undefined,
      ) as unknown as Promise<{ ok: boolean; mrs: CodeHubMR[]; total: number }>,
    retry: false,
  });

  const { data: syncStatus } = useQuery({
    queryKey: ['dashboard-sync-status'],
    queryFn: () => codehubApi.getSyncStatus() as Promise<SyncStatus>,
    retry: false,
  });

  const { data: serviceStatus } = useQuery({
    queryKey: ['dashboard-service-status'],
    queryFn: () => codehubApi.getServiceStatus() as Promise<Record<string, unknown>>,
    retry: false,
  });

  const { data: opencodeStatus } = useQuery({
    queryKey: ['opencode-serve-status'],
    queryFn: () =>
      codehubApi.getOpencodeServeStatus() as Promise<{
        running: boolean;
        hostname?: string;
        port?: number;
      }>,
    retry: false,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !data?.ok) {
    return (
      <Alert
        type="warning"
        message="无法加载概览数据"
        description={
          <div>
            <p>请先在设置页面配置 CodeHub 连接信息。</p>
            <p>错误信息：{error instanceof Error ? error.message : '未知错误'}</p>
          </div>
        }
        showIcon
      />
    );
  }

  const dashboard = data.dashboard;
  const overview = reportsData?.overview;

  const totalFindings =
    dashboard.findingsBySeverity.critical +
    dashboard.findingsBySeverity.high +
    dashboard.findingsBySeverity.medium +
    dashboard.findingsBySeverity.low +
    dashboard.findingsBySeverity.info;

  const openMRatio = dashboard.totalMRs
    ? Math.round((dashboard.openMRs / dashboard.totalMRs) * 100)
    : 0;
  const mergedMRatio = dashboard.totalMRs
    ? Math.round((dashboard.mergedMRs / dashboard.totalMRs) * 100)
    : 0;
  const criticalRatio = totalFindings
    ? Math.round((dashboard.findingsBySeverity.critical / totalFindings) * 100)
    : 0;
  const interceptRatio = overview?.reviewCount
    ? Math.round((overview.interceptionCount / overview.reviewCount) * 100)
    : 0;

  const trendDir = useMemo(() => {
    if (dashboard.trend.length < 2) return 'up' as const;
    const last = dashboard.trend[dashboard.trend.length - 1];
    const prev = dashboard.trend[dashboard.trend.length - 2];
    return (last.reviews >= prev.reviews ? 'up' : 'down') as 'up' | 'down';
  }, [dashboard.trend]);

  const severityOption = {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(15, 23, 42, 0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#fff', fontSize: 12 },
      padding: [8, 12],
    },
    legend: {
      bottom: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: '#64748b', fontSize: 12 },
    },
    color: ['#dc2626', '#ea580c', '#ca8a04', '#2563eb', '#0f766e'],
    series: [
      {
        type: 'pie',
        radius: ['52%', '78%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 3,
        },
        label: { show: false },
        labelLine: { show: false },
        data: [
          { value: dashboard.findingsBySeverity.critical, name: 'Critical' },
          { value: dashboard.findingsBySeverity.high, name: 'High' },
          { value: dashboard.findingsBySeverity.medium, name: 'Medium' },
          { value: dashboard.findingsBySeverity.low, name: 'Low' },
          { value: dashboard.findingsBySeverity.info, name: 'Info' },
        ],
      },
    ],
  };

  const trendOption = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 23, 42, 0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#fff', fontSize: 12 },
      padding: [8, 12],
    },
    grid: { left: 48, right: 20, top: 24, bottom: 36 },
    xAxis: {
      type: 'category',
      data: dashboard.trend.map((t) => t.date),
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisTick: { show: false },
      axisLabel: { color: '#64748b', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#eef2f9', type: 'dashed' } },
      axisLabel: { color: '#94a3b8', fontSize: 11 },
    },
    series: [
      {
        name: '审查数',
        type: 'line',
        smooth: true,
        data: dashboard.trend.map((t) => t.reviews),
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: '#3b6bff' },
        lineStyle: { width: 2.5, color: '#3b6bff' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(59,107,255,0.28)' },
              { offset: 1, color: 'rgba(59,107,255,0.02)' },
            ],
          },
        },
      },
    ],
  };

  const sevBg: Record<string, { bg: string; color: string }> = {
    critical: { bg: '#fee2e2', color: '#b91c1c' },
    high: { bg: '#ffedd5', color: '#c2410c' },
    medium: { bg: '#fef3c7', color: '#a16207' },
    low: { bg: '#dbeafe', color: '#1d4ed8' },
    info: { bg: '#ccfbf1', color: '#0f766e' },
  };

  const cardMeta = [
    {
      title: '待处理检视',
      value: dashboard.openMRs,
      icon: <MergeOutlined style={{ color: '#3b6bff' }} />,
      valueColor: '#3b6bff',
      accent: '',
      ratio: openMRatio,
      ratioLabel: '占比',
      ratioDir: 'up' as const,
      footer: '等待审查的 MR 数量',
    },
    {
      title: '已完成检视',
      value: dashboard.mergedMRs,
      icon: <CheckCircleOutlined style={{ color: '#10b981' }} />,
      valueColor: '#10b981',
      accent: 'info',
      ratio: mergedMRatio,
      ratioLabel: '占比',
      ratioDir: 'up' as const,
      footer: '已合入主干的 MR 数',
    },
    {
      title: '发现问题总数',
      value: totalFindings,
      icon: <BugOutlined style={{ color: '#ea580c' }} />,
      valueColor: '#ea580c',
      accent: 'high',
      ratio: criticalRatio,
      ratioLabel: 'Critical',
      ratioDir: criticalRatio > 30 ? ('up' as const) : ('down' as const),
      footer: `Critical 占比 ${criticalRatio}%`,
    },
    {
      title: '已修复问题',
      value: overview?.interceptionCount ?? '-',
      icon: <StopOutlined style={{ color: '#7c3aed' }} />,
      valueColor: '#7c3aed',
      accent: 'critical',
      ratio: interceptRatio,
      ratioLabel: '拦截率',
      ratioDir: 'up' as const,
      footer: overview
        ? `阻止合入 ${overview.interceptionCount} 次`
        : '暂无数据',
    },
  ];

  const quickEntries = [
    {
      title: '新建检视',
      desc: '对 MR 发起代码检视',
      icon: <RocketOutlined style={{ fontSize: 24, color: '#3b6bff' }} />,
      color: '#3b6bff',
      onClick: () => navigate('/mrs'),
    },
    {
      title: '查看报告',
      desc: '检视数据与报表',
      icon: <FileTextOutlined style={{ fontSize: 24, color: '#10b981' }} />,
      color: '#10b981',
      onClick: () => navigate('/reports'),
    },
    {
      title: '仓库管理',
      desc: '配置与同步仓库',
      icon: <ApiOutlined style={{ fontSize: 24, color: '#ea580c' }} />,
      color: '#ea580c',
      onClick: () => navigate('/repos'),
    },
    {
      title: '系统设置',
      desc: 'CodeHub 与检视配置',
      icon: <SettingOutlined style={{ fontSize: 24, color: '#7c3aed' }} />,
      color: '#7c3aed',
      onClick: () => navigate('/settings'),
    },
  ];

  const healthOk = healthData?.ok ?? false;
  const opencodeOk = healthData?.opencode.installed ?? false;
  const opencodeVersion = healthData?.opencode.version ?? '-';
  const nodeOk = healthData?.nodejs.supported ?? false;
  const nodeVersion = healthData?.nodejs.version ?? '-';
  const opencodePortAvail = healthData?.ports.opencode?.available ?? false;
  const apiPortAvail = healthData?.ports.api?.available ?? false;
  const webPortAvail = healthData?.ports.web?.available ?? false;

  const opencodeServeRunning = opencodeStatus?.running ?? false;

  const serviceList = serviceStatus
    ? Object.entries(serviceStatus).map(([name, info]) => ({
        name,
        status: typeof info === 'object' && info !== null ? (info as { status?: string }).status : undefined,
      }))
    : [];

  return (
    <div>
      {/* Header */}
      <div
        className="cr-page-header"
        style={{
          marginBottom: 20,
          padding: '20px 24px',
          background:
            'linear-gradient(135deg, rgba(59,107,255,0.06) 0%, rgba(14,165,164,0.04) 50%, rgba(255,255,255,0.8) 100%)',
          borderRadius: 14,
          border: '1px solid var(--cr-border)',
          boxShadow: 'var(--cr-shadow-sm)',
        }}
      >
        <div>
          <h1 className="cr-page-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{greeting.emoji}</span>
            <span>{greeting.text}</span>
          </h1>
          <p className="cr-page-subtitle" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>{todayStr}</span>
            {activeRepo && (
              <>
                <span style={{ color: 'var(--cr-ink-4)' }}>·</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ApiOutlined /> 当前仓库：{activeRepo.name}
                </span>
              </>
            )}
          </p>
        </div>
        <Space size={8}>
          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={() => navigate('/mrs')}
          >
            新建检视
          </Button>
          <Button icon={<FileTextOutlined />} onClick={() => navigate('/reports')}>
            查看报告
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
            设置
          </Button>
        </Space>
      </div>

      {/* Metric Cards */}
      <Row gutter={[16, 16]}>
        {cardMeta.map((m) => (
          <Col xs={24} sm={12} md={6} key={m.title}>
            <Card className="cr-metric-card" style={{ position: 'relative', height: '100%' }}>
              <div className={`cr-metric-accent ${m.accent}`} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Statistic
                  title={m.title}
                  value={m.value}
                  prefix={m.icon}
                  valueStyle={{ color: m.valueColor, fontSize: 28 }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background:
                      m.ratioDir === 'up'
                        ? 'rgba(16,185,129,0.1)'
                        : 'rgba(239,68,68,0.1)',
                    color: m.ratioDir === 'up' ? '#0f766e' : '#b91c1c',
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.ratioDir === 'up' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                  <span>
                    {m.ratio}% {m.ratioLabel}
                  </span>
                </div>
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--cr-ink-3)',
                }}
              >
                {m.footer}
              </div>
              <Progress
                percent={m.ratio}
                showInfo={false}
                strokeColor={m.valueColor}
                trailColor="rgba(0,0,0,0.04)"
                size="small"
                style={{ marginTop: 10, marginBottom: 0 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* Charts */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <span>检视趋势</span>
                <Tag color="blue" style={{ marginLeft: 8 }}>
                  近 {dashboard.trend.length} 天
                </Tag>
              </Space>
            }
            extra={
              <Space size={4}>
                {trendDir === 'up' ? (
                  <Tag color="green" style={{ margin: 0 }}>
                    <ArrowUpOutlined /> 上升
                  </Tag>
                ) : (
                  <Tag color="red" style={{ margin: 0 }}>
                    <ArrowDownOutlined /> 下降
                  </Tag>
                )}
              </Space>
            }
            style={{ height: 380 }}
            bodyStyle={{ padding: '12px 20px 20px' }}
          >
            {dashboard.trend.length === 0 ? (
              <Empty description="暂无趋势数据" style={{ padding: 60 }} />
            ) : (
              <ReactECharts option={trendOption} style={{ height: 290 }} />
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <span>问题严重级别分布</span>
                <Tag color="orange" style={{ marginLeft: 8 }}>
                  共 {totalFindings}
                </Tag>
              </Space>
            }
            style={{ height: 380 }}
            bodyStyle={{ padding: '12px 20px 20px' }}
          >
            {totalFindings === 0 ? (
              <Empty description="暂无问题数据" style={{ padding: 60 }} />
            ) : (
              <ReactECharts option={severityOption} style={{ height: 290 }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* Activity + Quick Entries */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={14}>
          <Card
            title={
              <Space>
                <ClockCircleOutlined />
                <span>最近检视活动</span>
              </Space>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigate('/mrs')}>
                查看全部 →
              </Button>
            }
          >
            {recentMRs?.mrs && recentMRs.mrs.length > 0 ? (
              <List
                dataSource={recentMRs.mrs}
                renderItem={(mr: CodeHubMR) => (
                  <List.Item
                    style={{ padding: '10px 0', cursor: 'pointer' }}
                    onClick={() => navigate(`/mrs/${mr.iid}`)}
                  >
                    <List.Item.Meta
                      avatar={
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: 'var(--cr-bg-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--cr-brand-500)',
                            fontWeight: 600,
                            fontSize: 13,
                          }}
                        >
                          !{mr.iid}
                        </div>
                      }
                      title={
                        <Space size={6}>
                          <span
                            style={{
                              fontWeight: 500,
                              color: 'var(--cr-ink-1)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {mr.title}
                          </span>
                          {mr.state === 'open' && (
                            <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
                              待处理
                            </Tag>
                          )}
                          {mr.state === 'merged' && (
                            <Tag color="green" style={{ margin: 0, fontSize: 11 }}>
                              已合并
                            </Tag>
                          )}
                          {mr.state === 'closed' && (
                            <Tag color="red" style={{ margin: 0, fontSize: 11 }}>
                              已关闭
                            </Tag>
                          )}
                        </Space>
                      }
                      description={
                        <Space size={12} style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
                          <span>{dayjs(mr.updated_at).format('MM-DD HH:mm')}</span>
                          <span>{mr.source_branch} → {mr.target_branch}</span>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="暂无检视活动" style={{ padding: 40 }} />
            )}
          </Card>
        </Col>

        <Col xs={24} md={10}>
          <Card
            title={
              <Space>
                <ThunderboltOutlined />
                <span>快捷入口</span>
              </Space>
            }
          >
            <Row gutter={[12, 12]}>
              {quickEntries.map((q) => (
                <Col span={12} key={q.title}>
                  <Card
                    hoverable
                    style={{
                      cursor: 'pointer',
                      textAlign: 'center',
                      border: '1px solid var(--cr-border)',
                    }}
                    bodyStyle={{ padding: '20px 12px' }}
                    onClick={q.onClick}
                  >
                    <div style={{ marginBottom: 8 }}>{q.icon}</div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: 'var(--cr-ink-1)',
                        marginBottom: 2,
                      }}
                    >
                      {q.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{q.desc}</div>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>

      {/* System Status */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Card
            title={
              <Space>
                <ApiOutlined />
                <span>opencode 运行状态</span>
              </Space>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="cr-subframe">
                <Row justify="space-between" align="middle">
                  <Space>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: opencodeServeRunning ? '#10b981' : '#ef4444',
                        boxShadow: opencodeServeRunning
                          ? '0 0 8px rgba(16,185,129,0.5)'
                          : '0 0 8px rgba(239,68,68,0.3)',
                      }}
                    />
                    <span style={{ color: 'var(--cr-ink-2)' }}>
                      opencode 服务
                    </span>
                  </Space>
                  <Tag
                    color={opencodeServeRunning ? 'success' : 'error'}
                    style={{ margin: 0 }}
                  >
                    {opencodeServeRunning ? '运行中' : '已停止'}
                  </Tag>
                </Row>
                {opencodeServeRunning && opencodeStatus && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: 'var(--cr-ink-3)',
                    }}
                  >
                    {opencodeStatus.hostname}:{opencodeStatus.port}
                  </div>
                )}
              </div>

              <div className="cr-subframe">
                <Row justify="space-between" align="middle">
                  <Space>
                    <SafetyOutlined
                      style={{ color: opencodeOk ? '#10b981' : '#ef4444' }}
                    />
                    <span style={{ color: 'var(--cr-ink-2)' }}>opencode 安装</span>
                  </Space>
                  <Tag
                    color={opencodeOk ? 'success' : 'error'}
                    style={{ margin: 0 }}
                  >
                    {opencodeOk ? `v${opencodeVersion}` : '未安装'}
                  </Tag>
                </Row>
              </div>

              <div className="cr-subframe">
                <Row justify="space-between" align="middle">
                  <Space>
                    <CheckCircleOutlined
                      style={{ color: nodeOk ? '#10b981' : '#ef4444' }}
                    />
                    <span style={{ color: 'var(--cr-ink-2)' }}>Node.js</span>
                  </Space>
                  <Tag
                    color={nodeOk ? 'success' : 'warning'}
                    style={{ margin: 0 }}
                  >
                    v{nodeVersion}
                  </Tag>
                </Row>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card
            title={
              <Space>
                <ReloadOutlined />
                <span>同步与配置</span>
              </Space>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="cr-subframe">
                <Row justify="space-between" align="middle">
                  <Space>
                    <SyncOutlined
                      spin={syncStatus?.running}
                      style={{ color: '#3b6bff' }}
                    />
                    <span style={{ color: 'var(--cr-ink-2)' }}>MR 同步</span>
                  </Space>
                  <Space size={4}>
                    {syncStatus?.paused && (
                      <Tag color="warning" style={{ margin: 0 }}>
                        已暂停
                      </Tag>
                    )}
                    <Tag
                      color={syncStatus?.running ? 'processing' : 'default'}
                      style={{ margin: 0 }}
                    >
                      {syncStatus?.running ? '同步中' : '空闲'}
                    </Tag>
                  </Space>
                </Row>
                {syncStatus?.lastSyncAt && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: 'var(--cr-ink-3)',
                    }}
                  >
                    上次同步：{dayjs(syncStatus.lastSyncAt).format('YYYY-MM-DD HH:mm:ss')}
                  </div>
                )}
                {syncStatus?.nextSyncAt && !syncStatus.paused && (
                  <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
                    下次同步：{dayjs(syncStatus.nextSyncAt).format('YYYY-MM-DD HH:mm:ss')}
                  </div>
                )}
              </div>

              <div className="cr-subframe">
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--cr-ink-3)',
                    marginBottom: 8,
                    fontWeight: 600,
                  }}
                >
                  端口状态
                </div>
                <Row gutter={[8, 8]}>
                  <Col span={8}>
                    <div style={{ textAlign: 'center' }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--cr-ink-3)',
                          marginBottom: 4,
                        }}
                      >
                        opencode
                      </div>
                      <Tag
                        color={opencodePortAvail ? 'success' : 'error'}
                        style={{ margin: 0 }}
                      >
                        {opencodePortAvail ? '可用' : '占用'}
                      </Tag>
                    </div>
                  </Col>
                  <Col span={8}>
                    <div style={{ textAlign: 'center' }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--cr-ink-3)',
                          marginBottom: 4,
                        }}
                      >
                        API
                      </div>
                      <Tag
                        color={apiPortAvail ? 'success' : 'error'}
                        style={{ margin: 0 }}
                      >
                        {apiPortAvail ? '可用' : '占用'}
                      </Tag>
                    </div>
                  </Col>
                  <Col span={8}>
                    <div style={{ textAlign: 'center' }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--cr-ink-3)',
                          marginBottom: 4,
                        }}
                      >
                        Web
                      </div>
                      <Tag
                        color={webPortAvail ? 'success' : 'error'}
                        style={{ margin: 0 }}
                      >
                        {webPortAvail ? '可用' : '占用'}
                      </Tag>
                    </div>
                  </Col>
                </Row>
              </div>

              {serviceList.length > 0 && (
                <div className="cr-subframe">
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--cr-ink-3)',
                      marginBottom: 8,
                      fontWeight: 600,
                    }}
                  >
                    服务状态
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {serviceList.map((s) => (
                      <Tag
                        key={s.name}
                        color={s.status === 'running' ? 'success' : 'default'}
                        style={{ margin: 0 }}
                      >
                        {s.name}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card
            title={
              <Space>
                <ExclamationCircleOutlined />
                <span>系统健康</span>
              </Space>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                className="cr-subframe"
                style={{
                  background: healthOk
                    ? 'linear-gradient(180deg, #f0fdf4, #fafafa)'
                    : 'linear-gradient(180deg, #fef2f2, #fafafa)',
                }}
              >
                <Row justify="space-between" align="middle">
                  <Space>
                    <CheckCircleOutlined
                      style={{ color: healthOk ? '#10b981' : '#ef4444', fontSize: 18 }}
                    />
                    <span
                      style={{
                        fontWeight: 600,
                        color: healthOk ? '#0f766e' : '#b91c1c',
                      }}
                    >
                      {healthOk ? '系统健康' : '系统异常'}
                    </span>
                  </Space>
                  <Tag color={healthOk ? 'success' : 'error'} style={{ margin: 0 }}>
                    {healthOk ? 'OK' : 'Error'}
                  </Tag>
                </Row>
                {healthData?.config && (
                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      gap: 16,
                      flexWrap: 'wrap',
                      fontSize: 12,
                      color: 'var(--cr-ink-3)',
                    }}
                  >
                    <span>
                      CodeHub:{' '}
                      <strong style={{ color: healthData.config.codehubConfigured ? '#10b981' : '#ef4444' }}>
                        {healthData.config.codehubConfigured ? '已配置' : '未配置'}
                      </strong>
                    </span>
                    <span>
                      opencode:{' '}
                      <strong style={{ color: healthData.config.opencodeConfigured ? '#10b981' : '#ef4444' }}>
                        {healthData.config.opencodeConfigured ? '已配置' : '未配置'}
                      </strong>
                    </span>
                    <span>
                      检视:{' '}
                      <strong style={{ color: healthData.config.reviewConfigured ? '#10b981' : '#ef4444' }}>
                        {healthData.config.reviewConfigured ? '已配置' : '未配置'}
                      </strong>
                    </span>
                  </div>
                )}
              </div>

              <div className="cr-subframe">
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--cr-ink-3)',
                    marginBottom: 8,
                    fontWeight: 600,
                  }}
                >
                  版本信息
                </div>
                <Row gutter={[8, 8]}>
                  <Col span={12}>
                    <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
                      opencode
                    </div>
                    <div style={{ fontWeight: 600, color: 'var(--cr-ink-1)' }}>
                      v{opencodeVersion}
                    </div>
                  </Col>
                  <Col span={12}>
                    <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
                      Node.js
                    </div>
                    <div style={{ fontWeight: 600, color: 'var(--cr-ink-1)' }}>
                      v{nodeVersion}
                    </div>
                  </Col>
                  <Col span={12}>
                    <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
                      前端
                    </div>
                    <div style={{ fontWeight: 600, color: 'var(--cr-ink-1)' }}>
                      v0.1.0
                    </div>
                  </Col>
                  <Col span={12}>
                    <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>
                      数据库
                    </div>
                    <div style={{ fontWeight: 600, color: 'var(--cr-ink-1)' }}>
                      SQLite
                    </div>
                  </Col>
                </Row>
                <Divider style={{ margin: '12px 0' }} />
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--cr-ink-3)',
                    textAlign: 'center',
                  }}
                >
                  CodeReview 工作台 · © {dayjs().year()}
                </div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default Dashboard;