import { useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Button,
  Space,
  Divider,
} from 'antd';
import {
  FolderOutlined,
  CloudDownloadOutlined,
  SwapOutlined,
  BranchesOutlined,
} from '@ant-design/icons';
import type { RepoConfig } from '@/api/codehub';

interface CloneRepoModalProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
  confirmLoading: boolean;
  form: any;
  projectOptions: { value: string; label: string }[];
  branchOptions: { value: string; label: string }[];
  cloneProjectId: string | undefined;
  onValuesChange: (changed: any, all: any) => void;
}

export function CloneRepoModal({
  open,
  onOk,
  onCancel,
  confirmLoading,
  form,
  projectOptions,
  branchOptions,
  cloneProjectId,
  onValuesChange,
}: CloneRepoModalProps) {
  useEffect(() => {
    if (!open) {
      form.resetFields();
    }
  }, [open, form]);

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderOutlined style={{ color: 'var(--cr-brand-500)' }} />
          <span>克隆仓库</span>
        </div>
      }
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      okText="开始克隆"
      cancelText="取消"
      width={560}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 8 }}
        onValuesChange={onValuesChange}
      >
        <Form.Item
          label="选择项目"
          name="projectId"
          rules={[{ required: true, message: '请选择或输入项目 ID' }]}
          tooltip="从已配置的仓库列表中选择，或直接输入项目 ID"
        >
          <Select
            showSearch
            placeholder="选择项目或输入 projectId"
            filterOption={(input, option) =>
              ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
            }
            notFoundContent={
              <div style={{ padding: 8 }}>
                <div style={{ color: 'var(--cr-ink-3)', marginBottom: 8, fontSize: 13 }}>
                  未找到匹配的项目，可直接输入 projectId
                </div>
                <Input
                  placeholder="例如: group/project-name"
                  onChange={(e) => form.setFieldsValue({ projectId: e.target.value })}
                />
              </div>
            }
            options={projectOptions}
            mode="tags"
            tokenSeparators={['\n']}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="分支选择" name="branch" tooltip="选择要克隆的分支，留空使用默认分支">
          <Select
            placeholder={branchOptions.length > 0 ? '选择分支（留空使用默认分支）' : '请先选择项目加载分支列表'}
            allowClear
            options={branchOptions}
            disabled={!cloneProjectId}
            notFoundContent={cloneProjectId ? '暂无分支数据，可手动输入' : '请先选择项目'}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Divider style={{ margin: '12px 0' }} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: 'var(--cr-bg-subtle)',
            borderRadius: 10,
            border: '1px solid var(--cr-border)',
          }}
        >
          <div>
            <div style={{ fontWeight: 500, color: 'var(--cr-ink-2)' }}>
              <CloudDownloadOutlined style={{ marginRight: 6 }} />
              浅克隆
            </div>
            <div style={{ fontSize: 12, color: 'var(--cr-ink-3)', marginTop: 2 }}>
              仅克隆最近 N 次提交，速度更快、占用空间更小
            </div>
          </div>
          <Form.Item name="shallow" valuePropName="checked" noStyle>
            <Switch />
          </Form.Item>
        </div>

        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.shallow !== cur.shallow}>
          {({ getFieldValue }) =>
            getFieldValue('shallow') ? (
              <Form.Item
                label="克隆深度"
                name="depth"
                rules={[{ required: true, message: '请输入克隆深度' }]}
                initialValue={1}
                style={{ marginTop: 12 }}
              >
                <InputNumber
                  min={1}
                  max={100}
                  placeholder="推荐 1"
                  style={{ width: '100%' }}
                  addonAfter="次提交"
                />
              </Form.Item>
            ) : null
          }
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface CheckoutModalProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
  confirmLoading: boolean;
  form: any;
}

export function CheckoutModal({
  open,
  onOk,
  onCancel,
  confirmLoading,
  form,
}: CheckoutModalProps) {
  useEffect(() => {
    if (!open) {
      form.resetFields();
    }
  }, [open, form]);

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SwapOutlined style={{ color: 'var(--cr-brand-500)' }} />
          <span>切换分支</span>
        </div>
      }
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      okText="切换"
      cancelText="取消"
      width={440}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item
          label="目标分支"
          name="branch"
          rules={[{ required: true, message: '请输入分支名' }]}
        >
          <Input
            placeholder="分支名称，例如: feature/login"
            prefix={<BranchesOutlined style={{ color: 'var(--cr-ink-4)' }} />}
          />
        </Form.Item>
        <div style={{ fontSize: 12, color: 'var(--cr-ink-4)' }}>
          提示：请确保分支存在且已从远端 fetch。
        </div>
      </Form>
    </Modal>
  );
}