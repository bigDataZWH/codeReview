// src/compliance-checker.ts — Task 12：合规检查
//
// 职责：
// 1. OWASP_TOP_10 常量：OWASP Top 10 (2021) 安全风险类别
// 2. CWE_TOP_25 常量：CWE Top 25 (2023) 最危险软件弱点
// 3. ComplianceChecker 类：将 findings 映射到 OWASP/CWE 类别，生成合规报告
// 4. checkCompliance：便捷函数，对 findings 进行合规检查并返回报告
//
// 设计取舍：
// - 通过 finding.category / finding.ruleId / finding.message 关键词匹配 OWASP/CWE 类别
// - 合规报告按 OWASP 类别聚合，统计每类的 findings 数量与严重度分布
// - 支持自定义映射规则（customMappings）扩展内置关键词
// - 报告同时给出"已覆盖类别"与"未覆盖类别"（提醒关注未检测到的风险）
//
// 与 cli.ts 集成：
// - compliance 命令：从 stdin 读取 findings JSON，输出合规报告
// - 报告格式：JSON，包含 standards / summary / categories / uncovered

import type { Finding, Severity } from './types.js';

/** OWASP Top 10 类别 ID */
export type OwaspCategoryId =
  | 'A01'
  | 'A02'
  | 'A03'
  | 'A04'
  | 'A05'
  | 'A06'
  | 'A07'
  | 'A08'
  | 'A09'
  | 'A10';

/** CWE Top 25 条目 ID（如 CWE-79） */
export type CweId = string;

/** OWASP Top 10 (2021) 类别定义 */
export interface OwaspCategory {
  /** 类别 ID（如 'A01'） */
  id: OwaspCategoryId;
  /** 完整标识（如 'A01:2021'） */
  fullId: string;
  /** 英文名称 */
  name: string;
  /** 中文名称 */
  chineseName: string;
  /** 关键词列表（用于匹配 finding.category / ruleId / message） */
  keywords: string[];
  /** 关联的 CWE ID 列表 */
  cweIds: CweId[];
}

/** CWE Top 25 条目定义 */
export interface CweEntry {
  /** CWE ID（如 'CWE-79'） */
  id: CweId;
  /** 弱点名称 */
  name: string;
  /** 关键词列表 */
  keywords: string[];
  /** 关联的 OWASP 类别 ID */
  owaspId?: OwaspCategoryId;
}

/**
 * OWASP Top 10 (2021) 类别列表。
 *
 * 参考：https://owasp.org/Top10/
 */
