// src/findings-history-store.ts — findings 历史持久化 store（内存实现）
//
// 用于持久化每次检视产出的 findings，支撑后续报表指标计算
// （问题单接纳率、拦截数量、阻断合入统计等）。
// 存储介质为内存数组，进程生命周期内有效；不引入外部依赖。
import type { Finding } from './types.js';

/** 单条 findings 历史记录 */
export interface FindingHistoryRecord {
  /** 自动生成 `fh-<timestamp>-<rand6>` */
  historyId: string;
  mrIid: number | string;
  repoId: string;
  /** MR 作者 */
  author: string;
  /** 原始 finding 对象（含 severity/ruleId/file/line/message 等） */
  finding: Finding;
  /** 检视完成时间（ISO 时间戳） */
  reviewedAt: string;
  /** 是否已提交为 MR 评论 */
  submitted: boolean;
  /** 提交时间（ISO 时间戳） */
  submittedAt?: string;
  /** 作者是否已处置 */
  resolved: boolean;
  /** 是否阻断合入 */
  blockedMerge: boolean;
}

/** 历史记录查询过滤条件 */
export interface FindingsHistoryQuery {
  mrIid?: number | string;
  repoId?: string;
  /** 起始时间（ISO，含），按 reviewedAt 过滤 */
  since?: string;
  /** 截止时间（ISO，含），按 reviewedAt 过滤 */
  until?: string;
}

/** findings 历史记录 store 接口 */
export interface FindingsHistoryStore {
  /** 新增单条记录，自动生成 historyId 并返回完整记录 */
  add(record: Omit<FindingHistoryRecord, 'historyId'>): FindingHistoryRecord;
  /** 批量新增记录，返回包含 historyId 的完整记录数组 */
  addBatch(records: Array<Omit<FindingHistoryRecord, 'historyId'>>): FindingHistoryRecord[];
  /** 按 mrIid+repoId+findingId 标记 submitted=true 并记录 submittedAt */
  markSubmitted(mrIid: number | string, repoId: string, findingIds: string[]): void;
  /** 将指定 MR（mrIid+repoId）的全部历史记录 blockedMerge 置为 true */
  markBlockedMerge(mrIid: number | string, repoId: string): void;
  /** 按条件查询历史记录 */
  query(filter?: FindingsHistoryQuery): FindingHistoryRecord[];
  /** 返回全部历史记录 */
  getAll(): FindingHistoryRecord[];
  /** 清空全部历史记录 */
  clear(): void;
}

/**
 * 生成历史记录 ID：`fh-<timestamp>-<rand6>`
 */
function generateHistoryId(): string {
  return `fh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 创建一个内存版的 findings 历史记录 store。
 *
 * 使用数组存储记录，查询/更新均为线性扫描；适用于单进程、中等数据量场景。
 */
export function createFindingsHistoryStore(): FindingsHistoryStore {
  // 内存存储：按写入顺序保存全部历史记录
  const records: FindingHistoryRecord[] = [];

  return {
    add(record) {
      const full: FindingHistoryRecord = {
        ...record,
        historyId: generateHistoryId(),
      };
      records.push(full);
      return full;
    },

    addBatch(batch) {
      const result: FindingHistoryRecord[] = batch.map((record) => ({
        ...record,
        historyId: generateHistoryId(),
      }));
      records.push(...result);
      return result;
    },

    markSubmitted(mrIid, repoId, findingIds) {
      if (findingIds.length === 0) return;
      // 用 Set 加速 findingId 命中判断
      const idSet = new Set(findingIds);
      const now = new Date().toISOString();
      for (const r of records) {
        // 先按 mrIid+repoId 粗筛，再按 finding.id 精确匹配
        if (r.mrIid === mrIid && r.repoId === repoId) {
          const fid = r.finding?.id;
          if (fid && idSet.has(fid)) {
            r.submitted = true;
            r.submittedAt = now;
          }
        }
      }
    },

    markBlockedMerge(mrIid, repoId) {
      for (const r of records) {
        if (r.mrIid === mrIid && r.repoId === repoId) {
          r.blockedMerge = true;
        }
      }
    },

    query(filter) {
      if (!filter) return [...records];
      return records.filter((r) => {
        if (filter.mrIid !== undefined && r.mrIid !== filter.mrIid) return false;
        if (filter.repoId !== undefined && r.repoId !== filter.repoId) return false;
        // since/ununtil 按 reviewedAt 做字符串比较（ISO8601 字典序与时间序一致）
        if (filter.since !== undefined && r.reviewedAt < filter.since) return false;
        if (filter.until !== undefined && r.reviewedAt > filter.until) return false;
        return true;
      });
    },

    getAll() {
      return [...records];
    },

    clear() {
      records.length = 0;
    },
  };
}
