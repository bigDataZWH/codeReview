import { useState, useMemo } from 'react';
import {
  Card,
  Tag,
  Space,
  Button,
  Tabs,
  List,
  Avatar,
  Input,
  Alert,
  Spin,
  Breadcrumb,
  Badge,
  Tooltip,
  Divider,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  MergeOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CommentOutlined,
  BugOutlined,
  SendOutlined,
  ReloadOutlined,
  DiffOutlined,
  FileTextOutlined,
  SaveOutlined,
  FlagOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  codehubApi,
  type CodeHubMR,
  type DiffFile,
  type CodeHubComment,
} from '@/api/codehub';
import DiffViewer from '@/components/diff/DiffViewer';

const { TextArea } = Input;

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

const severityColorMap: Record<string, string> = {
  critical: '#ff4d4f',
  high: '#fa8c16',
  medium: '#faad14',
  low: '#1677ff',
  info: '#52c41a',
};

interface Finding {
  id?: string;
  file: string;
  line: number;
  title: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion?: string;
  ruleId?: string;
}

function MRDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mrIid } = useParams<{ mrIid: string }>();
  const [commentText, setCommentText] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commentingFindingId, setCommentingFindingId] = useState<string | null>(null);

  const mrIidNum = parseInt(mrIid || '0', 10);

  const { data: mrData, isLoading: mrLoading } = useQuery({
    queryKey: ['mr', mrIidNum],
    queryFn: () => codehubApi.getMR(mrIidNum) as Promise<{ ok: boolean; mr: CodeHubMR }>,
    enabled: !!mrIidNum,
    retry: false,
  });

  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: ['mr-diff', mrIidNum],
    queryFn: () => codehubApi.getMRDiff(mrIidNum),
    enabled: !!mrIidNum,
    retry: false,
  });

  const { data: commentsData, isLoading: commentsLoading } = useQuery({
    queryKey: ['mr-comments', mrIidNum],
    queryFn: () => codehubApi.getMRComments(mrIidNum) as Promise<{ ok: boolean; comments: CodeHubComment[]; count: number }>,
    enabled: !!mrIidNum,
    retry: false,
  });

  const { data: findingsData, isLoading: findingsLoading } = useQuery({
    queryKey: ['mr-findings', mrIidNum],
    queryFn: () => codehubApi.getMRFindings(mrIidNum) as Promise<{ ok: boolean; findings: Finding[]; count: number }>,
    enabled: !!mrIidNum,
    retry: false,
  });

  const saveReportMutation = useMutation({
    mutationFn: () => codehubApi.saveMRReport(mrIidNum),
    onSuccess: (res) => {
      if (res.ok) {
        message.success(`报告已保存到: ${res.filePath}`);
      } else {
        message.error(res.error || '保存报告失败');
      }
    },
    onError: (err) => {
      message.error(`保存报告失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const createIssueMutation = useMutation({
    mutationFn: () => codehubApi.createMRIssue(mrIidNum),
    onSuccess: (res) => {
      if (res.ok && res.issue) {
        message.success(`Issue 已创建: ${res.issue.iid}`);
        if (res.issue.web_url) {
          window.open(res.issue.web_url, '_blank');
        }
      } else {
        message.error(res.error || '提 Issue 失败');
      }
    },
    onError: (err) => {
      message.error(`提 Issue 失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const commentMutation = useMutation({
    mutationFn: (body: string) => codehubApi.createMRComment(mrIidNum, { body }),
    onSuccess: () => {
      setCommentText('');
      queryClient.invalidateQueries({ queryKey: ['mr-comments', mrIidNum] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () => codehubApi.runMRReview(mrIidNum),
    onSuccess: (res) => {
      if (res.ok) {
        message.success(`审查完成，发现 ${res.findings?.length ?? 0} 个问题`);
        queryClient.invalidateQueries({ queryKey: ['mr-findings', mrIidNum] });
      } else {
        message.error(res.error || '审查失败');
      }
    },
    onError: (err) => {
      message.error(`审查失败: ${err instanceof Error ? err.message : '未知错误'}`);
    },
  });

  const createFindingCommentMutation = useMutation({
    mutationFn: (findingId: string) => {
      setCommentingFindingId(findingId);
      return codehubApi.createFindingComment(mrIidNum, findingId);
    },
    onSuccess: (res) => {
      if (res.ok) {
        message.success('评论已提交到 MR');
        queryClient.invalidateQueries({ queryKey: ['mr-comments', mrIidNum] });
      } else {
        message.error(res.error || '提交评论失败');
      }
      setCommentingFindingId(null);
    },
    onError: (err) => {
      message.error(`提交评论失败: ${err instanceof Error ? err.message : '未知错误'}`);
      setCommentingFindingId(null);
    },
  });

  const changes = diffData?.changes ?? [];
  const findings = findingsData?.findings ?? [];
  const comments = commentsData?.comments ?? [];
  const mr = mrData?.mr;

  const fileStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const f of changes) {
      const lines = f.diff.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) added++;
        if (line.startsWith('-') && !line.startsWith('---')) removed++;
      }
    }
    return { files: changes.length, added, removed };
  }, [changes]);

  const findingsBySeverity = useMemo(() => {
    const result: Record<string, number> = {};
    for (const f of findings) {
      result[f.severity] = (result[f.severity] ?? 0) + 1;
    }
    return result;
  }, [findings]);

  const findingsByFile = useMemo(() => {
    const result: Record<string, Finding[]> = {};
    for (const f of findings) {
      if (!result[f.file]) result[f.file] = [];
      result[f.file].push(f);
    }
    return result;
  }, [findings]);

  if (!mrIidNum) {
    return <Alert type="error" message="无效的 MR ID" />;
  }

  const tabItems = [
    {
      key: 'diff',
      label: (
        <Space>
          <DiffOutlined />
          <span>变更</span>
          <Badge count={fileStats.files} size="small" />
        </Space>
      ),
      children: (
        <Spin spinning={diffLoading}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ width: 260, flexShrink: 0 }}>
              <Card
                size="small"
                title={
                  <Space>
                    <FileTextOutlined />
                    <span>变更文件</span>
                  </Space>
                }
                style={{ position: 'sticky', top: 0 }}
              >
                <List
                  size="small"
                  dataSource={changes}
                  renderItem={(item) => {
                    const fileFindings = findingsByFile[item.new_path] ?? [];
                    return (
                      <List.Item
                        style={{
                          cursor: 'pointer',
                          background: selectedFile === item.new_path ? '#e6f4ff' : 'transparent',
                          padding: '8px 12px',
                          borderRadius: 4,
                        }}
                        onClick={() => setSelectedFile(item.new_path)}
                      >
                        <div style={{ width: '100%' }}>
                          <div
                            style={{
                              fontSize: 13,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={item.new_path}
                          >
                            {item.new_file && <Tag color="green" style={{ marginRight: 4 }}>新增</Tag>}
                            {item.deleted_file && <Tag color="red" style={{ marginRight: 4 }}>删除</Tag>}
                            {item.renamed_file && <Tag color="blue" style={{ marginRight: 4 }}>重命名</Tag>}
                            {item.new_path}
                          </div>
                          {fileFindings.length > 0 && (
                            <div style={{ marginTop: 4 }}>
                              {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) =>
                                fileFindings.filter((f) => f.severity === sev).length > 0 ? (
                                  <Tag
                                    key={sev}
                                    style={{
                                      marginRight: 4,
                                      borderColor: severityColorMap[sev],
                                      color: severityColorMap[sev],
                                    }}
                                  >
                                    {sev.toUpperCase()}: {fileFindings.filter((f) => f.severity === sev).length}
                                  </Tag>
                                ) : null,
                              )}
                            </div>
                          )}
                        </div>
                      </List.Item>
                    );
                  }}
                />
              </Card>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {selectedFile ? (
                <DiffViewer
                  diffFile={changes.find((f) => f.new_path === selectedFile)}
                  findings={findingsByFile[selectedFile] ?? []}
                />
              ) : (
                <Card>
                  <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                    <DiffOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                    <p>请从左侧选择文件查看 diff</p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </Spin>
      ),
    },
    {
      key: 'findings',
      label: (
        <Space>
          <BugOutlined />
          <span>审查问题</span>
          <Badge count={findings.length} size="small" />
        </Space>
      ),
      children: (
        <div>
          <Alert
            type="info"
            showIcon
            message="代码审查"
            description={
              <span>
                点击下方"运行审查"按钮触发代码审查（通过 opencode CLI 执行），或在 opencode 中手动运行{' '}
                <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4 }}>
                  /review-pr {mrIidNum}
                </code>
                。审查完成后，findings 将自动保存到此处。
              </span>
            }
            style={{ marginBottom: 16 }}
          />
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            <Space wrap>
              {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) => (
                <Tag key={sev} color={severityColorMap[sev]} style={{ padding: '4px 12px' }}>
                  {sev.toUpperCase()}: {findingsBySeverity[sev] ?? 0}
                </Tag>
              ))}
            </Space>
            <Space>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={reviewMutation.isPending}
                onClick={() => reviewMutation.mutate()}
              >
                运行审查
              </Button>
              <Button
                icon={<SaveOutlined />}
                loading={saveReportMutation.isPending}
                disabled={findings.length === 0}
                onClick={() => saveReportMutation.mutate()}
              >
                保存报告
              </Button>
              <Button
                type="primary"
                icon={<FlagOutlined />}
                loading={createIssueMutation.isPending}
                disabled={findings.length === 0}
                onClick={() => createIssueMutation.mutate()}
              >
                提 Issue
              </Button>
            </Space>
          </div>

          {findingsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : findings.length === 0 ? (
            <Card>
              <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
                <p>暂无审查问题</p>
                <p style={{ fontSize: 12 }}>请在 opencode 中执行 /review-pr 进行代码审查</p>
              </div>
            </Card>
          ) : (
            <List
              dataSource={findings}
              renderItem={(item, idx) => (
                <Card
                  key={idx}
                  size="small"
                  style={{ marginBottom: 8 }}
                  title={
                    <Space>
                      <Tag color={severityColorMap[item.severity]}>{item.severity.toUpperCase()}</Tag>
                      <span>{item.title}</span>
                    </Space>
                  }
                  extra={
                    <Space>
                      <span style={{ color: '#999', fontSize: 12 }}>{item.file}:{item.line}</span>
                      <Button
                        size="small"
                        icon={<SendOutlined />}
                        loading={commentingFindingId === item.id}
                        disabled={!item.id}
                        onClick={() => item.id && createFindingCommentMutation.mutate(item.id)}
                      >
                        提评论
                      </Button>
                    </Space>
                  }
                >
                  <p style={{ margin: 0 }}>{item.message}</p>
                  {item.suggestion && (
                    <>
                      <Divider style={{ margin: '12px 0' }} />
                      <p style={{ margin: 0 }}>
                        <strong>建议：</strong>
                        {item.suggestion}
                      </p>
                    </>
                  )}
                </Card>
              )}
            />
          )}
        </div>
      ),
    },
    {
      key: 'comments',
      label: (
        <Space>
          <CommentOutlined />
          <span>评论</span>
          <Badge count={comments.length} size="small" />
        </Space>
      ),
      children: (
        <div>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <TextArea
                rows={3}
                placeholder="发表评论..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              <div style={{ textAlign: 'right' }}>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={() => commentMutation.mutate(commentText)}
                  loading={commentMutation.isPending}
                  disabled={!commentText.trim()}
                >
                  发表
                </Button>
              </div>
            </Space>
          </Card>

          {commentsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : (
            <List
              dataSource={comments}
              renderItem={(comment) => (
                <List.Item key={comment.id} style={{ padding: '12px 0' }}>
                  <List.Item.Meta
                    avatar={
                      <Avatar style={{ backgroundColor: '#1677ff' }}>
                        {comment.author?.name?.[0] || comment.author?.username?.[0] || '?'}
                      </Avatar>
                    }
                    title={
                      <Space>
                        <span>{comment.author?.name || comment.author?.username || 'Unknown'}</span>
                        <span style={{ color: '#999', fontWeight: 'normal', fontSize: 12 }}>
                          {dayjs(comment.created_at).format('YYYY-MM-DD HH:mm')}
                        </span>
                      </Space>
                    }
                    description={
                      <div style={{ whiteSpace: 'pre-wrap', color: '#333' }}>{comment.body}</div>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/mrs')}>
          返回列表
        </Button>
        <Breadcrumb>
          <Breadcrumb.Item>合并请求</Breadcrumb.Item>
          <Breadcrumb.Item>!{mrIidNum}</Breadcrumb.Item>
        </Breadcrumb>
      </Space>

      <Spin spinning={mrLoading}>
        {mr && (
          <Card
            title={
              <Space size={16}>
                <h2 style={{ margin: 0, fontSize: 20 }}>
                  {mr.title}
                </h2>
                <Tag color={stateColorMap[mr.state]} style={{ fontSize: 14, padding: '4px 12px' }}>
                  {stateIconMap[mr.state]} {mr.state.toUpperCase()}
                </Tag>
              </Space>
            }
            extra={
              <Space>
                <Tooltip title="刷新">
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      queryClient.invalidateQueries({ queryKey: ['mr', mrIidNum] });
                      queryClient.invalidateQueries({ queryKey: ['mr-diff', mrIidNum] });
                      queryClient.invalidateQueries({ queryKey: ['mr-comments', mrIidNum] });
                      queryClient.invalidateQueries({ queryKey: ['mr-findings', mrIidNum] });
                    }}
                  />
                </Tooltip>
              </Space>
            }
          >
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space wrap>
                <Space>
                  <Avatar size={24} style={{ backgroundColor: '#1677ff' }}>
                    {mr.author?.name?.[0] || mr.author?.username?.[0] || '?'}
                  </Avatar>
                  <span>{mr.author?.name || mr.author?.username}</span>
                </Space>
                <span style={{ color: '#999' }}>·</span>
                <span style={{ color: '#666' }}>
                  <MergeOutlined /> {mr.source_branch} → {mr.target_branch}
                </span>
                <span style={{ color: '#999' }}>·</span>
                <span style={{ color: '#666' }}>创建于 {dayjs(mr.created_at).format('YYYY-MM-DD')}</span>
                <span style={{ color: '#999' }}>·</span>
                <span style={{ color: '#666' }}>更新于 {dayjs(mr.updated_at).format('YYYY-MM-DD HH:mm')}</span>
              </Space>

              <Space wrap>
                <Tag color="green">+{fileStats.added} 新增</Tag>
                <Tag color="red">-{fileStats.removed} 删除</Tag>
                <Tag color="blue">{fileStats.files} 个文件变更</Tag>
                {findings.length > 0 && (
                  <Tag color="orange">
                    <BugOutlined /> {findings.length} 个问题
                  </Tag>
                )}
              </Space>

              {mr.description && (
                <div
                  style={{
                    padding: 12,
                    background: '#fafafa',
                    borderRadius: 6,
                    whiteSpace: 'pre-wrap',
                    marginTop: 8,
                  }}
                >
                  {mr.description}
                </div>
              )}
            </Space>
          </Card>
        )}
      </Spin>

      <Card style={{ marginTop: 16 }} bodyStyle={{ padding: 0 }}>
        <Tabs items={tabItems} defaultActiveKey="diff" style={{ padding: '0 16px' }} />
      </Card>
    </div>
  );
}

export default MRDetail;