export const OWASP_TOP_10: OwaspCategory[] = [
  {
    id: 'A01',
    fullId: 'A01:2021',
    name: 'Broken Access Control',
    chineseName: '失效的访问控制',
    keywords: [
      'access-control',
      'authorization',
      'rbac',
      'permission',
      'privilege',
      'broken-access',
      'missing-authz',
      'idor',
    ],
    cweIds: ['CWE-200', 'CWE-201', 'CWE-352', 'CWE-862', 'CWE-863'],
  },
  {
    id: 'A02',
    fullId: 'A02:2021',
    name: 'Cryptographic Failures',
    chineseName: '加密失败',
    keywords: [
      'crypto',
      'cryptographic',
      'encryption',
      'weak-cipher',
      'hardcoded',
      'hardcoded-secret',
      'hardcoded-password',
      'sensitive-data',
      'tls',
      'ssl',
      'md5',
      'sha1',
    ],
    cweIds: ['CWE-259', 'CWE-327', 'CWE-331', 'CWE-798'],
  },
  {
    id: 'A03',
    fullId: 'A03:2021',
    name: 'Injection',
    chineseName: '注入',
    keywords: [
      'sql-injection',
      'xss',
      'command-injection',
      'ldap-injection',
      'nosql-injection',
      'code-injection',
      'eval(',
      'xpath-injection',
    ],
    cweIds: ['CWE-79', 'CWE-89', 'CWE-77', 'CWE-90', 'CWE-918'],
  },
  {
    id: 'A04',
    fullId: 'A04:2021',
    name: 'Insecure Design',
    chineseName: '不安全设计',
    keywords: [
      'insecure-design',
      'missing-rate-limit',
      'business-logic',
      'race-condition',
      'thread-safety',
    ],
    cweIds: ['CWE-209', 'CWE-256', 'CWE-501', 'CWE-522'],
  },
  {
    id: 'A05',
    fullId: 'A05:2021',
    name: 'Security Misconfiguration',
    chineseName: '安全配置错误',
    keywords: [
      'misconfiguration',
      'debug-enabled',
      'default-credentials',
      'open-bucket',
      'cors',
      'verbose-error',
      'insecure-headers',
    ],
    cweIds: ['CWE-16', 'CWE-611', 'CWE-1004'],
  },
  {
    id: 'A06',
    fullId: 'A06:2021',
    name: 'Vulnerable and Outdated Components',
    chineseName: '易受攻击和过时的组件',
    keywords: [
      'outdated-dependency',
      'vulnerable-dependency',
      'known-cve',
      'deprecated-package',
    ],
    cweIds: ['CWE-937', 'CWE-1035'],
  },
  {
    id: 'A07',
    fullId: 'A07:2021',
    name: 'Identification and Authentication Failures',
    chineseName: '身份识别和认证失败',
    keywords: [
      'authentication',
      'auth',
      'session',
      'jwt',
      'password',
      'mfa',
      'session-fixation',
      'weak-password',
    ],
    cweIds: ['CWE-287', 'CWE-306', 'CWE-384', 'CWE-798'],
  },
  {
    id: 'A08',
    fullId: 'A08:2021',
    name: 'Software and Data Integrity Failures',
    chineseName: '软件和数据完整性失败',
    keywords: [
      'integrity',
      'deserialization',
      'unsigned-update',
      'ci-cd',
      'supply-chain',
    ],
    cweIds: ['CWE-502', 'CWE-829'],
  },
  {
    id: 'A09',
    fullId: 'A09:2021',
    name: 'Security Logging and Monitoring Failures',
    chineseName: '安全日志和监控失败',
    keywords: [
      'logging',
      'audit',
      'monitoring',
      'missing-log',
      'insufficient-log',
    ],
    cweIds: ['CWE-778', 'CWE-117'],
  },
  {
    id: 'A10',
    fullId: 'A10:2021',
    name: 'Server-Side Request Forgery (SSRF)',
    chineseName: '服务端请求伪造',
    keywords: ['ssrf', 'server-side-request', 'url-fetch', 'internal-url'],
    cweIds: ['CWE-918'],
  },
];

/**
 * CWE Top 25 (2023) 最危险软件弱点列表（节选自 MITRE CWE Top 25）。
 *
 * 参考：https://cwe.mitre.org/top25/archive/2023/2023_top_25_list.html
 */
