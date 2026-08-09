import { useState } from 'react';
import { Card, Row, Col, Statistic, Spin, Alert, Segmented, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  StopOutlined,
  EyeOutlined,
  BugOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import {
  codehubApi,
  type ReportsOverview,
  type TrendPoint,
  type ByRuleItem,
  type ByAuthorItem,
  type ByRepoItem,
} from '@/api/codehub';

// 报表时间范围类型
type ReportRange = '7d' | '30d' | '90d';

function Reports() {
  // 时间范围筛选状态，默认 30 天
  const [range, setRange] = useState<ReportRange>('30d');

  // 概览指标
  const overviewQuery = useQuery({
    queryKey: ['reports-overview'],
    queryFn: () =>
      codehubApi.getReportsOverview() as Promise<{
        ok: boolean;
        overview: ReportsOverview;
      }>,
    retry: false,
  });

  // 趋势数据，依赖 range，切换时自动 refetch
  const trendQuery = useQuery({
    queryKey: ['reports-trend', range],
    queryFn: () =>
      codehubApi.getReportsTrend(range) as Promise<{
        ok: boolean;
        trend: TrendPoint[];
      }>,
    retry: false,
  });

  // 按规则聚合
  const byRuleQuery = useQuery({
    queryKey: ['reports-by-rule'],
    queryFn: () =>
      codehubApi.getReportsByRule() as Promise<{
        ok: boolean;
        items: ByRuleItem[];
      }>,
    retry: false,
  });

  // 按作者聚合
  const byAuthorQuery = useQuery({
    queryKey: ['reports-by-author'],
    queryFn: () =>
      codehubApi.getReportsByAuthor() as Promise<{
        ok: boolean;
        items: ByAuthorItem[];
      }>,
    retry: false,
  });

  // 按仓库聚合
  const byRepoQuery = useQuery({
    queryKey: ['reports-by-repo'],
    queryFn: () =>
      codehubApi.getReportsByRepo() as Promise<{
        ok: boolean;
        items: ByRepoItem[];
      }>,
    retry: false,
  });

  // 概览数据未就绪时，整页 loading / 错误占位（参考 Dashboard 风格）
  if (overviewQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (overviewQuery.error || !overviewQuery.data?.ok) {
    return (
      <Alert
        type="warning"
        message="无法加载报表概览数据"
        description={
          <div>
            <p>请先在设置页面配置 CodeHub 连接信息。</p>
            <p>
              错误信息：
              {overviewQuery.error instanceof Error
                ? overviewQuery.error.message
                : '未知错误'}
            </p>
          </div>
        }
        showIcon
      />
    );
  }

  const overview = overviewQuery.data.overview;
  const trend = trendQuery.data?.trend ?? [];
  const byRuleItems = byRuleQuery.data?.items ?? [];
  const byAuthorItems = byAuthorQuery.data?.items ?? [];
  const byRepoItems = byRepoQuery.data?.items ?? [];

  // 趋势折线图：检视数 / 发现问题 走主轴，接纳率走副轴
  const trendOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['检视数', '发现问题', '接纳率'], bottom: 0 },
    grid: { left: 50, right: 50, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: trend.map((t) => t.date),
    },
    yAxis: [
      { type: 'value', name: '数量' },
      {
        type: 'value',
        name: '接纳率',
        axisLabel: { formatter: '{value}%' },
        max: 100,
      },
    ],
    series: [
      {
        name: '检视数',
        type: 'line',
        smooth: true,
        data: trend.map((t) => t.reviews),
        itemStyle: { color: '#1677ff' },
      },
      {
        name: '发现问题',
        type: 'line',
        smooth: true,
        data: trend.map((t) => t.findings),
        itemStyle: { color: '#fa8c16' },
      },
      {
        name: '接纳率',
        type: 'line',
        smooth: true,
        yAxisIndex: 1,
        data: trend.map((t) =>
          t.findings > 0
            ? Number(((t.acceptedFindings / t.findings) * 100).toFixed(2))
            : 0,
        ),
        itemStyle: { color: '#52c41a' },
      },
    ],
  };

  // 规则命中 Top10 柱状图
  const top10Rules = [...byRuleItems]
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, 10);
  const ruleOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 30, bottom: 60 },
    xAxis: {
      type: 'category',
      data: top10Rules.map((r) => r.ruleName),
      axisLabel: { rotate: 30, interval: 0 },
    },
    yAxis: { type: 'value' },
    series: [
      {
        name: '命中次数',
        type: 'bar',
        data: top10Rules.map((r) => r.hitCount),
        itemStyle: { color: '#1677ff' },
      },
    ],
  };

  // 作者维度表格列定义
  const authorColumns: ColumnsType<ByAuthorItem> = [
    { title: '作者', dataIndex: 'author', key: 'author' },
    { title: 'MR 数', dataIndex: 'mrCount', key: 'mrCount' },
    { title: '问题总数', dataIndex: 'totalFindings', key: 'totalFindings' },
    {
      title: '平均问题数/MR',
      dataIndex: 'avgFindingsPerMR',
      key: 'avgFindingsPerMR',
      render: (value: number) => value.toFixed(1),
    },
    {
      title: '接纳率',
      dataIndex: 'acceptanceRate',
      key: 'acceptanceRate',
      render: (value: number) => `${value.toFixed(1)}%`,
    },
  ];

  // 仓库维度表格列定义
  const repoColumns: ColumnsType<ByRepoItem> = [
    { title: '仓库', dataIndex: 'repoName', key: 'repoName' },
    { title: 'MR 数', dataIndex: 'mrCount', key: 'mrCount' },
    { title: '问题数', dataIndex: 'findings', key: 'findings' },
    {
      title: '接纳率',
      dataIndex: 'acceptanceRate',
      key: 'acceptanceRate',
      render: (value: number) => `${value.toFixed(1)}%`,
    },
    { title: '拦截数', dataIndex: 'interceptions', key: 'interceptions' },
  ];

  return (
    <div>
      {/* 顶部 4 张指标卡 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="问题单接纳率"
              value={overview.acceptanceRate}
              precision={1}
              suffix="%"
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              {overview.acceptanceNumerator}/{overview.acceptanceDenominator}
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="拦截数量"
              value={overview.interceptionCount}
              prefix={<StopOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="累计检视数"
              value={overview.reviewCount}
              prefix={<EyeOutlined style={{ color: '#1677ff' }} />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="平均问题数/MR"
              value={overview.avgFindingsPerMR}
              precision={1}
              prefix={<BugOutlined style={{ color: '#fa8c16' }} />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 时间范围筛选 */}
      <div style={{ margin: '16px 0' }}>
        <Segmented
          options={[
            { label: '7天', value: '7d' },
            { label: '30天', value: '30d' },
            { label: '90天', value: '90d' },
          ]}
          value={range}
          onChange={(value) => setRange(value as ReportRange)}
        />
      </div>

      {/* 趋势折线图 */}
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card title="检视与问题趋势" style={{ height: 380 }}>
            {trendQuery.error ? (
              <Alert
                type="error"
                message="趋势数据加载失败"
                description={
                  trendQuery.error instanceof Error
                    ? trendQuery.error.message
                    : '未知错误'
                }
                showIcon
              />
            ) : trendQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <Spin />
              </div>
            ) : (
              <ReactECharts option={trendOption} style={{ height: 300 }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* 规则命中 Top10 柱状图 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title="规则命中 Top10" style={{ height: 380 }}>
            {byRuleQuery.error ? (
              <Alert
                type="error"
                message="规则数据加载失败"
                description={
                  byRuleQuery.error instanceof Error
                    ? byRuleQuery.error.message
                    : '未知错误'
                }
                showIcon
              />
            ) : byRuleQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <Spin />
              </div>
            ) : (
              <ReactECharts option={ruleOption} style={{ height: 300 }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* 作者维度 + 仓库维度表格 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="作者维度统计">
            {byAuthorQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <Spin />
              </div>
            ) : byAuthorQuery.error ? (
              <Alert
                type="error"
                message="作者数据加载失败"
                description={
                  byAuthorQuery.error instanceof Error
                    ? byAuthorQuery.error.message
                    : '未知错误'
                }
                showIcon
              />
            ) : (
              <Table<ByAuthorItem>
                columns={authorColumns}
                dataSource={byAuthorItems}
                rowKey="author"
                pagination={{ pageSize: 10 }}
                size="small"
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="仓库维度统计">
            {byRepoQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <Spin />
              </div>
            ) : byRepoQuery.error ? (
              <Alert
                type="error"
                message="仓库数据加载失败"
                description={
                  byRepoQuery.error instanceof Error
                    ? byRepoQuery.error.message
                    : '未知错误'
                }
                showIcon
              />
            ) : (
              <Table<ByRepoItem>
                columns={repoColumns}
                dataSource={byRepoItems}
                rowKey="repoId"
                pagination={{ pageSize: 10 }}
                size="small"
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default Reports;
