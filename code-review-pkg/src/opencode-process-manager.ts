// src/opencode-process-manager.ts — opencode serve 子进程管理（启停 + 状态 + 日志缓冲）
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

/** opencode serve 进程状态快照 */
export interface OpencodeServeStatus {
  running: boolean;
  pid?: number;
  port?: number;
  hostname?: string;
  startedAt?: string;
  lastLogLines: string[];
}

/** start 返回值 */
export interface OpencodeStartResult {
  ok: boolean;
  pid?: number;
  port?: number;
  error?: string;
}

/** stop 返回值 */
export interface OpencodeStopResult {
  ok: boolean;
  error?: string;
}

/** 默认监听地址 */
const DEFAULT_HOSTNAME = '127.0.0.1';
const DEFAULT_PORT = 4096;

/** stop 超时（SIGTERM 后等待 exit，超时则 SIGKILL） */
const STOP_TIMEOUT_MS = 5000;

export function validateCommandSafety(cmd: string): void {
  const rules: [string, string][] = [
    ['&&', '&&'],
    [';', ';'],
    ['|', '|'],
    ['$(', '$('],
    ['`', 'backtick (`)'],
    ['>', '>'],
    ['<', '<'],
    ['||', '||'],
    ['{}', '{}'],
  ];
  for (const [pattern, label] of rules) {
    if (cmd.includes(pattern)) {
      throw new Error(`Unsafe command: ${label}`);
    }
  }
  if (cmd.includes('&')) {
    throw new Error('Unsafe command: &');
  }
}

export function replaceCommandVars(template: string | null | undefined, hostname: string, port: number): string {
  if (template == null) return '';
  return template.replace(/{hostname}/g, hostname).replace(/{port}/g, String(port));
}

export function parseCommandToArgv(command: string): string[] {
  const argv: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.length > 0) {
        argv.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    argv.push(current);
  }
  return argv;
}

export function copyConfigFilesToWorkDir(workDir: string, opencodeConfigPath?: string, codehubConfigPath?: string): number {
  const resolvedWorkDir = resolve(process.cwd(), workDir);
  if (!existsSync(resolvedWorkDir)) {
    mkdirSync(resolvedWorkDir, { recursive: true });
  }

  let copiedCount = 0;

  const opencodeConfigSrc = resolve(process.cwd(), opencodeConfigPath ?? 'opencode-config/opencode.jsonc');
  const codehubConfigSrc = resolve(process.cwd(), codehubConfigPath ?? '.codehub-config.json');
  const opencodeConfigDirSrc = resolve(process.cwd(), 'opencode-config');

  if (existsSync(opencodeConfigSrc)) {
    copyFileSync(opencodeConfigSrc, join(resolvedWorkDir, basename(opencodeConfigSrc)));
    copiedCount++;
  }

  if (existsSync(codehubConfigSrc)) {
    copyFileSync(codehubConfigSrc, join(resolvedWorkDir, basename(codehubConfigSrc)));
    copiedCount++;
  }

  if (existsSync(opencodeConfigDirSrc) && statSync(opencodeConfigDirSrc).isDirectory()) {
    const entries = readdirSync(opencodeConfigDirSrc);
    for (const entry of entries) {
      const entryPath = join(opencodeConfigDirSrc, entry);
      const stat = statSync(entryPath);
      if (!stat.isDirectory()) {
        copyFileSync(entryPath, join(resolvedWorkDir, entry));
        copiedCount++;
      }
    }
  }

  return copiedCount;
}

export class OpencodeProcessManager {
  private child: ChildProcess | null = null;
  private logBuffer: string[] = [];
  private readonly maxLogLines = 100;
  private currentStatus: { port?: number; hostname?: string; startedAt?: string } = {};