export const CWE_TOP_25: CweEntry[] = [
  { id: 'CWE-787', name: 'Out-of-bounds Write', keywords: ['buffer-overflow', 'oob-write', 'out-of-bounds-write'], owaspId: 'A04' },
  { id: 'CWE-79', name: 'Improper Neutralization of Input During Web Page Generation (XSS)', keywords: ['xss', 'cross-site-scripting', 'script-injection'], owaspId: 'A03' },
  { id: 'CWE-89', name: 'Improper Neutralization of Special Elements used in an SQL Command (SQL Injection)', keywords: ['sql-injection', 'sql'], owaspId: 'A03' },
  { id: 'CWE-20', name: 'Improper Input Validation', keywords: ['input-validation', 'missing-validation'], owaspId: 'A04' },
  { id: 'CWE-125', name: 'Out-of-bounds Read', keywords: ['buffer-over-read', 'oob-read'], owaspId: 'A04' },
  { id: 'CWE-22', name: 'Improper Limitation of a Pathname to a Restricted Directory (Path Traversal)', keywords: ['path-traversal', 'directory-traversal', 'lfi'], owaspId: 'A01' },
  { id: 'CWE-352', name: 'Cross-Site Request Forgery (CSRF)', keywords: ['csrf', 'cross-site-request-forgery'], owaspId: 'A01' },
  { id: 'CWE-78', name: 'Improper Neutralization of Special Elements used in an OS Command (OS Command Injection)', keywords: ['command-injection', 'os-command-injection'], owaspId: 'A03' },
  { id: 'CWE-416', name: 'Use After Free', keywords: ['use-after-free', 'dangling-pointer'], owaspId: 'A04' },
  { id: 'CWE-862', name: 'Missing Authorization', keywords: ['missing-authorization', 'missing-authz'], owaspId: 'A01' },
  { id: 'CWE-863', name: 'Incorrect Authorization', keywords: ['incorrect-authorization', 'broken-access-control'], owaspId: 'A01' },
  { id: 'CWE-119', name: 'Improper Restriction of Operations within the Bounds of a Memory Buffer', keywords: ['buffer-overflow', 'memory-corruption'], owaspId: 'A04' },
  { id: 'CWE-502', name: 'Deserialization of Untrusted Data', keywords: ['deserialization', 'untrusted-deserialization'], owaspId: 'A08' },
  { id: 'CWE-287', name: 'Improper Authentication', keywords: ['improper-authentication', 'auth-bypass'], owaspId: 'A07' },
  { id: 'CWE-798', name: 'Use of Hard-coded Credentials', keywords: ['hardcoded-credentials', 'hardcoded-password', 'hardcoded-secret'], owaspId: 'A02' },
  { id: 'CWE-306', name: 'Missing Authentication for Critical Function', keywords: ['missing-authentication', 'missing-auth'], owaspId: 'A07' },
  { id: 'CWE-918', name: 'Server-Side Request Forgery (SSRF)', keywords: ['ssrf', 'server-side-request-forgery'], owaspId: 'A10' },
  { id: 'CWE-269', name: 'Improper Privilege Management', keywords: ['privilege-escalation', 'privilege-management'], owaspId: 'A01' },
  { id: 'CWE-611', name: 'Improper Restriction of XML External Entity Reference (XXE)', keywords: ['xxe', 'xml-external-entity'], owaspId: 'A05' },
  { id: 'CWE-327', name: 'Use of a Broken or Risky Cryptographic Algorithm', keywords: ['weak-crypto', 'weak-cipher', 'md5', 'sha1'], owaspId: 'A02' },
  { id: 'CWE-1004', name: 'Sensitive Cookie Without HttpOnlyFlag', keywords: ['cookie', 'httponly', 'missing-httponly'], owaspId: 'A05' },
  { id: 'CWE-732', name: 'Incorrect Permission Assignment for Critical Resource', keywords: ['permission-assignment', 'world-readable', 'world-writable'], owaspId: 'A01' },
  { id: 'CWE-259', name: 'Use of Hard-coded Password', keywords: ['hardcoded-password'], owaspId: 'A02' },
  { id: 'CWE-770', name: 'Allocation of Resources Without Limits or Throttling', keywords: ['missing-rate-limit', 'resource-exhaustion', 'dos'], owaspId: 'A04' },
  { id: 'CWE-200', name: 'Exposure of Sensitive Information to an Unauthorized Actor', keywords: ['information-disclosure', 'sensitive-data-exposure'], owaspId: 'A01' },
];

/** 单条 finding 与 OWASP/CWE 类别的映射结果 */
export interface ComplianceMapping {
  /** 原 finding */
  finding: Finding;
  /** 匹配到的 OWASP 类别（未匹配时为 undefined） */
  owaspId?: OwaspCategoryId;
  /** 匹配到的 CWE ID 列表（未匹配时为空数组） */
  cweIds: CweId[];
  /** 匹配到的关键词（用于解释为何归入该类别） */
  matchedKeywords: string[];
}

/** 单个 OWASP 类别下的合规统计 */
export interface OwaspCategoryStat {
  /** 类别 ID */
  id: OwaspCategoryId;
  /** 完整 ID（如 'A01:2021'） */
  fullId: string;
  /** 类别名称 */
  name: string;
  /** 中文名称 */
  chineseName: string;
  /** 该类别下 findings 数量 */
  findingsCount: number;
  /** 严重度分布 */
  severityDistribution: Record<Severity | 'info', number>;
  /** 关联的 findings */
  findings: Finding[];
  /** 关联的 CWE ID 列表 */
  cweIds: CweId[];
}

