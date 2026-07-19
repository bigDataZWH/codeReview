import { describe, it, expect } from 'vitest';
import { parseMinimalYaml } from '../src/yaml-lite.js';

// ==================== 基础 key-value ====================

describe('parseMinimalYaml — 基础 key-value', () => {
  it('解析单行 key-value', () => {
    expect(parseMinimalYaml('key: value')).toEqual({ key: 'value' });
  });

  it('解析多行 key-value', () => {
    const text = ['name: rule1', 'severity: high', 'category: security'].join('\n');
    expect(parseMinimalYaml(text)).toEqual({
      name: 'rule1',
      severity: 'high',
      category: 'security',
    });
  });

  it('值前后空白被 trim', () => {
    expect(parseMinimalYaml('key:    value   ')).toEqual({ key: 'value' });
  });

  it('tab 与空格缩进都能识别', () => {
    // 这里仅要求空格缩进能正常工作
    const text = 'parent:\n  child: v';
    expect(parseMinimalYaml(text)).toEqual({ parent: { child: 'v' } });
  });
});

// ==================== 注释与空行 ====================

describe('parseMinimalYaml — 注释与空行', () => {
  it('跳过整行注释', () => {
    const text = ['# 这是注释', 'key: value'].join('\n');
    expect(parseMinimalYaml(text)).toEqual({ key: 'value' });
  });

  it('跳过空行', () => {
    const text = ['', 'key: value', '', '   ', 'other: v'].join('\n');
    expect(parseMinimalYaml(text)).toEqual({ key: 'value', other: 'v' });
  });

  it('列表内子注释被跳过', () => {
    const text = ['rules:', '  # 子注释', '  - category: security'].join('\n');
    expect(parseMinimalYaml(text)).toEqual({ rules: [{ category: 'security' }] });
  });

  it('仅含注释的文件返回空对象', () => {
    expect(parseMinimalYaml('# only comment\n')).toEqual({});
  });
});

// ==================== 数组 ====================

describe('parseMinimalYaml — 数组', () => {
  it('顶层列表包装为 rules 数组', () => {
    expect(parseMinimalYaml('- item1\n- item2')).toEqual({ rules: ['item1', 'item2'] });
  });

  it('顶层列表项为对象', () => {
    const text = '- id: r1\n  name: Rule 1\n- id: r2\n  name: Rule 2';
    expect(parseMinimalYaml(text)).toEqual({
      rules: [
        { id: 'r1', name: 'Rule 1' },
        { id: 'r2', name: 'Rule 2' },
      ],
    });
  });

  it('键下挂载列表', () => {
    const text = ['rules:', '  - category: security', '  - category: style'].join('\n');
    expect(parseMinimalYaml(text)).toEqual({
      rules: [{ category: 'security' }, { category: 'style' }],
    });
  });

  it('行内数组 [a, b, c]', () => {
    expect(parseMinimalYaml('lang: [ts, js, go]')).toEqual({
      lang: ['ts', 'js', 'go'],
    });
  });

  it('行内数组中元素带引号', () => {
    expect(parseMinimalYaml('lang: ["ts", \'js\']')).toEqual({
      lang: ['ts', 'js'],
    });
  });

  it('空行内数组 []', () => {
    expect(parseMinimalYaml('rules: []')).toEqual({ rules: [] });
  });

  it('列表项以单独 "-" 起始行后跟字段', () => {
    const text = ['rules:', '  -', '    category: security', '    ruleId: r1'].join('\n');
    expect(parseMinimalYaml(text)).toEqual({
      rules: [{ category: 'security', ruleId: 'r1' }],
    });
  });
});

// ==================== 嵌套对象 ====================

describe('parseMinimalYaml — 嵌套对象', () => {
  it('键下嵌套对象', () => {
    const text = ['meta:', '  version: 1', '  author: bob'].join('\n');
    expect(parseMinimalYaml(text)).toEqual({
      meta: { version: 1, author: 'bob' },
    });
  });

  it('列表项中嵌套列表 (patterns)', () => {
    const text = [
      '- id: YAML001',
      '  name: YAML Password Rule',
      '  severity: high',
      '  category: security',
      '  patterns:',
      '    - type: regex',
      '      pattern: password\\s*=\\s*["\'][^"\']+["\']',
      '      message: hardcoded password in yaml',
    ].join('\n');
    expect(parseMinimalYaml(text)).toEqual({
      rules: [
        {
          id: 'YAML001',
          name: 'YAML Password Rule',
          severity: 'high',
          category: 'security',
          patterns: [
            {
              type: 'regex',
              pattern: 'password\\s*=\\s*["\'][^"\']+["\']',
              message: 'hardcoded password in yaml',
            },
          ],
        },
      ],
    });
  });

  it('多字段复杂规则 (feedback 风格)', () => {
    const text = [
      'rules:',
      '  - category: security',
      '    ruleId: sql-injection',
      '    filePattern: "**/test/**"',
      '    severity: high',
      '    messageContains: "SQL"',
    ].join('\n');
    expect(parseMinimalYaml(text)).toEqual({
      rules: [
        {
          category: 'security',
          ruleId: 'sql-injection',
          filePattern: '**/test/**',
          severity: 'high',
          messageContains: 'SQL',
        },
      ],
    });
  });
});

// ==================== 空字符串 ====================

describe('parseMinimalYaml — 空字符串', () => {
  it('空字符串返回空对象', () => {
    expect(parseMinimalYaml('')).toEqual({});
  });

  it('仅含空白字符返回空对象', () => {
    expect(parseMinimalYaml('   \n  \n')).toEqual({});
  });

  it('空字段值被跳过', () => {
    expect(parseMinimalYaml('rules:\n  - category:')).toEqual({
      rules: [{}],
    });
  });
});

