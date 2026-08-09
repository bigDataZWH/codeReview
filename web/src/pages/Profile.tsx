import { useState } from 'react';
import { Card, Row, Col, Avatar, Tag, List, Space, Button, Divider, Progress, Tooltip, Segmented } from 'antd';
import {
  UserOutlined,
  MailOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  StarOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  SafetyOutlined,
  FileTextOutlined,
  RiseOutlined,
  EditOutlined,
  PlayCircleOutlined,
  DatabaseOutlined,
  BellOutlined,
  BulbOutlined,
  KeyOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const recentActivities = [
  {
    id: '1',
    type: 'success' as const,
    title: 'MR !234 审查完成',
    mrTitle: '支付模块重构',
    description: '提交了 3 条审查意见，1 条建议已采纳',
    timestamp: '10 分钟前',
    action: '审查完成',
    result: '通过',
  },
  {
    id: '2',
    type: 'info' as const,
    title: '开始审查 MR !238',
    mrTitle: '用户权限优化',
    description: '检测到 2 个潜在问题',
    timestamp: '30 分钟前',
    action: '开始审查',
    result: '进行中',
  },
  {
    id: '3',
    type: 'warning' as const,
    title: 'MR !230 即将过期',
    mrTitle: 'API 网关升级',
    description: '尚未完成审查，剩余 2 小时',
    timestamp: '2 小时前',
    action: '超时提醒',
    result: '待处理',
  },
  {
    id: '4',
    type: 'success' as const,
    title: 'MR !221 已合入',
    mrTitle: '日志系统增强',
    description: '通过审查并成功合入 main 分支',
    timestamp: '昨天',
    action: '审查完成',
    result: '已合入',
  },
  {
    id: '5',
    type: 'info' as const,
    title: '系统报告已生成',
    mrTitle: '本周审查周报',
    description: '共审查 12 个 MR',
    timestamp: '2 天前',
    action: '报告生成',
    result: '已完成',
  },
];

const quickLinks = [
  { title: '继续检视', icon: <PlayCircleOutlined />, path: '/mrs', color: '#3b6bff' },
  { title: '查看报告', icon: <FileTextOutlined />, path: '/reports', color: '#10b981' },
  { title: '管理仓库', icon: <DatabaseOutlined />, path: '/repos', color: '#f59e0b' },
  { title: '系统设置', icon: <SettingOutlined />, path: '/settings', color: '#7c3aed' },
];

const activityIconMap = {
  success: <CheckCircleOutlined style={{ color: '#10b981' }} />,
  warning: <WarningOutlined style={{ color: '#f59e0b' }} />,
  error: <WarningOutlined style={{ color: '#ef4444' }} />,
  info: <ClockCircleOutlined style={{ color: '#3b6bff' }} />,
};

const resultTagMap: Record<string, { color: string; label: string }> = {
  通过: { color: 'green', label: '通过' },
  进行中: { color: 'processing', label: '进行中' },
  待处理: { color: 'warning', label: '待处理' },
  已合入: { color: 'success', label: '已合入' },
  已完成: { color: 'default', label: '已完成' },
};

function Profile() {
  const navigate = useNavigate();
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'auto'>('light');

  return (
    <div>
      <div className="cr-page-header">
        <div>
          <h1 className="cr-page-title">个人中心</h1>
          <p className="cr-page-subtitle">查看您的账户信息、活动记录和快捷入口</p>
        </div>
        <Button icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
          账户设置
        </Button>
      </div>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={8}>
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative' }}>
                <Avatar
                  size={96}
                  icon={<UserOutlined />}
                  style={{ backgroundColor: 'var(--cr-brand-500)', flexShrink: 0 }}
                />
                <Tag
                  color="blue"
                  style={{
                    position: 'absolute',
                    bottom: -4,
                    right: -8,
                    borderRadius: 999,
                    padding: '2px 10px',
                    fontWeight: 600,
                    fontSize: 11,
                    border: '2px solid #fff',
                  }}
                >
                  管理员
                </Tag>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--cr-ink-1)' }}>
                  管理员
                </div>
                <div style={{ fontSize: 13, color: 'var(--cr-ink-3)', marginTop: 2 }}>
                  CodeReview 平台
                </div>
              </div>

              <Row gutter={[8, 8]} style={{ width: '100%' }}>
                <Col span={8}>
                  <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--cr-bg-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cr-brand-600)' }}>128</div>
                    <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>总检视数</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--cr-bg-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>89</div>
                    <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>已解决</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--cr-bg-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>128</div>
                    <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>活跃天数</div>
                  </div>
                </Col>
              </Row>

              <Divider style={{ margin: '4px 0' }} />

              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--cr-ink-2)' }}>
                  <MailOutlined style={{ color: 'var(--cr-ink-3)' }} />
                  <span>admin@codereview.io</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--cr-ink-2)' }}>
                  <TeamOutlined style={{ color: 'var(--cr-ink-3)' }} />
                  <span>工程团队</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--cr-ink-2)' }}>
                  <ThunderboltOutlined style={{ color: 'var(--cr-ink-3)' }} />
                  <span>已加入 128 天</span>
                </div>
              </Space>

              <Button
                icon={<EditOutlined />}
                block
                onClick={() => navigate('/settings')}
              >
                编辑个人信息
              </Button>
            </div>
          </Card>

          <Card
            title={<span><StarOutlined style={{ marginRight: 6 }} />快捷入口</span>}
            style={{ marginTop: 20 }}
          >
            <Row gutter={[12, 12]}>
              {quickLinks.map((link) => (
                <Col span={12} key={link.title}>
                  <div
                    onClick={() => navigate(link.path)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      padding: '16px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--cr-border)',
                      cursor: 'pointer',
                      transition: 'all 0.18s ease',
                      background: 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = link.color;
                      e.currentTarget.style.background = `${link.color}10`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--cr-border)';
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span style={{ fontSize: 22, color: link.color }}>{link.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--cr-ink-2)' }}>{link.title}</span>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>

          <Card
            title={<span><BulbOutlined style={{ marginRight: 6 }} />偏好设置</span>}
            style={{ marginTop: 20 }}
            size="small"
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <SwapOutlined style={{ color: 'var(--cr-ink-3)' }} />
                  <span style={{ fontSize: 13 }}>主题切换</span>
                </Space>
                <Segmented
                  size="small"
                  value={themeMode}
                  onChange={(val) => setThemeMode(val as 'light' | 'dark' | 'auto')}
                  options={[
                    { label: '亮色', value: 'light' },
                    { label: '暗色', value: 'dark' },
                    { label: '自动', value: 'auto' },
                  ]}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <BellOutlined style={{ color: 'var(--cr-ink-3)' }} />
                  <span style={{ fontSize: 13 }}>通知设置</span>
                </Space>
                <Button
                  type="link"
                  size="small"
                  onClick={() => navigate('/settings')}
                >
                  配置
                </Button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <KeyOutlined style={{ color: 'var(--cr-ink-3)' }} />
                  <span style={{ fontSize: 13 }}>快捷键参考</span>
                </Space>
                <Tooltip title="打开快捷键参考面板">
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {}}
                  >
                    查看
                  </Button>
                </Tooltip>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card title={<span><RiseOutlined style={{ marginRight: 6 }} />审查统计</span>}>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--cr-brand-600)' }}>128</div>
                  <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 2 }}>审查 MR 数</div>
                </div>
              </Col>
              <Col xs={12} md={6}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--cr-sev-info)' }}>342</div>
                  <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 2 }}>发现问题</div>
                </div>
              </Col>
              <Col xs={12} md={6}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#10b981' }}>89%</div>
                  <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 2 }}>采纳率</div>
                </div>
              </Col>
              <Col xs={12} md={6}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>2.4h</div>
                  <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 2 }}>平均响应</div>
                </div>
              </Col>
            </Row>
            <Divider />
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                <span>本周审查目标</span>
                <span style={{ fontWeight: 600 }}>12 / 15</span>
              </div>
              <Progress percent={80} strokeColor={{ from: '#3b6bff', to: '#0ea5a4' }} showInfo={false} />
            </div>
          </Card>

          <Card
            title={<span><ClockCircleOutlined style={{ marginRight: 6 }} />我的活动时间线</span>}
            style={{ marginTop: 20 }}
            extra={
              <Button type="link" size="small" onClick={() => navigate('/mrs')}>
                查看全部
              </Button>
            }
          >
            <List
              dataSource={recentActivities}
              renderItem={(item) => (
                <List.Item
                  style={{
                    padding: '14px 0',
                    borderBottom: '1px solid var(--cr-divider)',
                  }}
                >
                  <List.Item.Meta
                    avatar={activityIconMap[item.type]}
                    title={
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <Space size={6}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--cr-ink-1)' }}>
                            {item.title}
                          </span>
                          {resultTagMap[item.result] && (
                            <Tag color={resultTagMap[item.result].color} style={{ margin: 0 }}>
                              {resultTagMap[item.result].label}
                            </Tag>
                          )}
                        </Space>
                        <span style={{ fontSize: 12, color: 'var(--cr-ink-3)', fontWeight: 400 }}>
                          {item.timestamp}
                        </span>
                      </div>
                    }
                    description={
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 4 }}>
                          <span style={{ color: 'var(--cr-brand-500)', fontWeight: 500 }}>{item.action}</span>
                          <span style={{ margin: '0 6px' }}>·</span>
                          <span>{item.mrTitle}</span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--cr-ink-3)' }}>
                          {item.description}
                        </div>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default Profile;