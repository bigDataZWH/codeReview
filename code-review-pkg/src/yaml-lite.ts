// src/yaml-lite.ts — 最小 YAML 解析器（共用）
//
// 合并自 rule-engine.ts 与 feedback.ts 中各自维护的手写 YAML 解析器。
// 支持：
// - 顶层 key-value（返回 Record<string, any>）
// - 顶层列表（统一包装为 { rules: [...] }，便于两个调用点复用）
// - 顶层 `key:` 后跟缩进列表 / 嵌套对象
// - 列表项 `- key: value`、`- value`、单独 `-` 后续行提供字段
// - 行内数组 `[a, b, c]` 与空数组 `[]`
// - 单/双引号包裹值自动剥离引号
// - 整数 / 浮点 / true / false / null 自动类型转换
// - `#` 整行注释、空行跳过
//
// 不支持（与原实现保持一致）：
// - 行内注释（`key: value # comment` 中 `#` 视为值的一部分）
// - 多行字符串、锚点、引用等高级 YAML 特性

/**
 * 解析最小子集 YAML 文本，返回一个普通对象。
 *
 * - 顶层为 key-value 时直接返回该对象
 * - 顶层为列表（`- item`）时，结果包裹在 `{ rules: [...] }` 中
 * - `key:` 后跟缩进列表 → `{ key: [...] }`
 * - `key:` 后跟缩进 key-value → `{ key: { ... } }`
 * - `key: []` → `{ key: [] }`
 * - `key: value` → `{ key: value }`（自动剥离引号、转换数字/布尔/null）
 *
 * 空字段值（`key:` 后无内容且无后续缩进）会被跳过，与原 feedback.ts 行为一致。
 */
export function parseMinimalYaml(text: string): Record<string, any> {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const root: Record<string, any> = {};

  type Frame = {
    indent: number;
    container: Record<string, any> | any[];
  };
  // 根 frame indent 设为 -1，确保任何非负缩进都属于其子节点
  const stack: Frame[] = [{ indent: -1, container: root }];

  /** 查找下一条非空且非注释的行 */
  function peekNext(fromIdx: number): { indent: number; trimmed: string } | null {
    for (let i = fromIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = line.length - line.trimStart().length;
      return { indent, trimmed };
    }
    return null;
  }

  /** 弹栈直至找到适合当前 indent 与行类型的父容器 */
  function popToParent(indent: number, isListItem: boolean): void {
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (top.indent > indent) {
        stack.pop();
        continue;
      }
      if (top.indent === indent) {
        if (isListItem && Array.isArray(top.container)) {
          // 同一数组，新增兄弟列表项
          return;
        }
        if (!isListItem && !Array.isArray(top.container)) {
          // 同一对象，新增兄弟字段
          return;
        }
        // 类型不匹配（如对象上看到列表项，或数组上看到 key-value），弹出
        stack.pop();
        continue;
      }
      // top.indent < indent —— 这是父级
      return;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const isListItem = trimmed === '-' || trimmed.startsWith('- ');

    popToParent(indent, isListItem);

    const parent = stack[stack.length - 1].container;

    if (isListItem) {
      // 列表项必须在数组容器中
      if (!Array.isArray(parent)) {
        // 顶层列表 → 包装为 root.rules
        if (parent === root && !Array.isArray(root.rules)) {
          root.rules = [];
          stack.push({ indent, container: root.rules });
        } else {
          // 其他场景遇到列表项但父级不是数组，跳过（容错）
          continue;
        }
      }

      const arr = (stack[stack.length - 1].container as any[]);

      if (trimmed === '-' || /^-\s*$/.test(trimmed)) {
        // 单独 `-` 起始，字段在后续缩进行
        const itemObj: Record<string, any> = {};
        arr.push(itemObj);
        const next = peekNext(i);
        if (next && next.indent > indent) {
          stack.push({ indent: next.indent, container: itemObj });
        }
        continue;
      }

      // `- xxx` 形式
      const rest = trimmed.slice(2).trim();
      const kvMatch = rest.match(/^([^:]+):\s*(.*)$/);
      if (kvMatch) {
        // `- key: value` — 列表项首字段
        const itemObj: Record<string, any> = {};
        arr.push(itemObj);
        const key = kvMatch[1].trim();
        const valStr = kvMatch[2].trim();
        if (valStr === '') {
          // 值在后续缩进行（嵌套 list 或 object）
          const next = peekNext(i);
          if (next && next.indent > indent) {
            if (next.trimmed.startsWith('-')) {
              const nestedArr: any[] = [];
              itemObj[key] = nestedArr;
              stack.push({ indent: next.indent, container: nestedArr });
            } else {
              const nestedObj: Record<string, any> = {};
              itemObj[key] = nestedObj;
              stack.push({ indent: next.indent, container: nestedObj });
            }
          }
          // 否则空值跳过，不设置该 key
        } else {
          itemObj[key] = parseValue(valStr);
        }
        // 推入 item 对象 frame，便于后续同缩进字段（约定为 indent+2）
        // 使用 peekNext 决定续行 indent，避免硬编码 +2
        const next = peekNext(i);
        if (next && next.indent > indent) {
          stack.push({ indent: next.indent, container: itemObj });
        }
      } else {
        // `- value` — 简单列表项
        arr.push(parseValue(rest));
      }
      continue;
    }

    // key: value 行
    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const valStr = match[2].trim();

    if (Array.isArray(parent)) {
      // 不应在数组容器上看到 key-value，跳过
      continue;
    }

    const obj = parent as Record<string, any>;

    if (valStr === '') {
      // 值在后续缩进行（嵌套 list 或 object）
      const next = peekNext(i);
      if (next && next.indent > indent) {
        if (next.trimmed.startsWith('-')) {
          const nestedArr: any[] = [];
          obj[key] = nestedArr;
          stack.push({ indent: next.indent, container: nestedArr });
        } else {
          const nestedObj: Record<string, any> = {};
          obj[key] = nestedObj;
          stack.push({ indent: next.indent, container: nestedObj });
        }
      }
      // 空字段值（无后续缩进）跳过，不设置该 key —— 与原 feedback.ts 行为一致
      continue;
    }

    obj[key] = parseValue(valStr);
  }

  return root;
}

/** 解析标量值：剥离引号、识别行内数组、转换数字/布尔/null */
function parseValue(s: string): any {
  const trimmed = s.trim();
  if (trimmed === '') return undefined;

  // 单/双引号包裹 → 剥离引号
  if (
    trimmed.length >= 2 &&
    ((trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') ||
      (trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // 行内数组 [a, b, c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((part) => {
      const v = part.trim();
      if (
        v.length >= 2 &&
        ((v[0] === '"' && v[v.length - 1] === '"') ||
          (v[0] === "'" && v[v.length - 1] === "'"))
      ) {
        return v.slice(1, -1);
      }
      return convertScalar(v);
    });
  }

  return convertScalar(trimmed);
}

/** 将标量字符串转换为 JS 原生类型（数字/布尔/null），其余返回原字符串 */
function convertScalar(s: string): any {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}
