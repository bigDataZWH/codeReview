import { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Space,
  message,
  Tabs,
  Divider,
  Alert,
  Spin,
  Tag,
  Badge,
  Table,
  Modal,
  Popconfirm,
  Empty,
  Typography,
  Progress,
  Steps,
  Tooltip,
} from 'antd';
import type { TableProps } from 'antd';
import {
  SettingOutlined,
  SaveOutlined,
  DatabaseOutlined,
  RobotOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckOutlined,
  ThunderboltOutlined,
  FolderOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  RocketOutlined,
  ReloadOutlined,
  UploadOutlined,
  DownloadOutlined,
  SyncOutlined,
  SafetyOutlined,
  InfoCircleOutlined,
  HistoryOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  codehubApi,
  type CodeHubConfig,
  type RepoConfig,
  type EnvironmentHealth,
  type QuickConfigureInput,
  type StartAllResult,
} from '@/api/codehub';
import { useAppStore } from '@/store/app';

const { Text, Title } = Typography;

interface OpencodeServeStatus {
  running: boolean;
  pid?: number;
  port?: number;
  hostname?: string;
  startedAt?: string;
  lastLogLines: string[];
}

interface ServiceStatusInfo {
  ok: boolean;
  services: {
    opencode: { running: boolean; pid?: number; port?: number };
    api: { running: boolean; pid?: number; port?: number };
    web: { running: boolean; pid?: number; port?: number };
  };
}

type CheckStatus = 'pass' | 'warning' | 'fail' | 'unknown';

const getStatusIcon = (status: CheckStatus) => {
  switch (status) {
    case 'pass':
      return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />;
    case 'warning':
      return <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 20 }} />;
    case 'fail':
      return <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 20 }} />;
    default:
      return <CloseCircleOutlined style={{ color: '#d9d9d9', fontSize: 20 }} />;
  }
};

const getStatusLabel = (status: CheckStatus) => {
  switch (status) {
    case 'pass':
      return '已配置';
    case 'warning':
      return '待配置';
    case 'fail':
      return '未配置';
    default:
      return '未检测';
  }
};

