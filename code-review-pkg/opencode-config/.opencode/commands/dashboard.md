---
description: 生成代码审查仪表盘数据，包含趋势分析、KPI 指标和图表数据
agent: code-reviewer
subtask: true
params:
  - name: sessions
    type: array
    description: 会话快照列表，包含 id、status、filesTotal、filesProcessed、createdAt、updatedAt 等字段
    optional: true
  - name: findings
    type: array
    description: 所有 findings 列表，用于统计严重度分布和类别分布
    optional: true
  - name: tokenConsumed
    type: number
    description: 消耗的 Token 总数
    optional: true
    default: 0
  - name: findingsBySession
    type: object
    description: 按会话 ID 分组的 findings 映射，用于趋势分析
    optional: true
---

## 代码审查仪表盘生成任务

### 命令说明
本命令用于生成代码审查仪表盘数据，聚合历史审查数据并输出可直接渲染的图表数据结构。

### 输入参数
- **sessions**: 会话快照列表
- **findings**: 所有 findings 列表
- **tokenConsumed**: 消耗的 Token 总数
- **findingsBySession**: 按会话 ID 分组的 findings 映射（用于趋势分析）

### 输出格式
输出格式为 JSON，包含以下结构：

```json
{
  "kpi": {
    "prCoverage": 0.8,
    "fileCoverage": 0.95,
    "acceptRate": 0.75,
    "totalFindings": 100,
    "totalSessions": 50,
    "totalTokens": 10000
  },
  "charts": {
    "severityPie": { "critical": 5, "high": 20, "medium": 40, "low": 30, "info": 5 },
    "categoryBar": { "security": 30, "quality": 40, "performance": 20, "architecture": 10 },
    "trendLine": [
      { "bucketStart": 1717171200000, "bucketEnd": 1717257600000, "findingCount": 10, "sessionCount": 5 },
      { "bucketStart": 1717257600000, "bucketEnd": 1717344000000, "findingCount": 15, "sessionCount": 8 }
    ],
    "ruleEffectiveness": [
      { "ruleId": "sql-injection", "acceptRate": 0.9, "grade": "good" }
    ]
  },
  "metrics": {
    "coverage": { ... },
    "quality": { ... },
    "cost": { ... },
    "efficiency": { ... },
    "trend": { ... }
  }
}
```

### 使用方式
```bash
# 从标准输入读取 JSON 数据并生成仪表盘
cat metrics-input.json | code-review dashboard

# 输入数据格式示例
{
  "sessions": [...],
  "findings": [...],
  "tokenConsumed": 1000
}
```

### 核心指标说明
1. **KPI 卡片**: PR 覆盖率、文件覆盖率、接受率、总 finding 数、总会话数、总 Token 消耗
2. **严重度分布饼图**: 按 critical/high/medium/low/info 统计
3. **类别分布柱状图**: 按类别统计 finding 数量
4. **趋势折线图**: 按天分桶，展示 finding 和会话数量变化趋势
5. **规则有效性排行**: 按接受率排序的规则有效性评估

### 趋势方向说明
- **increasing**: 近期 finding 数量上升，表示审查质量恶化
- **decreasing**: 近期 finding 数量下降，表示审查质量改善
- **stable**: finding 数量无明显变化

## Examples

### 场景 1：生成完整仪表盘
生成包含所有 KPI、图表和趋势数据的完整仪表盘。

```bash
code-review dashboard --input metrics-data.json
```

### 场景 2：指定时间范围生成
生成最近 30 天的仪表盘数据。

```bash
code-review dashboard --range 30d
```

### 场景 3：仅生成趋势图表
只生成趋势分析相关的图表数据，用于监控面板集成。

```bash
code-review dashboard --charts trend
```