/** 合规检查报告 */
export interface ComplianceReport {
  /** 输入的 findings 总数 */
  totalFindings: number;
  /** 已映射到 OWASP 类别的 findings 数 */
  mappedFindings: number;
  /** 未映射到任何 OWASP 类别的 findings 数 */
  unmappedFindings: number;
  /** OWASP 覆盖率（0-1） */
  owaspCoverage: number;
  /** 按类别聚合的统计（按 findingsCount 降序） */
  categories: OwaspCategoryStat[];
  /** 未覆盖的 OWASP 类别（无 findings 命中） */
  uncoveredCategories: OwaspCategory[];
  /** 每条 finding 的详细映射（按输入顺序） */
  mappings: ComplianceMapping[];
  /** 关联的 CWE ID 集合（去重） */
  matchedCweIds: CweId[];
  /** 合规检查时间戳（ms） */
  timestamp: number;
}

/** 自定义关键词映射（finding.category → OWASP 类别 ID） */
export interface CustomMapping {
  /** 匹配 finding.category（精确匹配，大小写不敏感） */
  category?: string;
  /** 匹配 finding.ruleId（精确匹配，大小写不敏感） */
  ruleId?: string;
  /** 匹配 finding.message 子串（大小写不敏感） */
  messageContains?: string;
  /** 映射到的 OWASP 类别 ID */
  owaspId: OwaspCategoryId;
  /** 映射到的 CWE ID 列表（可选） */
  cweIds?: CweId[];
}

/**
 * 合规检查器：将 findings 映射到 OWASP/CWE 标准类别，生成合规报告。
 *
 * 使用方式：
 * 1. const checker = new ComplianceChecker() — 使用内置映射
 * 2. checker.checkCompliance(findings) — 对 findings 执行合规检查
 * 3. const checker2 = new ComplianceChecker({ customMappings: [...] }) — 扩展映射规则
 */
export class ComplianceChecker {
  /** 内置 OWASP 类别列表 */
  private readonly owaspCategories: OwaspCategory[];
  /** 内置 CWE 条目列表 */
  private readonly cweEntries: CweEntry[];
  /** 自定义映射规则 */
  private readonly customMappings: CustomMapping[];

  constructor(options?: {
    customMappings?: CustomMapping[];
    owaspCategories?: OwaspCategory[];
    cweEntries?: CweEntry[];
  }) {
    this.owaspCategories = options?.owaspCategories ?? OWASP_TOP_10;
    this.cweEntries = options?.cweEntries ?? CWE_TOP_25;
    this.customMappings = options?.customMappings ?? [];
  }

  /**
   * 将单条 finding 映射到 OWASP/CWE 类别。
   *
   * 匹配优先级：
   * 1. 自定义映射（customMappings）
   * 2. finding.category 关键词匹配 OWASP 类别
   * 3. finding.ruleId 关键词匹配 OWASP 类别
   * 4. finding.message 关键词匹配 OWASP 类别
   *
   * @param finding 待映射的 finding
   * @returns 映射结果
   */
  mapFinding(finding: Finding): ComplianceMapping {
    const matchedKeywords: string[] = [];
    const cweIds = new Set<CweId>();
    let owaspId: OwaspCategoryId | undefined;

    // 1. 自定义映射
    for (const mapping of this.customMappings) {
      if (mapping.category && finding.category.toLowerCase() !== mapping.category.toLowerCase()) {
        continue;
      }
      if (mapping.ruleId && (finding.ruleId ?? '').toLowerCase() !== mapping.ruleId.toLowerCase()) {
        continue;
      }
      if (
        mapping.messageContains &&
        !finding.message.toLowerCase().includes(mapping.messageContains.toLowerCase())
      ) {
        continue;
      }
      owaspId = mapping.owaspId;
      if (mapping.cweIds) {
        for (const cwe of mapping.cweIds) cweIds.add(cwe);
      }
      matchedKeywords.push('custom-mapping');
      break;
    }

    // 2-4. 关键词匹配
    if (!owaspId) {
      const haystacks = [
        finding.category.toLowerCase(),
        (finding.ruleId ?? '').toLowerCase(),
        finding.message.toLowerCase(),
      ];
      for (const category of this.owaspCategories) {
        for (const keyword of category.keywords) {
          const kw = keyword.toLowerCase();
          if (matchedKeywords.includes(keyword)) continue;
          if (haystacks.some((h) => h.includes(kw))) {
            owaspId = category.id;
            matchedKeywords.push(keyword);
            for (const cwe of category.cweIds) cweIds.add(cwe);
            break;
          }
        }
        if (owaspId) break;
      }
    }

    // CWE 关键词匹配（独立于 OWASP）
    const haystacks = [
      finding.category.toLowerCase(),
      (finding.ruleId ?? '').toLowerCase(),
      finding.message.toLowerCase(),
    ];
    for (const cwe of this.cweEntries) {
      // 已通过 OWASP 类别关联的 CWE 跳过
      if (cweIds.has(cwe.id)) continue;
      for (const keyword of cwe.keywords) {
        const kw = keyword.toLowerCase();
        if (haystacks.some((h) => h.includes(kw))) {
          cweIds.add(cwe.id);
          if (!owaspId && cwe.owaspId) {
            owaspId = cwe.owaspId;
          }
          break;
        }
      }
    }

    return {
      finding: { ...finding },
      owaspId,
      cweIds: [...cweIds],
      matchedKeywords,
    };
  }

