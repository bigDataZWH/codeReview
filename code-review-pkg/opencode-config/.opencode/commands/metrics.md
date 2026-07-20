---
description: 展示代码审查度量指标，包括 findings 统计、严重度分布和误报率等会话级 KPI
agent: code-reviewer
subtask: true
---

## 度量指标查询任务

### 任务目标
收集并展示当前会话的代码审查度量指标，帮助团队了解审查质量和效率。

### 指标维度

**覆盖率指标（Coverage）**
- PR 覆盖率：已完成会话数 / 总会话数
- 文件覆盖率：已处理文件数 / 总文件数
- 总会话数与已完成会话数

**质量指标（Quality）**
- 平均每文件 finding 数
- 严重度分布：critical / high / medium / low / info
- 接受率：accept / (accept + reject + modify)
- 误报率（rejectRate）：reject / (accept + reject + modify)
- 类别分布

**成本指标（Cost）**
- 总 Token 消耗
- 每千行代码 Token 消耗

**效率指标（Efficiency）**
- 修复率：accept / total findings
- 总耗时与平均每会话耗时

**趋势指标（Trend）**
- 按时间分桶的 finding 数变化
- 趋势方向：increasing / decreasing / stable

### 调用方式
使用 `collectMetrics` 函数生成完整度量指标：

```typescript
import { collectMetrics, generateDashboardData } from './src/metrics.js';

const metrics = collectMetrics({
  sessions: [...],
  findings: [...],
  feedback: feedbackStore,
  tokenConsumed: 0,
});

const dashboard = generateDashboardData({
  sessions: [...],
  findings: [...],
  feedback: feedbackStore,
});
```

### 输出格式
输出为 JSON 格式，包含以下结构：

```json
{
  "coverage": {
    "prCoverage": 0.8,
    "fileCoverage": 0.95,
    "totalSessions": 10,
    "completedSessions": 8
  },
  "quality": {
    "avgFindingsPerFile": 2.5,
    "severityDistribution": {
      "critical": 2,
      "high": 5,
      "medium": 10,
      "low": 8,
      "info": 5
    },
    "acceptRate": 0.7,
    "rejectRate": 0.2,
    "categoryDistribution": {
      "security": 15,
      "performance": 8,
      "maintainability": 7
    }
  },
  "cost": {
    "tokenConsumed": 50000,
    "tokensPerKLine": 2000
  },
  "efficiency": {
    "fixRate": 0.7,
    "totalDurationMs": 300000,
    "avgDurationPerSession": 30000
  },
  "trend": {
    "buckets": [...],
    "direction": "decreasing"
  }
}
```

### 关键 KPI 解读
- **findings count**：总 findings 数量，反映代码问题密度
- **severity distribution**：严重度分布，帮助识别高风险问题
- **false positive rate（rejectRate）**：误报率，衡量审查准确性，越低越好

## Examples

### 场景 1：获取当前会话指标
查看本次审查会话的完整度量指标。

```bash
code-review metrics
```

### 场景 2：对比历史指标趋势
获取最近 7 天的指标趋势数据，分析审查质量变化。

```bash
code-review metrics --history 7d
```

### 场景 3：导出指标报告
将指标数据导出为 JSON 文件，用于自定义报表或集成到 CI 流程。

```bash
code-review metrics --export metrics-report.json
```