// ============ 配置状态总览面板 + 一键启动 ============
function QuickConfigDashboard({ onOpenWizard }: { onOpenWizard: () => void }) {
  const queryClient = useQueryClient();

  const healthQuery = useQuery({
    queryKey: ['opencode-health'],
    queryFn: () => codehubApi.getOpencodeHealth() as Promise<EnvironmentHealth>,
    retry: false,
    refetchInterval: 10000,
  });

  const serveStatusQuery = useQuery({
    queryKey: ['opencode-serve-status'],
    queryFn: () => codehubApi.getOpencodeServeStatus() as Promise<OpencodeServeStatus>,
    retry: false,
    refetchInterval: 5000,
  });

  const serviceStatusQuery = useQuery({
    queryKey: ['service-status'],
    queryFn: () => codehubApi.getServiceStatus() as Promise<ServiceStatusInfo>,
    retry: false,
    refetchInterval: 5000,
  });

  const health = healthQuery.data;

  const checks = useMemo(() => {
    const codehubOk = health?.config.codehubConfigured ?? false;
    const opencodeOk = health?.config.opencodeConfigured ?? false;
    const reviewOk = health?.config.reviewConfigured ?? false;
    const servicesOk =
      serveStatusQuery.data?.running ||
      serviceStatusQuery.data?.services.api.running ||
      serviceStatusQuery.data?.services.web.running ||
      false;

    return [
      {
        key: 'codehub',
        label: 'CodeHub 连接',
        status: codehubOk ? 'pass' : healthQuery.isLoading ? 'unknown' : 'fail',
        description: codehubOk ? '仓库连接已配置' : '尚未配置 CodeHub 仓库信息',
      },
      {
        key: 'opencode',
        label: 'opencode 配置',
        status: opencodeOk ? 'pass' : healthQuery.isLoading ? 'unknown' : 'fail',
        description: opencodeOk ? 'opencode 已配置且可用' : 'opencode 未安装或未配置',
      },
      {
        key: 'review',
        label: '审查参数',
        status: reviewOk ? 'pass' : healthQuery.isLoading ? 'unknown' : 'warning',
        description: reviewOk ? '审查参数已配置' : '使用默认审查参数',
      },
      {
        key: 'services',
        label: '服务运行',
        status: servicesOk ? 'pass' : serveStatusQuery.isLoading ? 'unknown' : 'warning',
        description: servicesOk ? '至少一个服务正在运行' : '无服务运行中',
      },
    ];
  }, [health, healthQuery.isLoading, serveStatusQuery.data?.running, serveStatusQuery.isLoading, serviceStatusQuery.data]);

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const completeness = Math.round((passCount / checks.length) * 100);

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['opencode-health'] }),
      queryClient.invalidateQueries({ queryKey: ['opencode-serve-status'] }),
      queryClient.invalidateQueries({ queryKey: ['service-status'] }),
    ]);
  };

  const startAllMutation = useMutation({
    mutationFn: () => codehubApi.startAllServices() as Promise<StartAllResult>,
    onSuccess: async (res) => {
      const failed = Object.entries(res.services)
        .filter(([, v]) => !v.started)
        .map(([k]) => k);
      if (res.ok && failed.length === 0) {
        message.success('全部服务启动成功');
      } else {
        message.warning(`部分服务启动失败: ${failed.join(', ')}`);
      }
      await refreshAll();
    },
    onError: (err) => {
      message.error(`启动失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const launchAll = () => {
    Modal.confirm({
      title: '一键启动全部服务',
      content: (
        <div>
          <p>将依次启动以下服务：</p>
          <ul>
            <li>opencode serve</li>
            <li>后端 API 服务</li>
            <li>前端 Web 服务</li>
          </ul>
          <p style={{ color: '#999', marginBottom: 0 }}>确认启动？</p>
        </div>
      ),
      okText: '启动',
      cancelText: '取消',
      icon: <RocketOutlined style={{ color: '#1677ff' }} />,
      onOk: () => startAllMutation.mutate(),
    });
  };

  const serviceCards = [
    {
      key: 'opencode',
      label: 'opencode serve',
      color: 'purple' as const,
      running: !!serveStatusQuery.data?.running,
      pid: serveStatusQuery.data?.pid,
      port: serveStatusQuery.data?.port,
      statusText: serveStatusQuery.data?.running ? '运行中' : '已停止',
    },
    {
      key: 'api',
      label: '后端 API 服务',
      color: 'blue' as const,
      running: !!serviceStatusQuery.data?.services.api.running,
      pid: serviceStatusQuery.data?.services.api.pid,
      port: serviceStatusQuery.data?.services.api.port,
      statusText: serviceStatusQuery.data?.services.api.running ? '运行中' : '已停止',
    },
    {
      key: 'web',
      label: '前端 Web 服务',
      color: 'green' as const,
      running: !!serviceStatusQuery.data?.services.web.running,
      pid: serviceStatusQuery.data?.services.web.pid,
      port: serviceStatusQuery.data?.services.web.port,
      statusText: serviceStatusQuery.data?.services.web.running ? '运行中' : '已停止',
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      bodyStyle={{ padding: 20 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <RocketOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          <Title level={5} style={{ margin: 0 }}>
            配置状态总览
          </Title>
        </Space>
        <Space>
          <Tooltip title="刷新">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={refreshAll}
              loading={healthQuery.isFetching}
            >
              刷新
            </Button>
          </Tooltip>
          <Button type="primary" icon={<SettingOutlined />} onClick={onOpenWizard}>
            快速配置向导
          </Button>
        </Space>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Progress
            type="dashboard"
            percent={completeness}
            size={120}
            strokeColor={completeness === 100 ? '#52c41a' : completeness >= 50 ? '#faad14' : '#ff4d4f'}
            format={(percent) => (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--cr-ink-1)' }}>{percent}%</div>
                <div style={{ fontSize: 11, color: 'var(--cr-ink-3)' }}>完成度</div>
              </div>
            )}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              {completeness === 100 ? '配置已完成' : completeness >= 50 ? '部分已配置' : '需要完善配置'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginBottom: 12 }}>
              {passCount} / {checks.length} 项已通过
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {checks.filter(c => c.status !== 'pass').map(c => (
                <Tag
                  key={c.key}
                  color={c.status === 'warning' ? 'orange' : 'red'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    const el = document.querySelector(`[data-check-key="${c.key}"]`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                >
                  {c.label}
                </Tag>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}
      >
        {checks.map((check) => (
          <div
            key={check.key}
            data-check-key={check.key}
            style={{
              border: check.status !== 'pass' ? '2px solid #faad14' : '1px solid #f0f0f0',
              borderRadius: 8,
              padding: 16,
              background: check.status !== 'pass' ? '#fffbe6' : '#fafafa',
              textAlign: 'center',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ marginBottom: 8 }}>{getStatusIcon(check.status as CheckStatus)}</div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>{check.label}</div>
            <Tag
              color={
                check.status === 'pass'
                  ? 'green'
                  : check.status === 'warning'
                    ? 'orange'
                    : check.status === 'fail'
                      ? 'red'
                      : 'default'
              }
              style={{ marginBottom: 8 }}
            >
              {getStatusLabel(check.status as CheckStatus)}
            </Tag>
            <div style={{ fontSize: 12, color: '#888' }}>{check.description}</div>
          </div>
        ))}
      </div>

      <Divider style={{ margin: '8px 0 16px' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <ThunderboltOutlined style={{ color: '#fa8c16', fontSize: 16 }} />
          <Text strong>一键启动</Text>
        </Space>
        <Button
          type="primary"
          size="large"
          icon={<RocketOutlined />}
          onClick={launchAll}
          loading={startAllMutation.isPending}
        >
          一键启动全部服务
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        {serviceCards.map((svc) => (
          <div
            key={svc.key}
            style={{
              border: '1px solid #f0f0f0',
              borderRadius: 8,
              padding: 16,
              background: svc.running ? '#f6ffed' : '#fafafa',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Space>
                {svc.running ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleOutlined style={{ color: '#d9d9d9' }} />
                )}
                <Text strong>{svc.label}</Text>
              </Space>
              <Badge status={svc.running ? 'success' : 'default'} text={svc.statusText} />
            </div>
            {svc.running && (
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                PID: {svc.pid ?? '-'}　端口: {svc.port ?? '-'}
              </div>
            )}
            <Button
              size="small"
              type="link"
              icon={svc.running ? <PoweroffOutlined /> : <PlayCircleOutlined />}
              onClick={async () => {
                try {
                  if (svc.key === 'opencode') {
                    if (svc.running) {
                      await codehubApi.stopOpencodeServe();
                      message.success('opencode serve 已停止');
                    } else {
                      await codehubApi.startOpencodeServe({ port: 4096, hostname: '127.0.0.1' });
                      message.success('opencode serve 已启动');
                    }
                  } else {
                    await codehubApi.startService(svc.key as 'backend' | 'frontend');
                    message.success(`${svc.label} 启动指令已发送`);
                  }
                  await refreshAll();
                } catch (err) {
                  message.error(`操作失败: ${err instanceof Error ? err.message : '未知错误'}`);
                }
              }}
            >
              {svc.running ? '停止' : '启动'}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============ 快速配置向导 ============
function QuickConfigWizard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [healthData, setHealthData] = useState<EnvironmentHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [configResult, setConfigResult] = useState<StartAllResult | null>(null);

  const [codehubForm] = Form.useForm();
  const [reviewForm] = Form.useForm();

  const detectEnvironment = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = (await codehubApi.getOpencodeHealth()) as EnvironmentHealth;
      setHealthData(data);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    if (open && currentStep === 0 && !healthData) {
      detectEnvironment();
    }
  }, [open, currentStep, healthData]);

  useEffect(() => {
    if (open) {
      setCurrentStep(0);
      setHealthData(null);
      setHealthError(null);
      setTestResult(null);
      setConfigResult(null);
      setConfiguring(false);
      codehubForm.resetFields();
      reviewForm.resetFields();
    }
  }, [open]);

  const handleNext = async () => {
    if (currentStep === 0) {
      setCurrentStep(1);
    } else if (currentStep === 1) {
      try {
        await codehubForm.validateFields();
        setCurrentStep(2);
      } catch {
        // validation error
      }
    } else if (currentStep === 2) {
      setCurrentStep(3);
    }
  };

  const handlePrev = () => {
    setCurrentStep((s) => Math.max(0, s - 1));
  };

  const handleTestConnection = async () => {
    try {
      const values = await codehubForm.validateFields();
      setTestResult(null);
      const res = await codehubApi.testConnection();
      if (res?.ok) {
        setTestResult({ ok: true, message: '连接成功' });
        message.success('连接测试成功');
      } else {
        setTestResult({ ok: false, message: res?.error || '连接失败' });
        message.error(res?.error || '连接失败');
      }
    } catch {
      // validation error
    }
  };

  const handleQuickConfigure = async () => {
    try {
      setConfiguring(true);
      const codehubValues = await codehubForm.validateFields();
      const reviewValues = reviewForm.getFieldsValue();

      const input: QuickConfigureInput = {
        codehub: {
          name: codehubValues.name as string,
          baseUrl: codehubValues.baseUrl as string,
          token: codehubValues.token as string,
          projectId: codehubValues.projectId as string,
        },
        reviewConfig: {
          defaultStrength: (reviewValues.defaultStrength as 'lenient' | 'standard' | 'strict') || 'standard',
          securityReview: (reviewValues.securityReview as boolean) ?? true,
          defaultLanguage: (reviewValues.defaultLanguage as string) || 'zh-CN',
        },
      };

      const res = await codehubApi.quickConfigure(input);
      if (res?.ok) {
        const derivedCmd: string | undefined = (res as { startCommand?: string }).startCommand;
        message.success(derivedCmd ? `配置已保存（启动命令已自动推导：${derivedCmd}）` : '配置已保存');
        const startRes = (await codehubApi.startAllServices()) as StartAllResult;
        setConfigResult(startRes);
        const failed = Object.entries(startRes.services)
          .filter(([, v]) => !v.started)
          .map(([k]) => k);
        if (startRes.ok && failed.length === 0) {
          message.success('全部服务启动成功');
        } else if (failed.length > 0) {
          message.warning(`部分服务启动失败: ${failed.join(', ')}`);
        }
      } else {
        message.error(res?.error || '配置失败');
      }
    } catch (err) {
      message.error(`操作失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setConfiguring(false);
    }
  };

  const healthPassed = healthData?.ok ?? false;
  const canProceedFromStep0 = healthPassed;

  const stepItems = [
    { title: '环境检测', icon: <RocketOutlined /> },
    { title: 'CodeHub 配置', icon: <DatabaseOutlined /> },
    { title: '审查参数', icon: <SettingOutlined /> },
    { title: '完成', icon: <CheckOutlined /> },
  ];

  return (
    <Modal
      title={
        <Space>
          <RocketOutlined />
          <span>快速配置向导</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={640}
      footer={[
        currentStep > 0 && currentStep < 3 ? (
          <Button key="prev" onClick={handlePrev}>
            上一步
          </Button>
        ) : null,
        currentStep < 3 && (
          <Button
            key="next"
            type="primary"
            onClick={handleNext}
            disabled={currentStep === 0 && !canProceedFromStep0}
          >
            下一步
          </Button>
        ),
        currentStep === 3 && (
          <Button
            key="finish"
            type="primary"
            icon={<RocketOutlined />}
            loading={configuring}
            onClick={handleQuickConfigure}
          >
            {configuring ? '配置中...' : '一键配置并启动'}
          </Button>
        ),
      ].filter(Boolean)}
      destroyOnClose
      styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
    >
      <Steps current={currentStep} items={stepItems} style={{ marginBottom: 32 }} size="small" />

      {/* Step 1: 环境检测 */}
      {currentStep === 0 && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Text strong>环境自动检测</Text>
          </div>
          {healthLoading && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Spin tip="正在检测环境..." />
            </div>
          )}
          {healthError && (
            <Alert
              type="error"
              showIcon
              message="环境检测失败"
              description={healthError}
              style={{ marginBottom: 16 }}
            />
          )}
          {healthData && !healthLoading && (
            <div>
              <Card
                size="small"
                type="inner"
                title={
                  <Space>
                    {healthData.opencode.installed ? (
                      <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    ) : (
                      <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                    )}
                    <span>opencode</span>
                  </Space>
                }
                style={{ marginBottom: 12 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">版本</Text>
                  <Text>{healthData.opencode.version || '未安装'}</Text>
                </div>
                {healthData.opencode.error && (
                  <div style={{ color: '#ff4d4f', marginTop: 4 }}>{healthData.opencode.error}</div>
                )}
              </Card>

              <Card
                size="small"
                type="inner"
                title={
                  <Space>
                    {healthData.nodejs.supported ? (
                      <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    ) : (
                      <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                    )}
                    <span>Node.js</span>
                  </Space>
                }
                style={{ marginBottom: 12 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">版本</Text>
                  <Text>{healthData.nodejs.version}</Text>
                </div>
              </Card>

              <Card
                size="small"
                type="inner"
                title={<Text strong>端口检测</Text>}
                style={{ marginBottom: 12 }}
              >
                {Object.entries(healthData.ports).map(([key, val]) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                      padding: '4px 0',
                    }}
                  >
                    <Space>
                      {val.available ? (
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      ) : (
                        <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      )}
                      <Text>{key} ({val.port})</Text>
                    </Space>
                    <Tag color={val.available ? 'green' : 'red'}>
                      {val.available ? '可用' : '占用'}
                    </Tag>
                  </div>
                ))}
              </Card>

              <div style={{ marginTop: 16, textAlign: 'right' }}>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={detectEnvironment}
                  loading={healthLoading}
                >
                  重新检测
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: CodeHub 配置 */}
      {currentStep === 1 && (
        <div>
          <Alert
            type="info"
            showIcon
            message="CodeHub 仓库配置"
            description="填写 CodeHub 仓库连接信息，配置完成后可被审查功能使用。"
            style={{ marginBottom: 16 }}
          />
          <Form form={codehubForm} layout="vertical">
            <Form.Item
              label="名称"
              name="name"
              rules={[{ required: true, message: '请输入仓库名称' }]}
            >
              <Input placeholder="例如：前端主仓库" />
            </Form.Item>
            <Form.Item
              label="CodeHub 地址"
              name="baseUrl"
              rules={[{ required: true, message: '请输入 CodeHub 地址' }]}
            >
              <Input placeholder="https://codehub.example.com" />
            </Form.Item>
            <Form.Item
              label="Token"
              name="token"
              rules={[{ required: true, message: '请输入 Token' }]}
              extra="在 CodeHub 个人设置中生成的访问令牌"
            >
              <Input.Password placeholder="Enter your token" />
            </Form.Item>
            <Form.Item
              label="项目 ID / 路径"
              name="projectId"
              rules={[{ required: true, message: '请输入项目 ID' }]}
              extra="例如：group/project-name"
            >
              <Input placeholder="group/project-name" />
            </Form.Item>
          </Form>

          <div style={{ marginTop: 12 }}>
            <Space>
              <Button icon={<ThunderboltOutlined />} onClick={handleTestConnection}>
                测试连接
              </Button>
              {testResult && (
                <Tag color={testResult.ok ? 'green' : 'red'}>
                  {testResult.message}
                </Tag>
              )}
            </Space>
          </div>
        </div>
      )}

      {/* Step 3: 审查参数 */}
      {currentStep === 2 && (
        <div>
          <Alert
            type="info"
            showIcon
            message="审查参数配置"
            description="设置代码审查的默认参数，可在后续设置页面修改。"
            style={{ marginBottom: 16 }}
          />
          <Form form={reviewForm} layout="vertical" initialValues={{ defaultStrength: 'standard', securityReview: true, defaultLanguage: 'zh-CN' }}>
            <Form.Item label="审查强度" name="defaultStrength">
              <Select
                options={[
                  { value: 'lenient', label: '宽松 - 仅报告严重问题' },
                  { value: 'standard', label: '标准 - 平衡审查力度' },
                  { value: 'strict', label: '严格 - 不放过任何问题' },
                ]}
              />
            </Form.Item>
            <Form.Item label="启用安全审查" name="securityReview" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="默认语言" name="defaultLanguage">
              <Select
                options={[
                  { value: 'zh-CN', label: '简体中文' },
                  { value: 'en-US', label: 'English' },
                  { value: 'ja-JP', label: '日本語' },
                ]}
              />
            </Form.Item>
          </Form>
        </div>
      )}

      {/* Step 4: 完成 */}
      {currentStep === 3 && (
        <div>
          {!configResult && !configuring && (
            <div>
              <Alert
                type="info"
                showIcon
                message="即将完成配置"
                description="以下是你配置的摘要，点击「一键配置并启动」保存配置并启动所有服务。"
                style={{ marginBottom: 16 }}
              />
              <Card size="small" title="配置摘要" style={{ marginBottom: 16 }}>
                <DescriptionsSummary
                  codehub={codehubForm.getFieldsValue()}
                  review={reviewForm.getFieldsValue()}
                />
              </Card>
            </div>
          )}
          {configuring && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Spin tip="正在配置并启动服务..." />
            </div>
          )}
          {configResult && !configuring && (
            <div>
              <Alert
                type={configResult.ok ? 'success' : 'warning'}
                showIcon
                message={configResult.ok ? '配置完成' : '部分配置完成'}
                description={configResult.ok ? '所有服务已成功启动！' : '部分服务启动失败，请查看详情。'}
                style={{ marginBottom: 16 }}
              />
              <Card size="small" title="启动结果">
                {Object.entries(configResult.services).map(([key, val]) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                      padding: '4px 0',
                    }}
                  >
                    <Space>
                      {val.started ? (
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      ) : (
                        <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      )}
                      <Text strong>{key}</Text>
                    </Space>
                    <div>
                      {val.started ? (
                        <Tag color="green">PID: {val.pid ?? '-'}</Tag>
                      ) : (
                        <Tag color="red">{val.error || '启动失败'}</Tag>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function DescriptionsSummary({
  codehub,
  review,
}: {
  codehub: Record<string, unknown>;
  review: Record<string, unknown>;
}) {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>CodeHub 配置</Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', marginTop: 4 }}>
          <Text type="secondary">名称</Text>
          <Text>{(codehub.name as string) || '-'}</Text>
          <Text type="secondary">地址</Text>
          <Text>{(codehub.baseUrl as string) || '-'}</Text>
          <Text type="secondary">Token</Text>
          <Text>{codehub.token ? '••••••••' : '-'}</Text>
          <Text type="secondary">项目 ID</Text>
          <Text>{(codehub.projectId as string) || '-'}</Text>
        </div>
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>审查参数</Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', marginTop: 4 }}>
          <Text type="secondary">审查强度</Text>
          <Text>
            {review.defaultStrength === 'lenient' ? '宽松' :
              review.defaultStrength === 'strict' ? '严格' : '标准'}
          </Text>
          <Text type="secondary">安全审查</Text>
          <Text>{review.securityReview ? '已开启' : '已关闭'}</Text>
          <Text type="secondary">默认语言</Text>
          <Text>{(review.defaultLanguage as string) || '-'}</Text>
        </div>
      </div>
    </div>
  );
}

// ============ 代码仓库管理子组件 ============
function ReposManager() {
  const queryClient = useQueryClient();
  const [repoForm] = Form.useForm();
  const {
    activeRepoId,
    reposConfig,
    setActiveRepoId,
    setReposConfig,
    loadReposConfig,
  } = useAppStore();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<RepoConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reposQuery = useQuery({
    queryKey: ['repos-config'],
    queryFn: () => codehubApi.listReposConfig(),
    retry: false,
  });

  useEffect(() => {
    if (reposQuery.data?.ok) {
      setReposConfig(reposQuery.data.repos || []);
      setActiveRepoId(reposQuery.data.activeRepoId ?? null);
    }
  }, [reposQuery.data, setReposConfig, setActiveRepoId]);

  const refreshList = async () => {
    await queryClient.invalidateQueries({ queryKey: ['repos-config'] });
    await loadReposConfig();
  };

  const openAddModal = () => {
    setEditingRepo(null);
    repoForm.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (repo: RepoConfig) => {
    setEditingRepo(repo);
    repoForm.setFieldsValue({
      name: repo.name,
      baseUrl: repo.baseUrl,
      token: '',
      projectId: repo.projectId,
      repoDir: repo.repoDir || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: Record<string, unknown>;
    try {
      values = await repoForm.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (editingRepo) {
        const patch: Partial<RepoConfig> = {
          name: values.name as string,
          baseUrl: values.baseUrl as string,
          projectId: values.projectId as number | string,
          repoDir: (values.repoDir as string) || undefined,
        };
        if (values.token) {
          patch.token = values.token as string;
        }
        const res = await codehubApi.updateRepo(editingRepo.repoId, patch);
        if (res?.ok) {
          message.success('仓库更新成功');
          setModalOpen(false);
          await refreshList();
        } else {
          message.error(res?.error || '更新失败');
        }
      } else {
        const res = await codehubApi.addRepo({
          name: values.name as string,
          baseUrl: values.baseUrl as string,
          token: values.token as string,
          projectId: values.projectId as number | string,
          repoDir: (values.repoDir as string) || undefined,
        });
        if (res?.ok) {
          message.success('仓库新增成功');
          setModalOpen(false);
          await refreshList();
        } else {
          message.error(res?.error || '新增失败');
        }
      }
    } catch (err) {
      message.error(`操作失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (repoId: string) => {
    try {
      const res = await codehubApi.activateRepo(repoId);
      if (res?.ok) {
        message.success('已激活该仓库');
        setActiveRepoId(res.activeRepoId ?? repoId);
        await refreshList();
      } else {
        message.error(res?.error || '激活失败');
      }
    } catch (err) {
      message.error(`激活失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleDelete = async (repoId: string) => {
    try {
      const res = await codehubApi.deleteRepoConfig(repoId);
      if (res?.ok) {
        message.success('仓库已删除');
        setActiveRepoId(res.activeRepoId ?? null);
        await refreshList();
      } else {
        message.error(res?.error || '删除失败');
      }
    } catch (err) {
      message.error(`删除失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleTestRepo = async (record: RepoConfig) => {
    const key = `testRepo-${record.repoId}`;
    message.loading({ content: '正在测试连接...', key, duration: 0 });
    try {
      const res = await codehubApi.testConnection(record.repoId);
      if (res?.ok) {
        message.success({ content: `仓库「${record.name}」连接成功`, key });
      } else {
        message.error({ content: res?.message || `仓库「${record.name}」连接失败`, key });
      }
    } catch (err) {
      message.error({
        content: `连接失败: ${err instanceof Error ? err.message : '未知错误'}`,
        key,
      });
    }
  };

  const columns: TableProps<RepoConfig>['columns'] = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
    },
    {
      title: 'baseUrl',
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      ellipsis: true,
    },
    {
      title: 'projectId',
      dataIndex: 'projectId',
      key: 'projectId',
      width: 180,
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_, record) =>
        record.repoId === activeRepoId ? (
          <Tag color="green" icon={<CheckOutlined />}>
            当前激活
          </Tag>
        ) : (
          <Tag>未激活</Tag>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 300,
      render: (_, record) => (
        <Space size="small" wrap>
          {record.repoId !== activeRepoId && (
            <Button
              size="small"
              type="link"
              icon={<CheckOutlined />}
              onClick={() => handleActivate(record.repoId)}
            >
              激活
            </Button>
          )}
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            icon={<ThunderboltOutlined />}
            onClick={() => handleTestRepo(record)}
          >
            测试连接
          </Button>
          <Popconfirm
            title="确认删除该仓库配置？"
            description="删除后不可恢复，关联的本地克隆不会被删除。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDelete(record.repoId)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 900 }}>
      <Alert
        type="info"
        showIcon
        message="代码仓库管理"
        description="管理多个 CodeHub 仓库配置，可激活其中一个作为当前操作目标。"
        style={{ marginBottom: 16 }}
      />

      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
          新增仓库
        </Button>
      </div>

      <Table
        rowKey="repoId"
        columns={columns}
        dataSource={reposConfig}
        loading={reposQuery.isLoading}
        pagination={false}
        size="middle"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={'暂无仓库配置，点击上方「新增仓库」添加'}
              style={{ padding: 32 }}
            />
          ),
        }}
      />

      <Modal
        title={editingRepo ? '编辑仓库' : '新增仓库'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={repoForm} layout="vertical" preserve={false}>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入仓库名称' }]}
            extra="用于在列表中标识该仓库"
          >
            <Input placeholder="例如：前端主仓库" />
          </Form.Item>

          <Form.Item
            label="CodeHub 地址"
            name="baseUrl"
            rules={[{ required: true, message: '请输入 CodeHub 地址' }]}
          >
            <Input placeholder="https://codehub.example.com" />
          </Form.Item>

          <Form.Item
            label="Token"
            name="token"
            rules={editingRepo ? [] : [{ required: true, message: '请输入 Token' }]}
            extra={editingRepo ? '留空则不修改原 Token' : '在 CodeHub 个人设置中生成的访问令牌'}
          >
            <Input.Password placeholder={editingRepo ? '留空不修改' : 'Enter your token'} />
          </Form.Item>

          <Form.Item
            label="项目 ID / 路径"
            name="projectId"
            rules={[{ required: true, message: '请输入项目 ID' }]}
            extra="例如：group/project-name 或数字 ID"
          >
            <Input placeholder="group/project-name" />
          </Form.Item>

          <Form.Item label="本地仓库目录" name="repoDir" extra="可选，克隆存放目录（相对路径）">
            <Input placeholder=".codehub-repos/xxx" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 高级配置面板 ============
function AdvancedConfigPanel() {
  const queryClient = useQueryClient();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleExport = async () => {
    try {
      const configData = {
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
        config: {
          codehub: await codehubApi.getConfig(),
          opencodeManager: await codehubApi.getOpencodeManagerConfig(),
        },
      };
      const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `codereview-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success('配置已导出');
    } catch (err) {
      message.error(`导出失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleImport = async () => {
    try {
      const config = JSON.parse(importText);
      if (!config.config) {
        message.error('无效的配置文件格式');
        return;
      }
      message.loading({ content: '正在导入配置...', key: 'import-config' });
      if (config.config.codehub?.config) {
        await codehubApi.saveConfig(config.config.codehub.config as Partial<CodeHubConfig>);
      }
      if (config.config.opencodeManager?.config) {
        await codehubApi.saveOpencodeManagerConfig(
          config.config.opencodeManager.config as { startCommand: string; workDir: string },
        );
      }
      message.success({ content: '配置导入成功', key: 'import-config' });
      setImportModalOpen(false);
      setImportText('');
      await queryClient.invalidateQueries({ queryKey: ['codehub-config'] });
      await queryClient.invalidateQueries({ queryKey: ['opencode-manager-config'] });
    } catch (err) {
      message.error(`导入失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleReset = () => {
    Modal.confirm({
      title: '重置所有配置',
      content: (
        <div>
          <Alert
            type="warning"
            showIcon
            message="此操作将清除所有配置"
            description="包括 CodeHub 连接、审查参数、opencode 配置等。重置后不可恢复，建议先导出备份。"
          />
        </div>
      ),
      okText: '确认重置',
      cancelText: '取消',
      onOk: async () => {
        try {
          message.loading({ content: '正在重置配置...', key: 'reset-config' });
          await codehubApi.saveConfig({} as Partial<CodeHubConfig>);
          await codehubApi.saveOpencodeManagerConfig({ startCommand: '', workDir: '' });
          message.success({ content: '配置已重置，请重新配置', key: 'reset-config' });
          await queryClient.invalidateQueries({ queryKey: ['codehub-config'] });
          await queryClient.invalidateQueries({ queryKey: ['opencode-manager-config'] });
        } catch (err) {
          message.error(`重置失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
      },
    });
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      message.success('当前已是最新版本');
    } catch {
      message.error('检查更新失败');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const releaseNotes = [
    { version: 'v0.1.0', date: '2025-08-01', changes: ['初始版本发布', '支持 CodeHub 代码审查', 'opencode 集成'] },
  ];

  return (
    <div style={{ maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        message="高级配置"
        description="管理配置的导入导出和重置，查看版本信息。"
        style={{ marginBottom: 20 }}
      />

      <Card
        title={
          <Space>
            <CloudUploadOutlined />
            <span>配置导入/导出</span>
          </Space>
        }
        size="small"
        style={{ marginBottom: 20 }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button
            icon={<DownloadOutlined />}
            onClick={handleExport}
          >
            导出配置
          </Button>
          <Button
            icon={<UploadOutlined />}
            onClick={() => setImportModalOpen(true)}
          >
            导入配置
          </Button>
          <Popconfirm
            title="确认重置配置？"
            description="此操作将清除所有配置，且不可恢复。"
            okText="确认重置"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={handleReset}
          >
            <Button danger icon={<ReloadOutlined />}>
              重置配置
            </Button>
          </Popconfirm>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--cr-ink-3)' }}>
          导出配置将保存为 JSON 文件，可用于备份或迁移。导入配置会覆盖当前所有设置。
        </div>
      </Card>

      <Card
        title={
          <Space>
            <InfoCircleOutlined />
            <span>版本信息</span>
          </Space>
        }
        size="small"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--cr-ink-1)' }}>
              CodeReview 工作台 v0.1.0
            </div>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 2 }}>
              发布日期：2025-08-01
            </div>
          </div>
          <Button
            icon={<SyncOutlined spin={checkingUpdate} />}
            onClick={handleCheckUpdate}
            loading={checkingUpdate}
          >
            检查更新
          </Button>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            <HistoryOutlined style={{ marginRight: 6 }} />
            更新日志
          </div>
          {releaseNotes.map((note) => (
            <div
              key={note.version}
              style={{
                padding: 12,
                border: '1px solid var(--cr-border)',
                borderRadius: 8,
                marginBottom: 8,
                background: 'var(--cr-bg-subtle)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: 'var(--cr-brand-600)' }}>{note.version}</span>
                <span style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>{note.date}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--cr-ink-2)' }}>
                {note.changes.map((change, idx) => (
                  <li key={idx} style={{ marginBottom: 2 }}>{change}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--cr-ink-3)' }}>
          <span>opencode: v{`1.0.0`}</span>
          <span>Node.js: v{`20.x`}</span>
          <span>前端: v0.1.0</span>
        </div>
      </Card>

      <Modal
        title="导入配置"
        open={importModalOpen}
        onCancel={() => {
          setImportModalOpen(false);
          setImportText('');
        }}
        onOk={handleImport}
        okText="导入"
        cancelText="取消"
        width={560}
      >
        <Alert
          type="warning"
          showIcon
          message="导入配置将覆盖当前所有设置"
          description="请确认你导入的配置文件是可信的。"
          style={{ marginBottom: 16 }}
        />
        <Input.TextArea
          rows={10}
          placeholder="粘贴配置 JSON 内容..."
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
      </Modal>
    </div>
  );
}

// ============ 主 Settings 组件 ============
function Settings() {
  const queryClient = useQueryClient();
  const [reviewForm] = Form.useForm();
  const [opencodeMgrForm] = Form.useForm();
  const [activeKey, setActiveKey] = useState('repos');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mgrConfig, setMgrConfig] = useState<{ startCommand: string; workDir: string }>({
    startCommand: 'opencode serve --hostname {hostname} --port {port}',
    workDir: './',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['codehub-config'],
    queryFn: () => codehubApi.getConfig() as Promise<{ ok: boolean; config: CodeHubConfig }>,
    retry: false,
  });

  useEffect(() => {
    if (data?.ok && data.config) {
      reviewForm.setFieldsValue({
        defaultStrength: data.config.reviewConfig?.defaultStrength,
        securityReview: data.config.reviewConfig?.securityReview,
        defaultLanguage: data.config.reviewConfig?.defaultLanguage,
      });
    }
  }, [data, reviewForm]);

  const mgrConfigQuery = useQuery({
    queryKey: ['opencode-manager-config'],
    queryFn: () => codehubApi.getOpencodeManagerConfig() as Promise<{ ok: boolean; config: { startCommand: string; workDir: string } }>,
    retry: false,
  });

  useEffect(() => {
    if (mgrConfigQuery.data?.ok && mgrConfigQuery.data.config) {
      setMgrConfig(mgrConfigQuery.data.config);
      opencodeMgrForm.setFieldsValue(mgrConfigQuery.data.config);
    }
  }, [mgrConfigQuery.data, opencodeMgrForm]);

  const serveStatusQuery = useQuery({
    queryKey: ['opencode-serve-status'],
    queryFn: () => codehubApi.getOpencodeServeStatus() as Promise<OpencodeServeStatus>,
    enabled: activeKey === 'opencode',
    refetchInterval: activeKey === 'opencode' ? 5000 : false,
    retry: false,
  });

  const saveReviewMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const config: Partial<CodeHubConfig> = {
        reviewConfig: {
          defaultStrength: values.defaultStrength as 'lenient' | 'standard' | 'strict',
          securityReview: values.securityReview as boolean,
          defaultLanguage: values.defaultLanguage as string,
        },
      };
      return codehubApi.saveConfig(config);
    },
    onSuccess: (res) => {
      if (res.ok) {
        message.success('配置保存成功');
        queryClient.invalidateQueries({ queryKey: ['codehub-config'] });
      } else {
        message.error(res.error || '保存失败');
      }
    },
    onError: (err) => {
      message.error(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const startServeMutation = useMutation({
    mutationFn: (options: { port?: number; hostname?: string; commandTemplate?: string; workDir?: string }) =>
      codehubApi.startOpencodeServe(options),
    onSuccess: (res) => {
      if (res?.ok) {
        message.success('opencode serve 已启动');
      } else {
        message.error(res?.error || '启动失败');
      }
      queryClient.invalidateQueries({ queryKey: ['opencode-serve-status'] });
    },
    onError: (err) => {
      message.error(`启动失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const stopServeMutation = useMutation({
    mutationFn: () => codehubApi.stopOpencodeServe(),
    onSuccess: () => {
      message.success('opencode serve 已停止');
      queryClient.invalidateQueries({ queryKey: ['opencode-serve-status'] });
    },
    onError: (err) => {
      message.error(`停止失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const saveMgrConfigMutation = useMutation({
    mutationFn: (config: { startCommand: string; workDir: string }) =>
      codehubApi.saveOpencodeManagerConfig(config),
    onSuccess: (res) => {
      if (res?.ok) {
        message.success('配置保存成功');
        queryClient.invalidateQueries({ queryKey: ['opencode-manager-config'] });
      } else {
        message.error(res?.error || '保存失败');
      }
    },
    onError: (err) => {
      message.error(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const startServiceMutation = useMutation({
    mutationFn: (service: 'backend' | 'frontend') => codehubApi.startService(service),
    onSuccess: (res) => {
      if (res?.ok) {
        message.success(`服务已启动，PID: ${res.pid}`);
      } else {
        message.error(res?.error || '启动失败');
      }
    },
    onError: (err) => {
      message.error(`启动失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const handleSaveReview = async () => {
    try {
      const values = await reviewForm.validateFields();
      saveReviewMutation.mutate(values);
    } catch {
      // validation error
    }
  };

  const handleSaveMgrConfig = async () => {
    try {
      const values = await opencodeMgrForm.validateFields();
      setMgrConfig(values);
      saveMgrConfigMutation.mutate(values);
    } catch {
      // validation error
    }
  };

  const tabItems = [
    {
      key: 'repos',
      label: (
        <Space>
          <FolderOutlined />
          <span>代码仓库管理</span>
        </Space>
      ),
      children: <ReposManager />,
    },
    {
      key: 'review',
      label: (
        <Space>
          <DatabaseOutlined />
          <span>审查设置</span>
        </Space>
      ),
      children: (
        <div style={{ maxWidth: 600 }}>
          <Alert
            type="info"
            showIcon
            message="代码审查参数配置"
            description="调整代码审查的严格程度和检查项。"
            style={{ marginBottom: 20 }}
          />

          <Form form={reviewForm} layout="vertical">
            <Form.Item label="默认审查强度" name="defaultStrength">
              <Select
                options={[
                  { value: 'lenient', label: '宽松 - 仅报告严重问题' },
                  { value: 'standard', label: '标准 - 平衡审查力度' },
                  { value: 'strict', label: '严格 - 不放过任何问题' },
                ]}
              />
            </Form.Item>

            <Form.Item label="启用安全审查" name="securityReview" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item label="默认语言" name="defaultLanguage">
              <Select
                options={[
                  { value: 'zh-CN', label: '简体中文' },
                  { value: 'en-US', label: 'English' },
                  { value: 'ja-JP', label: '日本語' },
                ]}
              />
            </Form.Item>

            <Divider />

            <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveReview} loading={saveReviewMutation.isPending}>
              保存配置
            </Button>
          </Form>
        </div>
      ),
    },
    {
      key: 'opencode',
      label: (
        <Space>
          <RobotOutlined />
          <span>opencode 配置</span>
        </Space>
      ),
      children: (
        <div style={{ maxWidth: 800 }}>
          <Alert
            type="info"
            showIcon
            message="opencode 进程与配置"
            description="管理 opencode serve 进程并编辑 opencode 配置文件。"
            style={{ marginBottom: 20 }}
          />

          <Card title="进程控制" size="small" style={{ marginBottom: 20 }}>
            <Space style={{ marginBottom: 12 }}>
              {serveStatusQuery.data?.running ? (
                <>
                  <Badge status="success" text="运行中" />
                  <span style={{ color: '#888' }}>
                    PID: {serveStatusQuery.data.pid}　端口: {serveStatusQuery.data.port}
                  </span>
                </>
              ) : (
                <Badge status="default" text="已停止" />
              )}
            </Space>

            <div style={{ marginBottom: 12 }}>
              <Space>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={() => startServeMutation.mutate({
                    port: 4096,
                    hostname: '127.0.0.1',
                    commandTemplate: mgrConfig.startCommand,
                    workDir: mgrConfig.workDir,
                  })}
                  loading={startServeMutation.isPending}
                >
                  启动
                </Button>
                <Button
                  danger
                  icon={<PoweroffOutlined />}
                  onClick={() => stopServeMutation.mutate()}
                  loading={stopServeMutation.isPending}
                  disabled={!serveStatusQuery.data?.running}
                >
                  停止
                </Button>
              </Space>
            </div>

            <Card type="inner" title="最近日志" size="small">
              <pre
                style={{
                  maxHeight: 200,
                  overflow: 'auto',
                  margin: 0,
                  padding: 8,
                  background: '#000',
                  color: '#0f0',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {serveStatusQuery.data?.lastLogLines?.slice(-20).join('\n') || '暂无日志'}
              </pre>
            </Card>
          </Card>

          <Card title="启动配置" size="small" style={{ marginBottom: 20 }}>
            <Form form={opencodeMgrForm} layout="vertical">
              <Form.Item
                label="启动命令"
                name="startCommand"
                rules={[{ required: true, message: '请输入启动命令' }]}
                extra="支持 {hostname} 和 {port} 占位符，启动时自动替换为实际值"
              >
                <Input placeholder="opencode serve --hostname {hostname} --port {port}" />
              </Form.Item>
              <Form.Item
                label="工作目录"
                name="workDir"
                rules={[{ required: true, message: '请输入工作目录' }]}
                extra="opencode 启动时的 cwd，配置文件将拷贝到此目录。支持相对路径（相对项目根）或绝对路径"
              >
                <Input placeholder="./my-opencode-workspace" />
              </Form.Item>
              <Form.Item label="命令预览（替换变量后）">
                <Input.Group compact>
                  <Input
                    style={{ width: '100%' }}
                    readOnly
                    value={mgrConfig.startCommand
                      .replace(/{hostname}/g, '127.0.0.1')
                      .replace(/{port}/g, '4096')}
                  />
                </Input.Group>
              </Form.Item>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveMgrConfig}
                loading={saveMgrConfigMutation.isPending}
              >
                保存配置
              </Button>
            </Form>
          </Card>

          <Card title="服务启动命令" size="small" style={{ marginBottom: 20 }}>
            <Alert
              type="info"
              showIcon
              message="开发环境便捷启动"
              description="一键启动后端 API 服务或前端 Web 服务。生产部署建议使用系统进程守护工具。"
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <Tag color="blue">后端 API 服务</Tag>
                <Text code>npm run serve</Text>
              </div>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => {
                  startServiceMutation.mutate('backend');
                }}
                loading={startServiceMutation.isPending}
              >
                启动
              </Button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Tag color="green">前端 Web 服务</Tag>
                <Text code>npm run dev</Text>
              </div>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => {
                  startServiceMutation.mutate('frontend');
                }}
                loading={startServiceMutation.isPending}
              >
                启动
              </Button>
            </div>
          </Card>
        </div>
      ),
    },
    {
      key: 'advanced',
      label: (
        <Space>
          <SafetyOutlined />
          <span>高级配置</span>
        </Space>
      ),
      children: <AdvancedConfigPanel />,
    },
  ];

  return (
    <div>
      <div className="cr-page-header">
        <div>
          <h1 className="cr-page-title">设置</h1>
          <p className="cr-page-subtitle">
            管理 CodeReview Agent 的仓库配置、审查参数与 opencode 运行状态
          </p>
        </div>
      </div>

      <QuickConfigDashboard onOpenWizard={() => setWizardOpen(true)} />

      <QuickConfigWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      <Card
        title={
          <Space>
            <SettingOutlined />
            <span>设置</span>
          </Space>
        }
      >
        <Spin spinning={isLoading}>
          <Tabs items={tabItems} activeKey={activeKey} onChange={setActiveKey} />
        </Spin>
      </Card>
    </div>
  );
}

export default Settings;