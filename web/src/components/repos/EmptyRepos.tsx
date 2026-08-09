import { Button, Space } from 'antd';
import { InboxOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

interface EmptyReposProps {
  onClone: () => void;
}

export default function EmptyRepos({ onClone }: EmptyReposProps) {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ marginBottom: 24 }}>
        <InboxOutlined
          style={{
            fontSize: 72,
            color: 'var(--cr-ink-4)',
            opacity: 0.6,
          }}
        />
      </div>
      <h3 style={{ color: 'var(--cr-ink-1)', marginBottom: 8, fontWeight: 600 }}>
        还没有本地仓库
      </h3>
      <p style={{ color: 'var(--cr-ink-3)', marginBottom: 24, fontSize: 14 }}>
        克隆一个 CodeHub 仓库开始您的代码检视工作
      </p>
      <Space size={12}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onClone}>
          克隆仓库
        </Button>
        <Button onClick={() => navigate('/settings')}>前往设置</Button>
      </Space>
      <div
        style={{
          marginTop: 40,
          padding: 20,
          background: 'var(--cr-bg-subtle)',
          borderRadius: 12,
          maxWidth: 480,
          margin: '40px auto 0',
          textAlign: 'left',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--cr-ink-2)' }}>
          快速上手
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontSize: 13,
            color: 'var(--cr-ink-3)',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--cr-brand-500)' }}>1.</span>
            <span>
              确保已在{' '}
              <a
                onClick={() => navigate('/settings')}
                style={{ color: 'var(--cr-brand-500)', cursor: 'pointer' }}
              >
                设置
              </a>{' '}
              页面配置 CodeHub 连接
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--cr-brand-500)' }}>2.</span>
            <span>点击「克隆仓库」选择项目进行克隆</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--cr-brand-500)' }}>3.</span>
            <span>
              返回{' '}
              <a
                onClick={() => navigate('/dashboard')}
                style={{ color: 'var(--cr-brand-500)', cursor: 'pointer' }}
              >
                仪表盘
              </a>{' '}
              开始代码检视
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}