  /**
   * 对 findings 执行合规检查，生成合规报告。
   *
   * @param findings 待检查的 findings 列表
   * @returns 合规检查报告
   */
  checkCompliance(findings: Finding[]): ComplianceReport {
    const mappings: ComplianceMapping[] = [];
    const categoryMap = new Map<OwaspCategoryId, OwaspCategoryStat>();
    const cweSet = new Set<CweId>();

    // 初始化类别统计容器
    for (const cat of this.owaspCategories) {
      categoryMap.set(cat.id, {
        id: cat.id,
        fullId: cat.fullId,
        name: cat.name,
        chineseName: cat.chineseName,
        findingsCount: 0,
        severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findings: [],
        cweIds: [...cat.cweIds],
      });
    }

    for (const finding of findings) {
      const mapping = this.mapFinding(finding);
      mappings.push(mapping);
      if (mapping.owaspId) {
        const stat = categoryMap.get(mapping.owaspId);
        if (stat) {
          stat.findingsCount++;
          stat.findings.push({ ...finding });
          const sev = finding.severity as Severity | 'info';
          stat.severityDistribution[sev] = (stat.severityDistribution[sev] ?? 0) + 1;
        }
      }
      for (const cwe of mapping.cweIds) {
        cweSet.add(cwe);
      }
    }

    const mappedFindings = mappings.filter((m) => m.owaspId !== undefined).length;
    const categories = [...categoryMap.values()]
      .filter((c) => c.findingsCount > 0)
      .sort((a, b) => b.findingsCount - a.findingsCount);
    const uncoveredCategories = this.owaspCategories.filter(
      (cat) => (categoryMap.get(cat.id)?.findingsCount ?? 0) === 0,
    );

    return {
      totalFindings: findings.length,
      mappedFindings,
      unmappedFindings: findings.length - mappedFindings,
      owaspCoverage: findings.length > 0 ? mappedFindings / findings.length : 0,
      categories,
      uncoveredCategories,
      mappings,
      matchedCweIds: [...cweSet].sort(),
      timestamp: Date.now(),
    };
  }

  /** 返回当前生效的 OWASP 类别列表（副本） */
  getOwaspCategories(): OwaspCategory[] {
    return [...this.owaspCategories];
  }

  /** 返回当前生效的 CWE 条目列表（副本） */
  getCweEntries(): CweEntry[] {
    return [...this.cweEntries];
  }

  /** 返回自定义映射规则（副本） */
  getCustomMappings(): CustomMapping[] {
    return [...this.customMappings];
  }
}

/**
 * 便捷函数：使用默认 ComplianceChecker 对 findings 执行合规检查。
 *
 * @param findings 待检查的 findings
 * @param checker 合规检查器实例（可选，默认新建一个）
 * @returns 合规检查报告
 */
export function checkCompliance(findings: Finding[], checker?: ComplianceChecker): ComplianceReport {
  const c = checker ?? new ComplianceChecker();
  return c.checkCompliance(findings);
}
