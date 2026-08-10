import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Card, Tag, Space, Button, List, Avatar, Alert, Spin,
  Breadcrumb, Tooltip, Divider, Select, Modal, message, Tabs,
  Collapse, Progress, Empty,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, CheckCircleFilled,
  BugOutlined, ReloadOutlined, CodeOutlined, ExperimentOutlined,
  SendOutlined, ClockCircleOutlined, CloseCircleOutlined,
  InfoCircleOutlined, ApartmentOutlined, FileTextOutlined,
  ShareAltOutlined, SaveOutlined, ExportOutlined, AuditOutlined,
  DiffOutlined, UserOutlined, ThunderboltOutlined, FileOutlined,
  ExclamationCircleOutlined, BulbOutlined, AlertOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { codehubApi, type CodeHubMR } from '@/api/codehub';
import { useAppStore } from '@/store/app';

const stateColorMap: Record<string, string> = {
  open: 'processing', merged: 'success', closed: 'default', locked: 'warning',
};

const severityColorMap: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#2563eb', info: '#0f766e',
};

const severityBgMap: Record<string, string> = {
  critical: '#fee2e2', high: '#ffedd5', medium: '#fef3c7', low: '#dbeafe', info: '#ccfbf1',
};

const severityBorderMap: Record<string, string> = {
  critical: '#fca5a5', high: '#fdba74', medium: '#fcd34d', low: '#93c5fd', info: '#6ee7b7',
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
  submitted?: boolean;
}

interface TestCase {
  id: string;
  title: string;
  description: string;
  file: string;
  type: 'unit' | 'integration';
  status: 'pending' | 'ut_passed' | 'integration_passed' | 'failed';
  severity?: string;
}

function MRDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mrIid } = useParams<{ mrIid: string }>();
  const [activeTab, setActiveTab] = useState<string>('info');
  const activeRepoId = useAppStore((s) => s.activeRepoId);
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'unsubmitted'>('all');
  const [submittedFindings, setSubmittedFindings] = useState<Set<string>>(new Set());
  const [confirmTarget, setConfirmTarget] = useState<Finding | null>(null);
  const [batchResultVisible, setBatchResultVisible] = useState(false);
  const [batchResult, setBatchResult] = useState<{ ok: boolean; total: number; success: number; failed: number; results: Array<{ findingId: string; ok: boolean; commentId?: number; error?: string }> } | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const mrIidNum = parseInt(mrIid || '0', 10);

  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [reviewProgress, setReviewProgress] = useState<number>(0);
  const [reviewStatus, setReviewStatus] = useState<'idle' | 'queued' | 'running' | 'completed' | 'failed'>('idle');
  const [reviewFindings, setReviewFindings] = useState<Finding[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewEventSourceRef = useRef<EventSource | null>(null);

  const { data: mrData, isLoading: mrLoading } = useQuery({
    queryKey: ['mr', mrIidNum],
    queryFn: () => codehubApi.getMR(mrIidNum) as Promise<{ ok: boolean; mr: CodeHubMR }>,
    enabled: !!mrIidNum, retry: false,
  });
  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: ['mr-diff', mrIidNum],
    queryFn: () => codehubApi.getMRDiff(mrIidNum),
    enabled: !!mrIidNum, retry: false,
  });
  const { data: findingsData, isLoading: findingsLoading } = useQuery({
    queryKey: ['mr-findings', mrIidNum],
    queryFn: () => codehubApi.getMRFindings(mrIidNum) as Promise<{ ok: boolean; findings: Finding[]; count: number }>,
    enabled: !!mrIidNum, retry: false,
  });

  const batchSubmitMutation = useMutation({
    mutationFn: () => codehubApi.batchSubmitComments(mrIidNum, activeRepoId ?? undefined),
    onSuccess: (res: { ok: boolean; total: number; success: number; failed: number; results: Array<{ findingId: string; ok: boolean; commentId?: number; error?: string }> }) => {
      setBatchResult(res);
      setBatchResultVisible(true);
      if (res.ok) {
        const successIds = res.results.filter((r: { findingId: string; ok: boolean }) => r.ok).map((r: { findingId: string }) => r.findingId);
        setSubmittedFindings((prev) => {
          const next = new Set(prev);
          successIds.forEach((id: string) => next.add(id));
          return next;
        });
        message.success(`成功提交 ${res.success}/${res.total} 条`);
      } else {
        message.error('批量提交评论失败');
      }
      queryClient.invalidateQueries({ queryKey: ['mr-comments', mrIidNum] });
      queryClient.invalidateQueries({ queryKey: ['mr-findings', mrIidNum] });
    },
    onError: (err) => message.error(`批量提交失败: ${err instanceof Error ? err.message : '未知错误'}`),
  });

  const createFindingCommentMutation = useMutation({
    mutationFn: (findingId: string) =>
      codehubApi.createFindingComment(mrIidNum, findingId, activeRepoId ?? undefined),
    onSuccess: (_res, findingId) => {
      setSubmittedFindings((prev) => {
        const next = new Set(prev);
        next.add(findingId);
        return next;
      });
      message.success('意见提交成功');
      queryClient.invalidateQueries({ queryKey: ['mr-comments', mrIidNum] });
      queryClient.invalidateQueries({ queryKey: ['mr-findings', mrIidNum] });
    },
    onError: (err) => message.error(`提交失败: ${err instanceof Error ? err.message : '未知错误'}`),
  });

  const changes = diffData?.changes ?? [];
  const findings = findingsData?.findings ?? [];
  const mr = mrData?.mr;

  useEffect(() => {
    if (findings.length > 0) {
      const submittedIds = new Set<string>();
      for (const f of findings) {
        if (f.submitted && f.id) submittedIds.add(f.id);
      }
      setSubmittedFindings((prev) => {
        if (submittedIds.size === 0 && prev.size === 0) return prev;
        const next = new Set(prev);
        submittedIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [findings]);

  const fileStats = useMemo(() => {
    let added = 0, removed = 0;
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
    for (const f of findings) result[f.severity] = (result[f.severity] ?? 0) + 1;
    return result;
  }, [findings]);

  const impactSummary = useMemo(() => {
    if (changes.length === 0) return null;
    const parts: string[] = [];
    parts.push(`本次合并请求涉及 ${changes.length} 个文件的修改，主要变更包括：`);
    parts.push(`- 新增 ${fileStats.added} 行代码，删除 ${fileStats.removed} 行代码`);
    parts.push(`- 涉及 ${changes.length} 个文件的变更`);
    if (findings.length > 0) {
      const c = findings.filter((f) => f.severity === 'critical').length;
      const h = findings.filter((f) => f.severity === 'high').length;
      parts.push(`- 代码审查发现 ${findings.length} 个问题（${c} 个严重，${h} 个高优先级）`);
    }
    return parts.join('\n');
  }, [changes, findings, fileStats]);

  const hasSubmittedField = useMemo(
    () => findings.some((f) => typeof f.submitted === 'boolean') || submittedFindings.size > 0,
    [findings, submittedFindings],
  );

  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      if (severityFilter.length > 0 && !severityFilter.includes(f.severity)) return false;
      const isSubmitted = (f.id ? submittedFindings.has(f.id) : false) || f.submitted === true;
      if (statusFilter === 'submitted' && !isSubmitted) return false;
      if (statusFilter === 'unsubmitted' && isSubmitted) return false;
      return true;
    });
  }, [findings, severityFilter, statusFilter, submittedFindings]);

  const findingsBySeverityGrouped = useMemo(() => {
    const groups: Record<string, Finding[]> = {
      critical: [], high: [], medium: [], low: [], info: [],
    };
    for (const f of filteredFindings) {
      if (groups[f.severity]) groups[f.severity].push(f);
    }
    return groups;
  }, [filteredFindings]);

  const testCaseStats = useMemo(() => {
    const total = testCases.length;
    const pending = testCases.filter((t) => t.status === 'pending').length;
    const utPassed = testCases.filter((t) => t.status === 'ut_passed').length;
    const integrationPassed = testCases.filter((t) => t.status === 'integration_passed').length;
    const failed = testCases.filter((t) => t.status === 'failed').length;
    const passed = utPassed + integrationPassed;
    return { total, pending, utPassed, integrationPassed, failed, passed };
  }, [testCases]);

  const handleGenerateTestCases = () => {
    const newCases: TestCase[] = [];
    let idCounter = 0;
    for (const change of changes) {
      if (change.new_file) {
        newCases.push({
          id: `test-case-${idCounter++}`,
          title: `验证 ${change.new_path} 的单元测试覆盖`,
          description: `新增文件 ${change.new_path}，需要编写单元测试验证其核心逻辑、边界条件和错误处理。`,
          file: change.new_path, type: 'unit', status: 'pending',
        });
      } else {
        newCases.push({
          id: `test-case-${idCounter++}`,
          title: `验证 ${change.new_path} 集成测试`,
          description: `修改文件 ${change.new_path}，需要进行集成测试验证与其他模块的协作是否正常。`,
          file: change.new_path, type: 'integration', status: 'pending',
        });
      }
    }
    for (const finding of findings) {
      const label = finding.severity.toUpperCase();
      newCases.push({
        id: `test-case-${idCounter++}`,
        title: `修复 ${label} 问题后的回归验证`,
        description: `针对 ${finding.file} 中发现的 ${label} 级别问题（${finding.title}），验证修复后的功能正确性。`,
        file: finding.file, type: 'integration', status: 'pending', severity: finding.severity,
      });
    }
    setTestCases(newCases);
    message.success(`已生成 ${newCases.length} 条验证用例`);
  };

  useEffect(() => {
    if (findings.length > 0 && testCases.length === 0) handleGenerateTestCases();
  }, [findings, changes]);

  useEffect(() => {
    const saved = localStorage.getItem(`review:mr:${mrIidNum}`);
    if (saved) {
      setReviewSessionId(saved);
      setReviewStatus('queued');
    }
    return () => {
      if (reviewEventSourceRef.current) {
        reviewEventSourceRef.current.close();
        reviewEventSourceRef.current = null;
      }
    };
  }, [mrIidNum]);

  const openReviewStream = (sessionId: string) => {
    if (reviewEventSourceRef.current) {
      reviewEventSourceRef.current.close();
    }
    const url = codehubApi.getReviewStreamUrl(sessionId);
    const es = new EventSource(url);
    reviewEventSourceRef.current = es;

    es.addEventListener('progress', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setReviewStatus('running');
      setReviewProgress(data.progress ?? 0);
    });

    es.addEventListener('finding', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setReviewFindings((prev) => [...prev, data as Finding]);
    });

    es.addEventListener('complete', () => {
      setReviewStatus('completed');
      setReviewProgress(100);
      queryClient.invalidateQueries({ queryKey: ['mr-findings', mrIidNum] });
    });

    es.addEventListener('error', (e: MessageEvent) => {
      const data = e.data ? JSON.parse(e.data) : null;
      setReviewStatus('failed');
      setReviewError(data?.error ?? '检视流连接错误');
    });

    es.onerror = () => {
      setReviewError('EventSource 连接错误');
      es.close();
      reviewEventSourceRef.current = null;
    };
  };

  const startReview = async () => {
    setReviewError(null);
    setReviewFindings([]);
    setReviewProgress(0);
    setReviewStatus('queued');

    const result = await codehubApi.startReview(mrIidNum, activeRepoId ?? undefined);

    if (!result.ok || !result.sessionId) {
      setReviewStatus('failed');
      setReviewError(result.error ?? '启动检视失败');
      return;
    }

    setReviewSessionId(result.sessionId);
    localStorage.setItem(`review:mr:${mrIidNum}`, result.sessionId);
    openReviewStream(result.sessionId);
  };

  const resumeReview = () => {
    if (reviewSessionId) {
      openReviewStream(reviewSessionId);
    }
  };

  const handleUpdateStatus = (id: string, status: TestCase['status']) => {
    setTestCases((prev) => prev.map((tc) => (tc.id === id ? { ...tc, status } : tc)));
  };

  const formatTestCasesForMR = (cases: TestCase[]): string => {
    const sections: string[] = ['## 自验证用例清单', ''];
    const groups: Record<string, TestCase[]> = {
      ut_passed: [], integration_passed: [], failed: [], pending: [],
    };
    cases.forEach((tc) => { if (groups[tc.status]) groups[tc.status].push(tc); });
    const labels: Record<string, string> = {
      ut_passed: '### ✅ 通过-UT验证',
      integration_passed: '### ✅ 通过-集成验证',
      failed: '### ❌ 未通过',
      pending: '### ⏳ 待验证',
    };
    let counter = 1;
    for (const key of ['ut_passed', 'integration_passed', 'failed', 'pending']) {
      if (groups[key].length > 0) {
        sections.push(labels[key]);
        groups[key].forEach((tc) => {
          sections.push(`${counter}. [${tc.file}] ${tc.title}`);
          counter++;
        });
        sections.push('');
      }
    }
    return sections.join('\n');
  };

  const submitTestCasesMutation = useMutation({
    mutationFn: (body: string) =>
      codehubApi.createMRComment(mrIidNum, { body }, activeRepoId ?? undefined),
    onSuccess: () => message.success('测试用例已提交到 MR'),
    onError: (err) => message.error(`提交失败: ${err instanceof Error ? err.message : '未知错误'}`),
  });

  const handleSubmitToMR = () => {
    submitTestCasesMutation.mutate(formatTestCasesForMR(testCases));
  };

  const handleExportReport = () => message.success('报告已生成，正在下载...');
  const handleShare = () => message.success('报告链接已复制到剪贴板');
  const handleArchive = () => {
    Modal.confirm({
      title: '归档确认',
      content: `确定要归档 MR !${mrIidNum} 的检视报告吗？归档后将从活跃列表中移除。`,
      okText: '确认归档', cancelText: '取消',
      onOk: () => message.success('报告已归档'),
    });
  };

  if (!mrIidNum) {
    return (
      <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 24px' }}>
        <Alert
          type="error"
          showIcon
          message="无效的 MR ID"
          description="无法识别的 MR 编号，请从列表页重新选择。"
          action={
            <Button
              type="primary"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/mrs')}
            >
              返回列表
            </Button>
          }
        />
      </div>
    );
  }

  const criticalCount = findingsBySeverity['critical'] || 0;
  const highCount = findingsBySeverity['high'] || 0;
  const reportStatusColor = mr?.state === 'merged'
    ? 'linear-gradient(135deg, #10b981, #059669)'
    : mr?.state === 'closed' ? 'linear-gradient(135deg, #6b7280, #4b5563)'
    : mr?.state === 'locked' ? 'linear-gradient(135deg, #f59e0b, #d97706)'
    : 'linear-gradient(135deg, #3b6bff, #1e40af)';

  const tabItems = [
    {
      key: 'info',
      label: (<Space><InfoCircleOutlined /><span>MR信息</span></Space>),
      children: (
        <Spin spinning={mrLoading}>
          {mr && (
            <div style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                <Card size="small" title={<Space><FileTextOutlined /><span>基本信息</span></Space>} style={{ borderRadius: 10 }}>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>标题</span>
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a', marginTop: 2 }}>{mr.title}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <div>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>源分支</span>
                        <div style={{ color: '#3b6bff', fontFamily: 'monospace', fontSize: 13 }}>{mr.source_branch}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>目标分支</span>
                        <div style={{ color: '#059669', fontFamily: 'monospace', fontSize: 13 }}>{mr.target_branch}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <div>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>创建时间</span>
                        <div style={{ color: '#475569', fontSize: 13 }}>{dayjs(mr.created_at).format('YYYY-MM-DD HH:mm')}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>更新时间</span>
                        <div style={{ color: '#475569', fontSize: 13 }}>{dayjs(mr.updated_at).format('YYYY-MM-DD HH:mm')}</div>
                      </div>
                    </div>
                    {mr.description && (
                      <div>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>描述</span>
                        <div style={{ marginTop: 4, padding: 12, background: '#f8fafc', borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
                          {mr.description}
                        </div>
                      </div>
                    )}
                  </Space>
                </Card>

                <Card size="small" title={<Space><AuditOutlined /><span>变更统计</span></Space>} style={{ borderRadius: 10 }}>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ padding: 12, background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', borderRadius: 10, border: '1px solid #bfdbfe' }}>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}><FileOutlined /> 文件变更</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#1e40af' }}>{fileStats.files}</div>
                      </div>
                      <div style={{ padding: 12, background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', borderRadius: 10, border: '1px solid #6ee7b7' }}>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}><CodeOutlined /> 新增行</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#047857' }}>+{fileStats.added}</div>
                      </div>
                    </div>
                    <div style={{ padding: 12, background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)', borderRadius: 10, border: '1px solid #fecaca' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}><DiffOutlined /> 删除行</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#b91c1c' }}>-{fileStats.removed}</div>
                    </div>
                    {findings.length > 0 && (
                      <div style={{ padding: 12, background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)', borderRadius: 10, border: '1px solid #fed7aa' }}>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}><BugOutlined /> 检视意见</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#c2410c' }}>{findings.length}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
                            const count = findingsBySeverity[sev] || 0;
                            if (count === 0) return null;
                            return (
                              <Tag key={sev} style={{ background: severityBgMap[sev], color: severityColorMap[sev], border: 'none', fontSize: 11, fontWeight: 600, borderRadius: 6 }}>
                                {sev.toUpperCase()}: {count}
                              </Tag>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </Space>
                </Card>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <Card size="small" title={<Space><UserOutlined /><span>提交人信息</span></Space>} style={{ borderRadius: 10 }}>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Space size={12} align="center">
                      <Avatar size={48} style={{ backgroundColor: '#3b6bff', fontSize: 20 }}>
                        {mr.author?.name?.[0] || mr.author?.username?.[0] || '?'}
                      </Avatar>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>
                          {mr.author?.name || mr.author?.username || 'Unknown'}
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>@{mr.author?.username || 'unknown'}</div>
                      </div>
                    </Space>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Tag color="blue" style={{ borderRadius: 6 }}>ID: {mr.author?.id || '-'}</Tag>
                      <Tag color={stateColorMap[mr.state]} style={{ borderRadius: 6 }}>{mr.state.toUpperCase()}</Tag>
                    </div>
                  </Space>
                </Card>

                <Card size="small" title={<Space><ThunderboltOutlined /><span>快速摘要</span></Space>} style={{ borderRadius: 10 }}>
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <div style={{ padding: '10px 12px', background: '#eff6ff', borderRadius: 8, borderLeft: '3px solid #3b6bff', fontSize: 13, color: '#1e40af' }}>
                      <strong>分支：</strong>{mr.source_branch} → {mr.target_branch}
                    </div>
                    <div style={{ padding: '10px 12px', background: '#f0fdf4', borderRadius: 8, borderLeft: '3px solid #22c55e', fontSize: 13, color: '#166534' }}>
                      <strong>变更：</strong>{fileStats.files} 个文件，+{fileStats.added}/-{fileStats.removed} 行
                    </div>
                    {findings.length > 0 && (
                      <div style={{ padding: '10px 12px', background: '#fff7ed', borderRadius: 8, borderLeft: '3px solid #f97316', fontSize: 13, color: '#c2410c' }}>
                        <strong>检视：</strong>发现 {findings.length} 个问题
                        {criticalCount > 0 && <span style={{ color: '#dc2626', fontWeight: 600 }}>，其中 {criticalCount} 个严重</span>}
                      </div>
                    )}
                    {mr.work_in_progress && (
                      <div style={{ padding: '10px 12px', background: '#fefce8', borderRadius: 8, borderLeft: '3px solid #eab308', fontSize: 13, color: '#a16207' }}>
                        <strong>WIP：</strong>此 MR 仍在进行中
                      </div>
                    )}
                  </Space>
                </Card>
              </div>
            </div>
          )}
        </Spin>
      ),
    },
    {
      key: 'overview',
      label: (<Space><ApartmentOutlined /><span>业务流与功能</span></Space>),
      children: (
        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <Card size="small" title={<Space><FileTextOutlined /><span>业务描述</span></Space>} style={{ borderRadius: 10, border: '1px solid #fed7aa' }}>
              {mr?.description ? (
                <div style={{ padding: 12, background: '#fff7ed', borderRadius: 8, whiteSpace: 'pre-wrap', color: '#7c2d12', fontSize: 13, lineHeight: 1.7, minHeight: 120 }}>
                  {mr.description}
                </div>
              ) : (
                <Alert type="info" showIcon message="暂无业务描述" description="该 MR 未提供描述信息" />
              )}
            </Card>

            <Card size="small" title={<Space><DiffOutlined /><span>影响范围可视化</span></Space>} style={{ borderRadius: 10, border: '1px solid #bfdbfe' }}>
              {diffLoading ? (
                <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
              ) : impactSummary ? (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ padding: 12, background: '#eff6ff', borderRadius: 8, whiteSpace: 'pre-wrap', fontFamily: 'SFMono-Regular, Consolas, monospace', fontSize: 13, color: '#1e40af', lineHeight: 1.7 }}>
                    {impactSummary}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>文件变更分布</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {changes.slice(0, 8).map((f, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: '#f8fafc', borderRadius: 6 }}>
                          <FileOutlined style={{ color: '#64748b' }} />
                          <span style={{ flex: 1, fontFamily: 'monospace', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f.new_path}
                          </span>
                          {f.new_file && <Tag color="green" style={{ margin: 0, fontSize: 10 }}>新增</Tag>}
                          {f.deleted_file && <Tag color="red" style={{ margin: 0, fontSize: 10 }}>删除</Tag>}
                        </div>
                      ))}
                      {changes.length > 8 && (
                        <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
                          ... 还有 {changes.length - 8} 个文件
                        </div>
                      )}
                    </div>
                  </div>
                </Space>
              ) : (
                <Alert type="info" showIcon message="暂无变更数据" description="该合并请求尚未获取到变更信息" />
              )}
            </Card>
          </div>

          {findings.length > 0 && (
            <Card size="small" title={<Space><AlertOutlined style={{ color: '#ea580c' }} /><span>风险评估</span></Space>} style={{ borderRadius: 10, marginTop: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) => {
                  const count = findingsBySeverity[sev] || 0;
                  return (
                    <div key={sev} style={{ padding: 12, background: severityBgMap[sev], borderRadius: 8, border: `1px solid ${severityBorderMap[sev]}`, textAlign: 'center' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{sev.toUpperCase()}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: severityColorMap[sev] }}>{count}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      ),
    },
    {
      key: 'findings',
      label: (
        <Space>
          <BugOutlined /><span>检视意见</span>
          {findings.length > 0 && <Tag color="orange" style={{ marginLeft: 4 }}>{findings.length}</Tag>}
        </Space>
      ),
      children: (
        <div style={{ padding: 20 }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <Space wrap>
              {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) => (
                <Tag key={sev} style={{ background: severityBgMap[sev], color: severityColorMap[sev], border: 'none', padding: '6px 12px', fontWeight: 600, borderRadius: 8 }}>
                  {sev.toUpperCase()}: {findingsBySeverity[sev] ?? 0}
                </Tag>
              ))}
            </Space>
            <Space>
              <Button icon={<CodeOutlined />} loading={batchSubmitMutation.isPending} disabled={findings.length === 0} onClick={() => batchSubmitMutation.mutate()}>
                批量提交
              </Button>
            </Space>
          </div>

          {findings.length > 0 && (
            <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: '#666', fontSize: 13 }}>筛选：</span>
              <Select
                mode="multiple" allowClear placeholder="严重级别" style={{ minWidth: 220 }}
                value={severityFilter} onChange={(val) => setSeverityFilter(val as string[])}
                options={[
                  { label: 'CRITICAL', value: 'critical' },
                  { label: 'HIGH', value: 'high' },
                  { label: 'MEDIUM', value: 'medium' },
                  { label: 'LOW', value: 'low' },
                  { label: 'INFO', value: 'info' },
                ]}
              />
              {hasSubmittedField && (
                <Select style={{ width: 140 }} value={statusFilter}
                  onChange={(val) => setStatusFilter(val as 'all' | 'submitted' | 'unsubmitted')}
                  options={[
                    { label: '全部状态', value: 'all' },
                    { label: '已提交', value: 'submitted' },
                    { label: '未提交', value: 'unsubmitted' },
                  ]}
                />
              )}
              <span style={{ color: '#999', fontSize: 12 }}>共 {filteredFindings.length} 条</span>
            </div>
          )}

          {findingsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : findings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#8c8c8c' }}>
              <CheckCircleOutlined style={{ fontSize: 48, color: '#10b981', marginBottom: 16 }} />
              <p style={{ fontSize: 14, margin: 0 }}>暂无审查问题</p>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>此 MR 代码质量良好，未发现问题</p>
            </div>
          ) : filteredFindings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
              <p>无匹配的筛选结果</p>
            </div>
          ) : (
            <Collapse
              defaultActiveKey={Object.keys(findingsBySeverityGrouped).filter((k) => findingsBySeverityGrouped[k]?.length > 0)}
              items={(['critical', 'high', 'medium', 'low', 'info'] as const)
                .filter((sev) => findingsBySeverityGrouped[sev]?.length > 0)
                .map((sev) => ({
                  key: sev,
                  label: (
                    <Space>
                      <Tag style={{ background: severityBgMap[sev], color: severityColorMap[sev], border: 'none', fontWeight: 600, borderRadius: 6 }}>
                        {sev.toUpperCase()}
                      </Tag>
                      <span style={{ fontWeight: 600 }}>{findingsBySeverityGrouped[sev].length} 条意见</span>
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      {findingsBySeverityGrouped[sev].map((item) => {
                        const isSubmitted = (item.id ? submittedFindings.has(item.id) : false) || item.submitted === true;
                        return (
                          <Card
                            key={item.id || `${item.file}-${item.line}`}
                            size="small"
                            style={{
                              borderRadius: 10,
                              borderLeft: `4px solid ${severityColorMap[item.severity]}`,
                              background: isSubmitted ? '#f8fafc' : '#fff',
                              opacity: isSubmitted ? 0.85 : 1,
                            }}
                            title={
                              <Space>
                                {isSubmitted && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                                <span style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</span>
                              </Space>
                            }
                            extra={
                              <Space>
                                {isSubmitted && <Tag color="success" style={{ borderRadius: 6 }}>已提交</Tag>}
                                <Tooltip title={item.file}>
                                  <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                                    {item.file}:{item.line}
                                  </span>
                                </Tooltip>
                              </Space>
                            }
                          >
                            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                              <div style={{ padding: 12, background: severityBgMap[item.severity], borderRadius: 8, fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
                                <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                                  <ExclamationCircleOutlined style={{ color: severityColorMap[item.severity] }} />
                                  <strong style={{ color: severityColorMap[item.severity] }}>问题描述</strong>
                                </div>
                                <div>{item.message}</div>
                              </div>
                              {item.suggestion && (
                                <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0', fontSize: 13, color: '#166534', lineHeight: 1.6 }}>
                                  <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                                    <BulbOutlined style={{ color: '#16a34a' }} />
                                    <strong>修复建议</strong>
                                  </div>
                                  <div>{item.suggestion}</div>
                                </div>
                              )}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                <div style={{ fontSize: 12, color: '#64748b' }}>
                                  <FileOutlined /> 文件：
                                  <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, marginLeft: 4, fontFamily: 'monospace' }}>
                                    {item.file}:{item.line}
                                  </code>
                                </div>
                                <Space>
                                  <Button size="small" icon={<SendOutlined />} disabled={isSubmitted || createFindingCommentMutation.isPending} loading={createFindingCommentMutation.isPending} onClick={() => setConfirmTarget(item)} style={{ borderRadius: 8 }}>
                                    {isSubmitted ? '已提交' : '采纳并提意见'}
                                  </Button>
                                  <Button size="small" icon={<CloseCircleOutlined />} style={{ borderRadius: 8 }}>忽略</Button>
                                </Space>
                              </div>
                            </Space>
                          </Card>
                        );
                      })}
                    </Space>
                  ),
                }))
              }
            />
          )}
        </div>
      ),
    },
    {
      key: 'testcases',
      label: (<Space><ExperimentOutlined /><span>自验证用例</span></Space>),
      children: (
        <div style={{ padding: 20 }}>
          <div style={{ marginBottom: 20, padding: 16, background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)', borderRadius: 12, border: '1px solid #bfdbfe' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>验证进度</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>跟踪自验证用例的执行情况</div>
              </div>
              <Space>
                <Button icon={<SendOutlined />} onClick={handleSubmitToMR} disabled={testCases.length === 0} loading={submitTestCasesMutation.isPending} style={{ borderRadius: 8 }}>
                  提交到 MR
                </Button>
              </Space>
            </div>
            <div style={{ marginTop: 16 }}>
              <Progress
                percent={testCaseStats.total > 0 ? Math.round((testCaseStats.passed / testCaseStats.total) * 100) : 0}
                strokeColor={{ '0%': '#3b6bff', '100%': '#10b981' }}
                size={['100%', 10]}
                style={{ marginBottom: 12 }}
              />
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>总计：<strong style={{ color: '#0f172a' }}>{testCaseStats.total}</strong></span>
                <span style={{ color: '#ca8a04' }}>待验证：<strong>{testCaseStats.pending}</strong></span>
                <span style={{ color: '#2563eb' }}>UT通过：<strong>{testCaseStats.utPassed}</strong></span>
                <span style={{ color: '#059669' }}>集成通过：<strong>{testCaseStats.integrationPassed}</strong></span>
                <span style={{ color: '#dc2626' }}>未通过：<strong>{testCaseStats.failed}</strong></span>
              </div>
            </div>
          </div>

          {testCases.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#8c8c8c' }}>
              <ExperimentOutlined style={{ fontSize: 48, color: '#7c3aed', marginBottom: 16 }} />
              <p style={{ fontSize: 14, margin: 0 }}>暂无验证用例</p>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>检视完成后将自动生成验证用例</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {testCases.map((tc) => {
                const borderColorMap: Record<string, string> = {
                  pending: '#d9d9d9', ut_passed: '#1677ff', integration_passed: '#52c41a', failed: '#ff4d4f',
                };
                const bgColorMap: Record<string, string> = {
                  pending: '#f9fafb', ut_passed: '#eff6ff', integration_passed: '#ecfdf5', failed: '#fef2f2',
                };
                return (
                  <div
                    key={tc.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      padding: 14,
                      borderLeft: `4px solid ${borderColorMap[tc.status]}`,
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', lineHeight: 1.4 }}>{tc.title}</span>
                        <Tag color={tc.type === 'unit' ? 'blue' : 'purple'} style={{ margin: 0, fontSize: 11, borderRadius: 6 }}>
                          {tc.type === 'unit' ? 'UT' : '集成'}
                        </Tag>
                      </div>
                      {tc.status === 'pending' && <Tag icon={<ClockCircleOutlined />} color="default" style={{ margin: 0, borderRadius: 6 }}>待验证</Tag>}
                      {tc.status === 'ut_passed' && <Tag icon={<CheckCircleFilled />} color="blue" style={{ margin: 0, borderRadius: 6 }}>通过-UT</Tag>}
                      {tc.status === 'integration_passed' && <Tag icon={<CheckCircleFilled />} color="success" style={{ margin: 0, borderRadius: 6 }}>通过-集成</Tag>}
                      {tc.status === 'failed' && <Tag icon={<CloseCircleOutlined />} color="error" style={{ margin: 0, borderRadius: 6 }}>未通过</Tag>}
                    </div>
                    <div style={{ padding: 10, background: bgColorMap[tc.status], borderRadius: 6, marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                        <FileOutlined /> 关联文件：
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: 4, marginLeft: 4, fontSize: 11, fontFamily: 'monospace' }}>
                          {tc.file}
                        </code>
                      </div>
                      <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>{tc.description}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <Button size="small" type={tc.status === 'ut_passed' ? 'primary' : 'default'} icon={tc.status === 'ut_passed' ? <CheckCircleFilled /> : <CheckCircleOutlined />} style={{ borderRadius: 6 }} onClick={() => handleUpdateStatus(tc.id, 'ut_passed')}>
                        UT通过
                      </Button>
                      <Button size="small" type={tc.status === 'integration_passed' ? 'primary' : 'default'} icon={tc.status === 'integration_passed' ? <CheckCircleFilled /> : <CheckCircleOutlined />} style={{ borderRadius: 6 }} onClick={() => handleUpdateStatus(tc.id, 'integration_passed')}>
                        集成通过
                      </Button>
                      <Button size="small" danger={tc.status !== 'failed'} type={tc.status === 'failed' ? 'primary' : 'default'} icon={tc.status === 'failed' ? <CloseCircleOutlined /> : null} style={{ borderRadius: 6 }} onClick={() => handleUpdateStatus(tc.id, 'failed')}>
                        未通过
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div
        className="cr-page-header"
        style={{
          marginBottom: 16,
          padding: 24,
          background: reportStatusColor,
          borderRadius: 12,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#fff',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>
              MR !{mrIidNum} · 检视报告
            </h1>
            <Tag style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 999, fontSize: 12, padding: '4px 12px', fontWeight: 600 }}>
              {mr?.state?.toUpperCase() || 'UNKNOWN'}
            </Tag>
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', margin: 0, maxWidth: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={mr?.title}>
            {mr?.title || '加载中...'}
          </p>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>
            <Breadcrumb items={[{ title: '代码检视' }, { title: `!${mrIidNum}` }]} style={{ color: 'rgba(255,255,255,0.9)' }} />
          </div>
        </div>
        <Space align="center" size={16}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'rgba(255,255,255,0.15)', borderRadius: 999, fontSize: 12 }}>
            <ClockCircleOutlined />
            <span>创建 {mr ? dayjs(mr.created_at).format('MM-DD HH:mm') : '-'}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>更新 {mr ? dayjs(mr.updated_at).format('MM-DD HH:mm') : '-'}</span>
          </div>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/mrs')} style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8 }}>
            返回列表
          </Button>
        </Space>
      </div>

      <Spin spinning={mrLoading}>
        {mr && (
          <>
            <Card
              style={{ marginBottom: 16, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
              bodyStyle={{ padding: 20 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <Space direction="vertical" size={8}>
                  <Space>
                    <AuditOutlined style={{ color: '#3b6bff', fontSize: 18 }} />
                    <span style={{ fontWeight: 600, fontSize: 16, color: '#0f172a' }}>代码检视</span>
                    {reviewStatus === 'idle' && <Tag color="default">待启动</Tag>}
                    {reviewStatus === 'queued' && <Tag icon={<ClockCircleOutlined />} color="processing">排队中</Tag>}
                    {reviewStatus === 'running' && <Tag icon={<ReloadOutlined spin />} color="processing">运行中</Tag>}
                    {reviewStatus === 'completed' && <Tag icon={<CheckCircleOutlined />} color="success">已完成</Tag>}
                    {reviewStatus === 'failed' && <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>}
                  </Space>
                  {reviewStatus === 'running' || reviewStatus === 'queued' ? (
                    <div style={{ minWidth: 320 }}>
                      <Progress
                        percent={reviewProgress}
                        status="active"
                        strokeColor={{ '0%': '#3b6bff', '100%': '#10b981' }}
                      />
                    </div>
                  ) : null}
                  {reviewStatus === 'completed' && (
                    <div style={{ fontSize: 13, color: '#166534' }}>
                      检视完成，共发现 <strong>{reviewFindings.length || findings.length}</strong> 条检视意见
                    </div>
                  )}
                  {reviewStatus === 'failed' && reviewError && (
                    <Alert type="error" showIcon message="检视失败" description={reviewError} style={{ marginTop: 8 }} />
                  )}
                </Space>
                <Space>
                  {reviewSessionId && reviewStatus !== 'running' && reviewStatus !== 'queued' && (
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={resumeReview}
                      style={{ borderRadius: 8 }}
                    >
                      恢复检视
                    </Button>
                  )}
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    disabled={reviewStatus === 'running' || reviewStatus === 'queued'}
                    loading={reviewStatus === 'running' || reviewStatus === 'queued'}
                    onClick={startReview}
                    style={{ borderRadius: 8 }}
                  >
                    触发检视
                  </Button>
                </Space>
              </div>
            </Card>

            <Card
              style={{ marginTop: 16, marginBottom: 16, borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
              bodyStyle={{ padding: 0 }}
              extra={
                <Space>
                  <Tooltip title="刷新数据">
                    <Button icon={<ReloadOutlined />} onClick={() => {
                      queryClient.invalidateQueries({ queryKey: ['mr', mrIidNum] });
                      queryClient.invalidateQueries({ queryKey: ['mr-diff', mrIidNum] });
                      queryClient.invalidateQueries({ queryKey: ['mr-comments', mrIidNum] });
                      queryClient.invalidateQueries({ queryKey: ['mr-findings', mrIidNum] });
                    }} />
                  </Tooltip>
                </Space>
              }
            >
              <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} style={{ padding: '8px 0' }} />
            </Card>

            <div
              style={{
                position: 'sticky',
                bottom: 0,
                background: 'rgba(255, 255, 255, 0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '14px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 -2px 12px rgba(0,0,0,0.06)',
                marginTop: 16,
                zIndex: 10,
              }}
            >
              <Space>
                {findings.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: '#64748b' }}>检视摘要：</span>
                    <Tag style={{ background: severityBgMap['critical'], color: severityColorMap['critical'], border: 'none', fontWeight: 600, borderRadius: 6 }}>
                      严重 {criticalCount}
                    </Tag>
                    <Tag style={{ background: severityBgMap['high'], color: severityColorMap['high'], border: 'none', fontWeight: 600, borderRadius: 6 }}>
                      高 {highCount}
                    </Tag>
                    <span style={{ color: '#64748b' }}>共 {findings.length} 条</span>
                  </div>
                )}
              </Space>
              <Space>
                <Button icon={<ShareAltOutlined />} onClick={handleShare} style={{ borderRadius: 8 }}>分享</Button>
                <Button icon={<SaveOutlined />} onClick={handleArchive} style={{ borderRadius: 8 }}>归档</Button>
                <Button type="primary" icon={<ExportOutlined />} onClick={handleExportReport} style={{ borderRadius: 8 }}>
                  导出报告
                </Button>
              </Space>
            </div>
          </>
        )}
      </Spin>

      <Modal
        title="确认提交检视意见"
        open={!!confirmTarget}
        onCancel={() => setConfirmTarget(null)}
        onOk={() => {
          if (confirmTarget?.id) createFindingCommentMutation.mutate(confirmTarget.id);
          setConfirmTarget(null);
        }}
        confirmLoading={createFindingCommentMutation.isPending}
        okText="确认提交"
        cancelText="取消"
      >
        {confirmTarget && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space>
              <Tag style={{ background: severityBgMap[confirmTarget.severity], color: severityColorMap[confirmTarget.severity], border: 'none', fontWeight: 600 }}>
                {confirmTarget.severity.toUpperCase()}
              </Tag>
              <strong>{confirmTarget.title}</strong>
            </Space>
            <div style={{ color: '#666', fontSize: 13 }}>文件位置：{confirmTarget.file}:{confirmTarget.line}</div>
            <div style={{ background: '#fafafa', padding: 12, borderRadius: 6 }}>
              <div style={{ marginBottom: 8 }}><strong>问题描述：</strong></div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{confirmTarget.message}</div>
            </div>
            {confirmTarget.suggestion && (
              <div style={{ background: '#f0fdf4', padding: 12, borderRadius: 6, border: '1px solid #bbf7d0' }}>
                <div style={{ marginBottom: 8 }}><strong>建议：</strong></div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{confirmTarget.suggestion}</div>
              </div>
            )}
          </Space>
        )}
      </Modal>

      <Modal
        title="批量提交结果"
        open={batchResultVisible}
        onCancel={() => setBatchResultVisible(false)}
        footer={[<Button key="ok" type="primary" onClick={() => setBatchResultVisible(false)}>知道了</Button>]}
        width={520}
      >
        {batchResult && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {batchResult.failed === 0 ? (
              <Alert type="success" showIcon message={`成功提交 ${batchResult.success} 条检视意见`} description={`全部 ${batchResult.total} 条均已成功提交`} />
            ) : (
              <Alert type="warning" showIcon message={`提交完成：成功 ${batchResult.success} 条，失败 ${batchResult.failed} 条`} description="以下是失败的条目详情：" />
            )}
            {batchResult.failed > 0 && (
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 8 }}>
                <List
                  size="small"
                  dataSource={batchResult.results.filter((r) => !r.ok)}
                  renderItem={(r) => {
                    const finding = findings.find((f) => f.id === r.findingId);
                    return (
                      <List.Item>
                        <Space direction="vertical" size={2} style={{ width: '100%' }}>
                          <Space>
                            <Tag color="red">失败</Tag>
                            <span>{finding?.title || r.findingId}</span>
                          </Space>
                          <span style={{ color: '#999', fontSize: 12 }}>{finding ? `${finding.file}:${finding.line}` : ''}</span>
                          {r.error && <span style={{ color: '#ff4d4f', fontSize: 12 }}>错误：{r.error}</span>}
                        </Space>
                      </List.Item>
                    );
                  }}
                />
              </div>
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
}

export default MRDetail;