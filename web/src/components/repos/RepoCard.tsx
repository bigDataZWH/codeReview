import {
  Button,
  Space,
  Tag,
  Row,
  Col,
  List,
  Tooltip,
  Popconfirm,
} from 'antd';
import {
  FolderOutlined,
  CloudDownloadOutlined,
  DownOutlined,
  SwapOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  BranchesOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  RightOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { RepoInfo } from '@/api/codehub';

export function formatSize(bytes?: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getStatus(lastFetchedAt: string): 'online' | 'offline' {
  if (!lastFetchedAt) return 'offline';
  const diff = dayjs().diff(dayjs(lastFetchedAt), 'hour');
  return diff <= 24 ? 'online' : 'offline';
}

const MOCK_COMMITS: Record<string, { sha: string; message: string; author: string; time: string }> = {
  a1b2c3d: { sha: 'a1b2c3d', message: 'feat: add user authentication module', author: '张伟', time: '10 分钟前' },
  e4f5g6h: { sha: 'e4f5g6h', message: 'fix: resolve memory leak in cache service', author: '李娜', time: '32 分钟前' },
  i7j8k9l: { sha: 'i7j8k9l', message: 'refactor: optimize database query performance', author: '王强', time: '2 小时前' },
  m0n1o2p: { sha: 'm0n1o2p', message: 'docs: update API documentation for v2', author: '赵敏', time: '5 小时前' },
  q3r4s5t: { sha: 'q3r4s5t', message: 'test: add unit tests for payment module', author: '陈刚', time: '昨天' },
  u6v7w8x: { sha: 'u6v7w8x', message: 'chore: bump dependencies to latest versions', author: '孙丽', time: '2 天前' },
};

function getMockCommits(seed: string) {
  const seedVal = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const entries = Object.values(MOCK_COMMITS);
  const start = seedVal % entries.length;
  const result = [];
  for (let i = 0; i < 4; i++) {
    result.push(entries[(start + i) % entries.length]);
  }
  return result;
}

interface RepoCardProps {
  repo: RepoInfo;
  isExpanded: boolean;
  onToggle: () => void;
  onFetch: (projectId: string) => void;
  onPull: (projectId: string) => void;
  onCheckout: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onOpenMRs: (projectId: string) => void;
  onViewReports: () => void;
  isFetching: boolean;
  isPulling: boolean;
  isDeleting: boolean;
}

export default function RepoCard({
  repo,
  isExpanded,
  onToggle,
  onFetch,
  onPull,
  onCheckout,
  onDelete,
  onOpenMRs,
  onViewReports,
  isFetching,
  isPulling,
  isDeleting,
}: RepoCardProps) {
  const status = getStatus(repo.lastFetchedAt);
  const commits = getMockCommits(repo.projectId);
  const fileCount = 12 + (repo.projectId.length % 20);
  const lineCount = 800 + (repo.projectId.length * 37) % 2400;

  return (
    <div
      onClick={onToggle}
      style={{
        background: '#fff',
        borderRadius: 14,
        border: '1px solid var(--cr-border)',
        boxShadow: isExpanded ? 'var(--cr-shadow-md)' : 'var(--cr-shadow-sm)',
        transition: 'all 0.25s ease',
        cursor: 'pointer',
        overflow: 'hidden',
        position: 'relative',
        transform: isExpanded ? 'translateY(-2px)' : 'translateY(0)',
      }}
      onMouseEnter={(e) => {
        if (!isExpanded) {
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--cr-shadow-md)';
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isExpanded) {
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--cr-shadow-sm)';
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
        }
      }}
    >
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'linear-gradient(135deg, var(--cr-brand-50), #eef5ff)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FolderOutlined style={{ color: 'var(--cr-brand-500)', fontSize: 20 }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 15,
                  color: 'var(--cr-ink-1)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                }}
              >
                {repo.projectName || repo.projectId}
              </div>
              <div style={{ fontSize: 12, color: 'var(--cr-ink-4)', marginTop: 2 }}>
                {repo.projectId}
              </div>
            </div>
          </div>
          <Tag
            color={status === 'online' ? 'success' : 'default'}
            style={{ margin: 0, flexShrink: 0 }}
            icon={status === 'online' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
          >
            {status === 'online' ? '在线' : '离线'}
          </Tag>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <Tag color="blue" style={{ margin: 0, width: 'fit-content' }} icon={<BranchesOutlined />}>
            {repo.currentBranch}
          </Tag>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--cr-ink-3)' }}>
            <DatabaseOutlined />
            <span
              style={{
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
              title={repo.localPath}
            >
              {repo.localPath}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--cr-ink-3)' }}>
            <span style={{ fontWeight: 500 }}>大小:</span>
            <span>{formatSize(repo.sizeBytes)}</span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 12,
            borderTop: '1px solid var(--cr-divider)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--cr-ink-4)' }}>
            <ClockCircleOutlined />
            <span>{repo.lastFetchedAt ? dayjs(repo.lastFetchedAt).format('MM-DD HH:mm') : '-'}</span>
          </div>
          <Space size={2}>
            <Tooltip title="Fetch 拉取远端信息">
              <Button
                type="text"
                size="small"
                icon={<CloudDownloadOutlined />}
                loading={isFetching}
                onClick={(e) => { e.stopPropagation(); onFetch(repo.projectId); }}
              >
                Fetch
              </Button>
            </Tooltip>
            <Tooltip title="Pull 合并更新">
              <Button
                type="text"
                size="small"
                icon={<DownOutlined />}
                loading={isPulling}
                onClick={(e) => { e.stopPropagation(); onPull(repo.projectId); }}
              >
                Pull
              </Button>
            </Tooltip>
            <Tooltip title="切换分支">
              <Button
                type="text"
                size="small"
                icon={<SwapOutlined />}
                onClick={(e) => { e.stopPropagation(); onCheckout(repo.projectId); }}
              >
                切换
              </Button>
            </Tooltip>
            <Popconfirm
              title="确定删除本地仓库？"
              description="这将删除本地克隆的仓库目录，操作不可恢复。"
              onConfirm={(e) => { e?.stopPropagation(); onDelete(repo.projectId); }}
              onPopupClick={(e) => e.stopPropagation()}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={isDeleting}
                onClick={(e) => e.stopPropagation()}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        </div>
      </div>

      {isExpanded && (
        <div
          style={{
            borderTop: '1px solid var(--cr-divider)',
            background: 'linear-gradient(180deg, #fafbfe, #ffffff)',
            padding: 20,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Row gutter={[16, 16]}>
            <Col span={24} md={10}>
              <div style={{ padding: 14, background: '#fff', border: '1px solid var(--cr-border)', borderRadius: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13, color: 'var(--cr-ink-2)' }}>
                  <FileTextOutlined style={{ marginRight: 6, color: 'var(--cr-brand-500)' }} />
                  文件统计
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--cr-ink-1)' }}>{fileCount}</div>
                    <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>文件数</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--cr-ink-1)' }}>
                      {(lineCount / 1000).toFixed(1)}k
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>代码行数</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--cr-ink-1)' }}>
                      {Math.max(1, Math.floor(fileCount / 3))}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>目录数</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--cr-ink-1)' }}>
                      {Math.floor(lineCount / fileCount)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--cr-ink-3)' }}>平均行数</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12, padding: 14, background: '#fff', border: '1px solid var(--cr-border)', borderRadius: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13, color: 'var(--cr-ink-2)' }}>
                  <ThunderboltOutlined style={{ marginRight: 6, color: 'var(--cr-sev-low)' }} />
                  MR 快捷操作
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Button block icon={<ApiOutlined />} onClick={() => onOpenMRs(repo.projectId)}>
                    查看 MR 列表
                  </Button>
                  <Button block icon={<FileTextOutlined />} onClick={onViewReports}>
                    查看检视报告
                  </Button>
                </div>
              </div>
            </Col>

            <Col span={24} md={14}>
              <div style={{ padding: 14, background: '#fff', border: '1px solid var(--cr-border)', borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--cr-ink-2)' }}>
                    <HistoryOutlined style={{ marginRight: 6, color: 'var(--cr-accent-500)' }} />
                    最近提交
                  </div>
                  <Button type="link" size="small" icon={<RightOutlined />}>查看全部</Button>
                </div>
                <List
                  size="small"
                  dataSource={commits}
                  renderItem={(commit) => (
                    <List.Item style={{ padding: '8px 0', borderBottom: '1px solid var(--cr-divider)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%' }}>
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 6,
                            background: 'var(--cr-bg-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            fontSize: 11,
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            color: 'var(--cr-brand-500)',
                          }}
                        >
                          {commit.sha.slice(0, 2)}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, color: 'var(--cr-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {commit.message}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--cr-ink-4)', marginTop: 2 }}>
                            <span>{commit.author}</span>
                            <span>·</span>
                            <span>{commit.time}</span>
                            <span>·</span>
                            <span style={{ fontFamily: 'monospace' }}>{commit.sha}</span>
                          </div>
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              </div>
            </Col>
          </Row>
        </div>
      )}
    </div>
  );
}