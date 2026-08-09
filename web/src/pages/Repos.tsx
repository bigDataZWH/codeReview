import { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Tooltip,
  Empty,
} from 'antd';
import {
  FolderOutlined,
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  CloudDownloadOutlined,
  SyncOutlined,
  DownOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { codehubApi, type RepoInfo } from '@/api/codehub';

function formatSize(bytes?: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function Repos() {
  const queryClient = useQueryClient();
  const [cloneModalVisible, setCloneModalVisible] = useState(false);
  const [checkoutModalVisible, setCheckoutModalVisible] = useState(false);
  const [currentRepo, setCurrentRepo] = useState<string | null>(null);
  const [cloneForm] = Form.useForm();
  const [checkoutForm] = Form.useForm();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['repos'],
    queryFn: () => codehubApi.getRepos() as Promise<{ ok: boolean; repos: RepoInfo[]; count: number }>,
    retry: false,
  });

  const cloneMutation = useMutation({
    mutationFn: (data: { projectId: string; branch?: string; depth?: number }) =>
      codehubApi.cloneRepo(data.projectId, { branch: data.branch, depth: data.depth }),
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
      message.success('拉取成功');
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
    onError: (err) => {
      message.error(`拉取失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const pullMutation = useMutation({
    mutationFn: (projectId: string) => codehubApi.pullRepo(projectId),
    onSuccess: () => {
      message.success('更新成功');
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
    onError: (err) => {
      message.error(`更新失败: ${err instanceof Error ? err.message : '未知错误'}`);
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
    mutationFn: (data: { projectId: string; branch: string }) =>
      codehubApi.checkoutBranch(data.projectId, data.branch),
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

  const columns = [
    {
      title: '项目',
      dataIndex: 'projectId',
      key: 'projectId',
      render: (id: string, record: RepoInfo) => (
        <Space>
          <FolderOutlined style={{ color: '#1677ff' }} />
          <span style={{ fontFamily: 'monospace' }}>{record.projectName || id}</span>
        </Space>
      ),
    },
    {
      title: '当前分支',
      dataIndex: 'currentBranch',
      key: 'currentBranch',
      width: 140,
      render: (branch: string) => (
        <Tag color="blue">
          <SwapOutlined /> {branch}
        </Tag>
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
          <Tooltip title="拉取更新">
            <Button
              type="text"
              size="small"
              icon={<CloudDownloadOutlined />}
              loading={fetchMutation.isPending && fetchMutation.variables === record.projectId}
              onClick={() => fetchMutation.mutate(record.projectId)}
            >
              Fetch
            </Button>
          </Tooltip>
          <Tooltip title="Pull 更新">
            <Button
              type="text"
              size="small"
              icon={<DownOutlined />}
              loading={pullMutation.isPending && pullMutation.variables === record.projectId}
              onClick={() => pullMutation.mutate(record.projectId)}
            >
              Pull
            </Button>
          </Tooltip>
          <Tooltip title="切换分支">
            <Button
              type="text"
              size="small"
              icon={<SwapOutlined />}
              onClick={() => {
                setCurrentRepo(record.projectId);
                checkoutForm.setFieldsValue({ branch: record.currentBranch });
                setCheckoutModalVisible(true);
              }}
            >
              切换
            </Button>
          </Tooltip>
          <Popconfirm
            title="确定删除本地仓库？"
            description="这将删除本地克隆的仓库目录，操作不可恢复。"
            onConfirm={() => deleteMutation.mutate(record.projectId)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title={
          <Space>
            <FolderOutlined />
            <span>代码仓库</span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCloneModalVisible(true)}>
              克隆仓库
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="projectId"
          columns={columns}
          dataSource={data?.repos ?? []}
          loading={isLoading}
          size="middle"
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={'暂无本地仓库，点击右上角「克隆仓库」开始'}
                style={{ padding: 32 }}
              />
            ),
          }}
        />
      </Card>

      <Modal
        title="克隆仓库"
        open={cloneModalVisible}
        onOk={handleClone}
        onCancel={() => setCloneModalVisible(false)}
        confirmLoading={cloneMutation.isPending}
        okText="克隆"
        width={500}
      >
        <Form form={cloneForm} layout="vertical">
          <Form.Item
            label="项目 ID / 路径"
            name="projectId"
            rules={[{ required: true, message: '请输入项目 ID' }]}
          >
            <Input placeholder="例如: group/project-name" />
          </Form.Item>
          <Form.Item label="分支（可选）" name="branch">
            <Input placeholder="留空则使用默认分支" />
          </Form.Item>
          <Form.Item label="克隆深度（可选）" name="depth">
            <InputNumber min={1} placeholder="浅克隆深度，留空则完整克隆" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="切换分支"
        open={checkoutModalVisible}
        onOk={handleCheckout}
        onCancel={() => setCheckoutModalVisible(false)}
        confirmLoading={checkoutMutation.isPending}
        okText="切换"
        width={400}
      >
        <Form form={checkoutForm} layout="vertical">
          <Form.Item
            label="目标分支"
            name="branch"
            rules={[{ required: true, message: '请输入分支名' }]}
          >
            <Input placeholder="分支名称" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default Repos;