  /**
   * 启动 opencode serve 子进程。
   *
   * - 若已有子进程且未退出，返回 { ok: false, error: 'opencode serve already running' }
   * - spawn 成功后立即 resolve（不等进程退出）
   * - opencode 不在 PATH（ENOENT）时返回 { ok: false, error }
   */
  async start(opts: { hostname?: string; port?: number; commandTemplate?: string; workDir?: string; opencodeConfigPath?: string; codehubConfigPath?: string } = {}): Promise<OpencodeStartResult> {
    if (this.child && !this.child.killed && this.child.exitCode === null && this.child.signalCode === null) {
      return { ok: false, error: 'opencode serve already running' };
    }

    const commandTemplate = opts.commandTemplate ?? 'opencode serve --hostname {hostname} --port {port}';
    const hostname = opts.hostname ?? DEFAULT_HOSTNAME;
    const port = opts.port ?? DEFAULT_PORT;

    const commandResolved = replaceCommandVars(commandTemplate, hostname, port);

    try {
      validateCommandSafety(commandResolved);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    try {
      copyConfigFilesToWorkDir(opts.workDir ?? './', opts.opencodeConfigPath, opts.codehubConfigPath);
    } catch (err) {
      return { ok: false, error: 'Copy config failed: ' + (err as Error).message };
    }

    const resolvedWorkDir = resolve(process.cwd(), opts.workDir ?? './');

    const argv = parseCommandToArgv(commandResolved);
    const isWindows = process.platform === 'win32';

    const stdio: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe'];
    let child: ChildProcess;
    if (isWindows || argv.length === 0) {
      child = spawn(commandResolved, [], { stdio, shell: true, cwd: resolvedWorkDir });
    } else {
      child = spawn(argv[0], argv.slice(1), { stdio, shell: false, cwd: resolvedWorkDir });
    }

    // ENOENT 等同步/异步 error 事件
    // 用对象包装以避免 TS 在 await 后将 let 变量窄化为 null
    const state: { error: Error | null } = { error: null };

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        state.error = new Error('opencode CLI not found in PATH');
      } else {
        state.error = err;
      }
      this.child = null;
    });

    child.on('exit', () => {
      // 进程退出：清理 child 引用，但保留 logBuffer
      this.child = null;
    });

    const appendLog = (data: Buffer | string) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      // 按行 split，保留行尾换行行为
      const lines = text.split(/\r?\n/);
      // 若末尾是空字符串（由最后一个换行产生），合并到下一次写入，避免多余空行
      const lastIsEmpty = lines[lines.length - 1] === '';
      if (lastIsEmpty) {
        lines.pop();
      }
      for (const line of lines) {
        this.logBuffer.push(line);
        while (this.logBuffer.length > this.maxLogLines) {
          this.logBuffer.shift();
        }
      }
    };

    if (child.stdout) {
      child.stdout.on('data', appendLog);
    }
    if (child.stderr) {
      child.stderr.on('data', appendLog);
    }

    // 给事件循环一个 tick 让 'error' 事件有机会触发（ENOENT 通常是异步触发的）
    await new Promise<void>((resolve) => setImmediate(resolve));

    if (state.error) {
      return { ok: false, error: state.error.message };
    }

    this.child = child;
    this.currentStatus = {
      port,
      hostname,
      startedAt: new Date().toISOString(),
    };

    return {
      ok: true,
      pid: child.pid,
      port,
    };
  }

  /**
   * 停止 opencode serve 子进程。
   *
   * - 发送 SIGTERM，等待 exit；超时（5s）后 SIGKILL
   * - 无运行中进程时返回 { ok: true }
   */
  async stop(): Promise<OpencodeStopResult> {
    const child = this.child;
    if (!child) {
      return { ok: true };
    }

    return new Promise<OpencodeStopResult>((resolve) => {
      let settled = false;
      const finish = (result: OpencodeStopResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.child = null;
        resolve(result);
      };

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        finish({ ok: false, error: 'opencode serve did not exit within timeout (SIGKILL sent)' });
      }, STOP_TIMEOUT_MS);

      child.once('exit', () => {
        finish({ ok: true });
      });

      try {
        child.kill('SIGTERM');
      } catch (err) {
        finish({ ok: false, error: `Failed to send SIGTERM: ${(err as Error).message}` });
      }
    });
  }

  /** 返回当前进程状态快照（包含最近 20 行日志） */
  getStatus(): OpencodeServeStatus {
    const child = this.child;
    const running = !!child && !child.killed && child.exitCode === null && child.signalCode === null;
    return {
      running,
      pid: child?.pid,
      port: this.currentStatus.port,
      hostname: this.currentStatus.hostname,
      startedAt: this.currentStatus.startedAt,
      lastLogLines: this.getLastLogLines(20),
    };
  }

  /** 返回最近 n 行日志（不超出已有数量） */
  getLastLogLines(n: number): string[] {
    if (n <= 0) return [];
    const len = this.logBuffer.length;
    if (len === 0) return [];
    const start = Math.max(0, len - n);
    return this.logBuffer.slice(start);
  }
}
