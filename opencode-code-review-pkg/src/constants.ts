// src/constants.ts — 项目常量定义

import type { FilterConfig, BundleConfig } from './types.js';

/** 默认文件过滤配置 */
export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  ignorePatterns: [
    '**/*.min.js',
    '**/*.min.css',
    '**/*.bundle.js',
    '**/*.map',
    '**/node_modules/**',
    '**/vendor/**',
    '**/*.lock',
    '**/*.log',
  ],
  includeBinary: false,
  maxPatchLength: 100_000,
};

/** 默认文件打包配置 */
export const DEFAULT_BUNDLE_CONFIG: BundleConfig = {
  bundles: [],
};

/** 严重度排序映射 */
export const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** diff 最大允许大小（字符数） */
export const MAX_DIFF_SIZE = 5_000_000;

/** 高置信度阈值 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.85;

/** 默认 IoU 去重阈值 */
export const DEFAULT_IOU_THRESHOLD = 0.5;

/** 迭代 5：大 PR 阈值，文件数 ≥ 此值时触发分批处理 */
export const LARGE_PR_THRESHOLD = 30;

/** 迭代 5：默认分批大小（每批文件数） */
export const DEFAULT_BATCH_SIZE = 10;
