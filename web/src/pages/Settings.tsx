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
  Table,
  Modal,
  Popconfirm,
  Empty,
} from 'antd';
import type { TableProps } from 'antd';
import {
  SettingOutlined,
  SaveOutlined,
  ApiOutlined,
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
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { codehubApi, type CodeHubConfig, type RepoConfig } from '@/api/codehub';
import { useAppStore } from '@/store/app';

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

// 代码仓库管理子组件：表格 + 新增/编辑 Modal + 激活/删除/测试连接
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

  // 拉取多仓配置列表
  const reposQuery = useQuery({
    queryKey: ['repos-config'],
    queryFn: () => codehubApi.listReposConfig(),
    retry: false,
  });

  // 查询结果同步到 store
  useEffect(() => {
    if (reposQuery.data?.ok) {
      setReposConfig(reposQuery.data.repos || []);
      setActiveRepoId(reposQuery.data.activeRepoId ?? null);
    }
  }, [reposQuery.data, setReposConfig, setActiveRepoId]);

  // 刷新列表：失效缓存触发重新拉取，并同步 store
  const refreshList = async () => {
    await queryClient.invalidateQueries({ queryKey: ['repos-config'] });
    await loadReposConfig();
  };

  // 打开新增 Modal
  const openAddModal = () => {
    setEditingRepo(null);
    repoForm.resetFields();
    setModalOpen(true);
  };

  // 打开编辑 Modal（回填，token 留空提示"留空不修改"）
  const openEditModal = (repo: RepoConfig) => {
    setEditingRepo(repo);
    repoForm.setFieldsValue({
      name: repo.name,
      baseUrl: repo.baseUrl,
      token: '', // 脱敏：留空不修改
      projectId: repo.projectId,
      repoDir: repo.repoDir || '',
    });
    setModalOpen(true);
  };

  // 提交新增 / 编辑
  const handleSubmit = async () => {
    let values: Record<string, unknown>;
    try {
      values = await repoForm.validateFields();
    } catch {
      // 校验失败由 antd 表单内联提示，不额外 message
      return;
    }
    setSubmitting(true);
    try {
      if (editingRepo) {
        // 编辑：token 留空则不传，保持原值
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

  // 激活仓库：成功后同步 store + 刷新列表
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

  // 删除仓库：后端会自动切换 active，前端刷新后同步 store
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

  // 测试连接：对选中仓库发起连接测试
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
