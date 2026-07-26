import { useState, useEffect } from 'react';
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
} from 'antd';
import {
  SettingOutlined,
  SaveOutlined,
  ApiOutlined,
  DatabaseOutlined,
  RobotOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { codehubApi, type CodeHubConfig } from '@/api/codehub';

const { TextArea } = Input;

interface OpencodeAgent {
  description?: string;
  prompt?: string;
  tools?: Record<string, boolean>;
}

interface OpencodeMcp {
  enabled?: boolean;
  [key: string]: unknown;
}

interface OpencodeConfig {
  model?: string;
  agents?: Record<string, OpencodeAgent>;
  mcp?: Record<string, OpencodeMcp>;
}

interface OpencodeServeStatus {
  running: boolean;
  pid?: number;
  port?: number;
  hostname?: string;
  startedAt?: string;
  lastLogLines: string[];
}

function Settings() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [opencodeForm] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [activeKey, setActiveKey] = useState('codehub');
  const [agents, setAgents] = useState<Array<[string, OpencodeAgent]>>([]);
  const [mcpList, setMcpList] = useState<Array<[string, OpencodeMcp]>>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['codehub-config'],
    queryFn: () => codehubApi.getConfig() as Promise<{ ok: boolean; config: CodeHubConfig }>,
    retry: false,
  });

  useEffect(() => {
    if (data?.ok && data.config) {
      form.setFieldsValue({
        baseUrl: data.config.baseUrl,
        token: data.config.token,
        projectId: data.config.projectId,
        repoBaseDir: data.config.repoBaseDir,
        defaultStrength: data.config.reviewConfig?.defaultStrength,
        securityReview: data.config.reviewConfig?.securityReview,
        defaultLanguage: data.config.reviewConfig?.defaultLanguage,
      });
    }
  }, [data, form]);

  const opencodeConfigQuery = useQuery({
    queryKey: ['opencode-config'],
    queryFn: () =>
      codehubApi.getOpencodeConfig() as Promise<{ ok: boolean; config: OpencodeConfig }>,
    retry: false,
  });

  useEffect(() => {
    if (opencodeConfigQuery.data?.ok && opencodeConfigQuery.data.config) {
      const cfg = opencodeConfigQuery.data.config;
      opencodeForm.setFieldsValue({ model: cfg.model });
      setAgents(
        cfg.agents ? (Object.entries(cfg.agents) as Array<[string, OpencodeAgent]>) : [],
      );
      setMcpList(cfg.mcp ? (Object.entries(cfg.mcp) as Array<[string, OpencodeMcp]>) : []);
    }
  }, [opencodeConfigQuery.data, opencodeForm]);

  const serveStatusQuery = useQuery({
    queryKey: ['opencode-serve-status'],
    queryFn: () => codehubApi.getOpencodeServeStatus() as Promise<OpencodeServeStatus>,
    enabled: activeKey === 'opencode',
    refetchInterval: activeKey === 'opencode' ? 5000 : false,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const config: Partial<CodeHubConfig> = {
        baseUrl: values.baseUrl as string,
        token: values.token as string,
        projectId: values.projectId as string,
        repoBaseDir: values.repoBaseDir as string,
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
    mutationFn: (options: { port?: number; hostname?: string }) =>
      codehubApi.startOpencodeServe(options),
    onSuccess: () => {
      message.success('opencode serve 已启动');
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

  const saveOpencodeMutation = useMutation({
    mutationFn: (config: OpencodeConfig) => codehubApi.saveOpencodeConfig(config),
    onSuccess: (res) => {
      if (res?.ok) {
        message.success('配置保存成功');
        queryClient.invalidateQueries({ queryKey: ['opencode-config'] });
      } else {
        message.error(res?.error || '保存失败');
      }
    },
    onError: (err) => {
      message.error(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const values = form.getFieldsValue();
      const tempConfig = {
        baseUrl: values.baseUrl,
        token: values.token,
        projectId: values.projectId,
      };
      await codehubApi.saveConfig(tempConfig);
      const res = await codehubApi.testConnection();
      setTestResult({ ok: res.ok, message: res.message });
      if (res.ok) {
        message.success('连接成功');
      } else {
        message.error(`连接失败: ${res.message}`);
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : '未知错误' });
      message.error(`连接失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      saveMutation.mutate(values);
    } catch {
      // validation error
    }
  };

  const updateAgent = (name: string, field: 'description' | 'prompt', value: string) => {
    setAgents((prev) =>
      prev.map(([key, agent]) =>
        key === name ? [key, { ...agent, [field]: value }] : [key, agent],
      ),
    );
  };

  const updateMcpEnabled = (name: string, enabled: boolean) => {
    setMcpList((prev) =>
      prev.map(([key, mcp]) => (key === name ? [key, { ...mcp, enabled }] : [key, mcp])),
    );
  };

  const handleSaveOpencode = async () => {
    try {
      const values = await opencodeForm.validateFields();
      const config: OpencodeConfig = {
        model: values.model as string,
        agents: Object.fromEntries(agents),
        mcp: Object.fromEntries(mcpList),
      };
      saveOpencodeMutation.mutate(config);
    } catch {
      // validation error
    }
  };

  const tabItems = [
    {
      key: 'codehub',
      label: (
        <Space>
          <ApiOutlined />
          <span>CodeHub 配置</span>
        </Space>
      ),
      children: (
        <div style={{ maxWidth: 600 }}>
          <Alert
            type="info"
            showIcon
            message="配置 CodeHub 连接信息"
            description="配置后可以拉取 MR 列表、查看 diff、发表评论等。"
            style={{ marginBottom: 20 }}
          />

          {testResult && (
            <Alert
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              message={testResult.ok ? '连接测试成功' : '连接测试失败'}
              description={testResult.message}
              style={{ marginBottom: 20 }}
              closable
              onClose={() => setTestResult(null)}
            />
          )}

          <Form form={form} layout="vertical">
            <Form.Item
              label="CodeHub 地址"
              name="baseUrl"
              rules={[{ required: true, message: '请输入 CodeHub 地址' }]}
              extra="例如: https://codehub.example.com"
            >
              <Input placeholder="https://codehub.example.com" />
            </Form.Item>

            <Form.Item
              label="Personal Access Token"
              name="token"
              rules={[{ required: true, message: '请输入 Token' }]}
              extra="在 CodeHub 个人设置中生成的访问令牌，需要 repo 相关权限"
            >
              <Input.Password placeholder="Enter your token" />
            </Form.Item>

            <Form.Item
              label="项目 ID / 路径"
              name="projectId"
              rules={[{ required: true, message: '请输入项目 ID' }]}
              extra="例如: group/project-name 或数字 ID"
            >
              <Input placeholder="group/project-name" />
            </Form.Item>

            <Form.Item label="本地仓库目录" name="repoBaseDir" extra="克隆的代码仓库存放目录（相对路径）">
              <Input placeholder=".codehub-repos" />
            </Form.Item>

            <Divider />

            <Space>
              <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saveMutation.isPending}>
                保存配置
              </Button>
              <Button icon={<ApiOutlined />} onClick={handleTest} loading={testing}>
                测试连接
              </Button>
            </Space>
          </Form>
        </div>
      ),
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

          <Form form={form} layout="vertical">
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

            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saveMutation.isPending}>
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
                  onClick={() => startServeMutation.mutate({ port: 4096 })}
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

          <Card title="配置编辑" size="small">
            <Spin spinning={opencodeConfigQuery.isLoading}>
              <Form form={opencodeForm} layout="vertical">
                <Form.Item label="model" name="model">
                  <Input placeholder="anthropic/claude-sonnet-4-5" />
                </Form.Item>

                <Divider>Agents</Divider>

                {agents.length === 0 && (
                  <span style={{ color: '#888' }}>无 agents 配置</span>
                )}

                {agents.map(([name, agent]) => (
                  <Card
                    key={name}
                    type="inner"
                    title={name}
                    size="small"
                    style={{ marginBottom: 12 }}
                  >
                    <Form.Item label="description">
                      <Input
                        value={agent.description || ''}
                        onChange={(e) => updateAgent(name, 'description', e.target.value)}
                        placeholder="agent 描述"
                      />
                    </Form.Item>
                    <Form.Item label="prompt">
                      <TextArea
                        rows={4}
                        value={agent.prompt || ''}
                        onChange={(e) => updateAgent(name, 'prompt', e.target.value)}
                        placeholder="agent prompt"
                      />
                    </Form.Item>
                    <Form.Item label="tools">
                      <Space wrap>
                        {agent.tools && Object.keys(agent.tools).length > 0 ? (
                          Object.entries(agent.tools).map(([tool, enabled]) => (
                            <Tag key={tool}>
                              {tool}: {String(enabled)}
                            </Tag>
                          ))
                        ) : (
                          <span style={{ color: '#888' }}>无 tools</span>
                        )}
                      </Space>
                    </Form.Item>
                  </Card>
                ))}

                <Divider>MCP</Divider>

                {mcpList.length === 0 && (
                  <span style={{ color: '#888' }}>无 MCP 配置</span>
                )}

                {mcpList.map(([name, mcp]) => (
                  <div
                    key={name}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                    }}
                  >
                    <span>{name}</span>
                    <Switch
                      checked={mcp.enabled === true}
                      onChange={(checked) => updateMcpEnabled(name, checked)}
                    />
                  </div>
                ))}

                <Divider />

                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSaveOpencode}
                  loading={saveOpencodeMutation.isPending}
                >
                  保存配置
                </Button>
              </Form>
            </Spin>
          </Card>
        </div>
      ),
    },
  ];

  return (
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
  );
}

export default Settings;
