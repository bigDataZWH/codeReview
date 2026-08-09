import { Card, Row, Col, Statistic, Spin, Alert } from 'antd';
import {
  MergeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  BugOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import { codehubApi, type DashboardStats, type ReportsOverview } from '@/api/codehub';

function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => codehubApi.getDashboard() as Promise<{ ok: boolean; dashboard: DashboardStats }>,
    retry: false,
  });

  // 报表总览：用于接纳率/拦截数卡片。报表数据可能为空，失败/加载中时静默降级为占位
  const { data: reportsData } = useQuery({
    queryKey: ['reports-overview'],
    queryFn: () =>
      codehubApi.getReportsOverview() as Promise<{ ok: boolean; overview: ReportsOverview }>,
    retry: false,
  });
  const overview = reportsData?.overview;

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

  const severityOption = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: [
          { value: dashboard.findingsBySeverity.critical, name: 'Critical', itemStyle: { color: '#ff4d4f' } },
          { value: dashboard.findingsBySeverity.high, name: 'High', itemStyle: { color: '#fa8c16' } },
          { value: dashboard.findingsBySeverity.medium, name: 'Medium', itemStyle: { color: '#faad14' } },
          { value: dashboard.findingsBySeverity.low, name: 'Low', itemStyle: { color: '#1677ff' } },
          { value: dashboard.findingsBySeverity.info, name: 'Info', itemStyle: { color: '#52c41a' } },
        ],
      },
    ],
  };

  const trendOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['审查数', '发现问题'], bottom: 0 },
    grid: { left: 40, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: dashboard.trend.map((t) => t.date),
    },
    yAxis: { type: 'value' },
    series: [
      {
        name: '审查数',
        type: 'line',
        smooth: true,
        data: dashboard.trend.map((t) => t.reviews),
        itemStyle: { color: '#1677ff' },
      },
    ],
  };

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="待处理 MR"
              value={dashboard.openMRs}
              prefix={<MergeOutlined style={{ color: '#1677ff' }} />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="已合并 MR"
              value={dashboard.mergedMRs}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="已关闭 MR"
              value={dashboard.closedMRs}
              prefix={<CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="发现问题"
              value={dashboard.totalFindings}
              prefix={<BugOutlined style={{ color: '#fa8c16' }} />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 报表卡片：问题单接纳率 / 拦截数量，点击跳转报表页 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card
            hoverable
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/reports')}
          >
            <Statistic
              title="问题单接纳率"
              value={overview ? `${overview.acceptanceRate.toFixed(1)}%` : '-'}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
            {overview && (
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                {overview.acceptanceNumerator}/{overview.acceptanceDenominator}
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card
            hoverable
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/reports')}
          >
            <Statistic
              title="拦截数量"
              value={overview ? overview.interceptionCount : '-'}
              prefix={<StopOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="问题严重级别分布" style={{ height: 360 }}>
            <ReactECharts option={severityOption} style={{ height: 280 }} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="审查趋势" style={{ height: 360 }}>
            <ReactECharts option={trendOption} style={{ height: 280 }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Card title="快速统计">
            <div style={{ lineHeight: 2 }}>
              <p style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span><WarningOutlined style={{ color: '#fa8c16', marginRight: 8 }} />待审查</span>
                <strong>{dashboard.pendingReviews}</strong>
              </p>
              <p style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span><CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />今日已审查</span>
                <strong>{dashboard.reviewedToday}</strong>
              </p>
              <p style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span><CheckCircleOutlined style={{ color: '#1677ff', marginRight: 8 }} />本周已审查</span>
                <strong>{dashboard.reviewedThisWeek}</strong>
              </p>
              <p style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span><MergeOutlined style={{ color: '#722ed1', marginRight: 8 }} />MR 总数</span>
                <strong>{dashboard.totalMRs}</strong>
              </p>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card title="严重级别详情">
            <Row gutter={[12, 12]}>
              {[
                { label: 'Critical', value: dashboard.findingsBySeverity.critical, color: '#ff4d4f' },
                { label: 'High', value: dashboard.findingsBySeverity.high, color: '#fa8c16' },
                { label: 'Medium', value: dashboard.findingsBySeverity.medium, color: '#faad14' },
                { label: 'Low', value: dashboard.findingsBySeverity.low, color: '#1677ff' },
                { label: 'Info', value: dashboard.findingsBySeverity.info, color: '#52c41a' },
              ].map((item) => (
                <Col xs={24} sm={12} md={8} key={item.label}>
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 8,
                      background: `${item.color}10`,
                      border: `1px solid ${item.color}30`,
                    }}
                  >
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 600, color: item.color }}>{item.value}</div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default Dashboard;
