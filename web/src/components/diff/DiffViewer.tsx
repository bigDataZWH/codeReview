import { useState, useMemo } from 'react';
import { Card, Tooltip, Tag, Space } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { DiffFile } from '@/api/codehub';

interface Finding {
  file: string;
  line: number;
  title: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion?: string;
  ruleId?: string;
}

interface DiffViewerProps {
  diffFile?: DiffFile;
  findings?: Finding[];
}

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'hunk';
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

const severityColorMap: Record<string, string> = {
  critical: '#ff4d4f',
  high: '#fa8c16',
  medium: '#faad14',
  low: '#1677ff',
  info: '#52c41a',
};

function parseDiff(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;

  const diffLines = diffText.split('\n');

  for (const line of diffLines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10) - 1;
        newLineNum = parseInt(match[2], 10) - 1;
      }
      lines.push({
        type: 'hunk',
        oldLine: null,
        newLine: null,
        content: line,
      });
      continue;
    }

    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }

    if (line.startsWith('+')) {
      newLineNum++;
      lines.push({
        type: 'added',
        oldLine: null,
        newLine: newLineNum,
        content: line.slice(1),
      });
    } else if (line.startsWith('-')) {
      oldLineNum++;
      lines.push({
        type: 'removed',
        oldLine: oldLineNum,
        newLine: null,
        content: line.slice(1),
      });
    } else {
      oldLineNum++;
      newLineNum++;
      lines.push({
        type: 'context',
        oldLine: oldLineNum,
        newLine: newLineNum,
        content: line.startsWith(' ') ? line.slice(1) : line,
      });
    }
  }

  return lines;
}

function DiffViewer({ diffFile, findings = [] }: DiffViewerProps) {
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  const diffLines = useMemo(() => {
    if (!diffFile?.diff) return [];
    return parseDiff(diffFile.diff);
  }, [diffFile]);

  const findingsByNewLine = useMemo(() => {
    const result: Record<number, Finding[]> = {};
    for (const f of findings) {
      if (!result[f.line]) result[f.line] = [];
      result[f.line].push(f);
    }
    return result;
  }, [findings]);

  if (!diffFile) {
    return null;
  }

  const getLineBg = (type: string): string => {
    switch (type) {
      case 'added':
        return '#e6ffec';
      case 'removed':
        return '#ffebe9';
      case 'hunk':
        return '#ddf4ff';
      default:
        return 'transparent';
    }
  };

  const getLineNumBg = (type: string): string => {
    switch (type) {
      case 'added':
        return '#ccffd8';
      case 'removed':
        return '#ffd7d5';
      case 'hunk':
        return '#b6e3ff';
      default:
        return '#f6f8fa';
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <span style={{ fontFamily: 'monospace' }}>{diffFile.new_path}</span>
          {diffFile.new_file && <Tag color="green">新增</Tag>}
          {diffFile.deleted_file && <Tag color="red">删除</Tag>}
          {diffFile.renamed_file && <Tag color="blue">重命名</Tag>}
          {diffFile.binary && <Tag color="purple">二进制</Tag>}
        </Space>
      }
    >
      {diffFile.binary ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
          二进制文件，无法显示 diff
        </div>
      ) : (
        <div
          style={{
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.6,
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {diffLines.map((line, idx) => {
                const lineFindings = line.newLine ? findingsByNewLine[line.newLine] ?? [] : [];
                const hasFindings = lineFindings.length > 0;

                return (
                  <tr
                    key={idx}
                    style={{
                      backgroundColor: getLineBg(line.type),
                      cursor: hasFindings ? 'pointer' : 'default',
                    }}
                    onMouseEnter={() => setHoveredLine(line.newLine ?? null)}
                    onMouseLeave={() => setHoveredLine(null)}
                  >
                    <td
                      style={{
                        width: 50,
                        textAlign: 'right',
                        padding: '0 8px',
                        color: '#999',
                        userSelect: 'none',
                        backgroundColor: getLineNumBg(line.type),
                        borderRight: '1px solid #eee',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {line.oldLine ?? ''}
                    </td>
                    <td
                      style={{
                        width: 50,
                        textAlign: 'right',
                        padding: '0 8px',
                        color: '#999',
                        userSelect: 'none',
                        backgroundColor: getLineNumBg(line.type),
                        borderRight: '1px solid #eee',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {line.newLine ?? ''}
                      {hasFindings && (
                        <Tooltip
                          title={
                            <div>
                              {lineFindings.map((f, i) => (
                                <div key={i} style={{ marginBottom: i < lineFindings.length - 1 ? 8 : 0 }}>
                                  <Tag color={severityColorMap[f.severity]} style={{ marginBottom: 4 }}>
                                    {f.severity.toUpperCase()}
                                  </Tag>
                                  <div style={{ fontWeight: 500 }}>{f.title}</div>
                                  <div style={{ fontSize: 12, opacity: 0.9 }}>{f.message}</div>
                                </div>
                              ))}
                            </div>
                          }
                        >
                          <WarningOutlined
                            style={{
                              color: '#fa8c16',
                              marginLeft: 4,
                              fontSize: 12,
                            }}
                          />
                        </Tooltip>
                      )}
                    </td>
                    <td
                      style={{
                        padding: '0 12px',
                        whiteSpace: 'pre',
                        color: line.type === 'hunk' ? '#0969da' : 'inherit',
                      }}
                    >
                      {line.type === 'added' && <span style={{ color: '#1a7f37', marginRight: 4 }}>+</span>}
                      {line.type === 'removed' && <span style={{ color: '#cf222e', marginRight: 4 }}>-</span>}
                      {line.content}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default DiffViewer;
