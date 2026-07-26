import { useState } from 'react';
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
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  MergeOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { codehubApi, type CodeHubMR } from '@/api/codehub';

const stateColorMap: Record<string, string> = {
  open: 'processing',
  merged: 'success',
  closed: 'default',
  locked: 'warning',
};

const stateIconMap: Record<string, React.ReactNode> = {
  open: <PlayCircleOutlined style={{ color: '#1677ff' }} />,
  merged: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  closed: <CloseCircleOutlined style={{ color: '#8c8c8c' }} />,
  locked: <MergeOutlined style={{ color: '#faad14' }} />,
};

function MRList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'open' | 'closed' | 'merged' | 'all'>('open');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mrs', state, page, pageSize, searchText],
    queryFn: () =>
      codehubApi.getMRList({
        state,
        page,
        per_page: pageSize,
        search: searchText || undefined,
        order_by: 'updated_at',
        sort: 'desc',
      }) as Promise<{ ok: boolean; mrs: CodeHubMR[]; total: number; page: number; perPage: number; totalPages: number }>,
    retry: false,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['mrs'] });
    refetch();
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
      width: 120,
      render: (_: unknown, record: CodeHubMR) => (
        <Space>
          <Button type="link" size="small" onClick={() => navigate(`/mrs/${record.iid}`)}>
            查看
          </Button>
        </Space>
      ),
    },
  ];

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
        />
      </Spin>
    </Card>
  );
}

export default MRList;