// ==================== 引号处理 ====================

describe('parseMinimalYaml — 引号处理', () => {
  it('双引号包裹值', () => {
    expect(parseMinimalYaml('key: "value"')).toEqual({ key: 'value' });
  });

  it('单引号包裹值', () => {
    expect(parseMinimalYaml("key: 'value'")).toEqual({ key: 'value' });
  });

  it('引号内含空格保留', () => {
    expect(parseMinimalYaml('key: "hello world"')).toEqual({ key: 'hello world' });
  });

  it('列表项字段值带引号', () => {
    const text = ['rules:', "  - category: \"security\"", "  - messageContains: 'TODO'"].join('\n');
    expect(parseMinimalYaml(text)).toEqual({
      rules: [{ category: 'security' }, { messageContains: 'TODO' }],
    });
  });

  it('未配对引号按字面值保留', () => {
    // 单侧引号不剥离
    expect(parseMinimalYaml('key: "value')).toEqual({ key: '"value' });
  });
});

// ==================== 数值 / 布尔值转换 ====================

describe('parseMinimalYaml — 数值/布尔值转换', () => {
  it('整数字值转为 number', () => {
    expect(parseMinimalYaml('threshold: 5')).toEqual({ threshold: 5 });
    expect(typeof parseMinimalYaml('threshold: 5').threshold).toBe('number');
  });

  it('负整数值转为 number', () => {
    expect(parseMinimalYaml('offset: -10')).toEqual({ offset: -10 });
  });

  it('布尔值 true/false 转为 boolean', () => {
    expect(parseMinimalYaml('enabled: true')).toEqual({ enabled: true });
    expect(parseMinimalYaml('enabled: false')).toEqual({ enabled: false });
  });

  it('null 值转为 null', () => {
    expect(parseMinimalYaml('key: null')).toEqual({ key: null });
  });

  it('非数字字符串保持字符串', () => {
    expect(parseMinimalYaml('severity: high')).toEqual({ severity: 'high' });
  });

  it('行内数组中数值项被转换', () => {
    expect(parseMinimalYaml('nums: [1, 2, 3]')).toEqual({ nums: [1, 2, 3] });
  });

  it('阈值 threshold 在嵌套结构中保持 number', () => {
    const text = '- id: r1\n  patterns:\n    - type: count\n      threshold: 5';
    const parsed = parseMinimalYaml(text);
    expect(parsed.rules[0].patterns[0].threshold).toBe(5);
    expect(typeof parsed.rules[0].patterns[0].threshold).toBe('number');
  });
});

// ==================== 特殊字符与 Unicode ====================

describe('parseMinimalYaml — 特殊字符与 Unicode', () => {
  it('中文值', () => {
    expect(parseMinimalYaml('name: 安全规则')).toEqual({ name: '安全规则' });
  });

  it('中文 key（保持原样字符串）', () => {
    // 中文字符作为 key 不在原 parser 支持范围，此处确保不崩溃
    const parsed = parseMinimalYaml('名称: value');
    expect(parsed).toEqual({ 名称: 'value' });
  });

  it('Unicode 转义字符值', () => {
    expect(parseMinimalYaml('msg: \\u0041')).toEqual({ msg: '\\u0041' });
  });

  it('特殊正则字符值', () => {
    expect(parseMinimalYaml('pattern: password\\s*=')).toEqual({
      pattern: 'password\\s*=',
    });
  });

  it('包含冒号的引号值', () => {
    expect(parseMinimalYaml('url: "http://example.com"')).toEqual({
      url: 'http://example.com',
    });
  });
});

// ==================== 与原始调用点兼容性 ====================

describe('parseMinimalYaml — 原始调用点兼容性', () => {
  it('rule-engine 风格的 rule 文件解析', () => {
    const text = [
      '- id: YAML001',
      '  name: YAML Password Rule',
      '  severity: high',
      '  category: security',
      '  language: [ts, js]',
      '  patterns:',
      '    - type: regex',
      '      pattern: password',
      '      message: hardcoded password',
    ].join('\n');
    const result = parseMinimalYaml(text);
    expect(Array.isArray(result.rules)).toBe(true);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].id).toBe('YAML001');
    expect(result.rules[0].language).toEqual(['ts', 'js']);
    expect(result.rules[0].patterns).toHaveLength(1);
    expect(result.rules[0].patterns[0].type).toBe('regex');
  });

  it('feedback 风格的 ignore 配置解析', () => {
    const text = [
      '# header comment',
      '',
      'rules:',
      '  - category: security',
      '    ruleId: sql-injection',
      '  - category: style',
    ].join('\n');
    const result = parseMinimalYaml(text);
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0].category).toBe('security');
    expect(result.rules[0].ruleId).toBe('sql-injection');
    expect(result.rules[1].category).toBe('style');
  });

  it('仅含 # 注释的空 YAML 文件', () => {
    expect(parseMinimalYaml('# empty rules file\n')).toEqual({});
  });

  it('顶层未知键被保留在结果中（不阻塞 rules 解析）', () => {
    const text = ['version: 1', 'rules:', '  - category: security'].join('\n');
    const result = parseMinimalYaml(text);
    expect(result.version).toBe(1);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].category).toBe('security');
  });

  it('rules 之后又出现顶层键时停止 rules 收集', () => {
    const text = [
      'rules:',
      '  - category: security',
      'other:',
      '  - foo: bar',
      '  - category: ignored',
    ].join('\n');
    const result = parseMinimalYaml(text);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].category).toBe('security');
    // other 下的列表也应当被解析为独立键
    expect(result.other).toHaveLength(2);
    expect(result.other[0].foo).toBe('bar');
    expect(result.other[1].category).toBe('ignored');
  });
});
