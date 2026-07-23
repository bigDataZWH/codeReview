import { describe, it, expect, vi } from 'vitest';
import { ProgressEmitter, type ProgressEvent } from '../src/progress';

describe('ProgressEmitter', () => {
  describe('基本事件监听', () => {
    it('on + emit 正常触发监听器', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      emitter.on('start', fn);
      emitter.emit('start', { totalFiles: 10 });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith({ totalFiles: 10 });
    });

    it('emit 返回 this 支持链式调用', () => {
      const emitter = new ProgressEmitter();
      const result = emitter.emit('start', { totalFiles: 5 });
      expect(result).toBe(emitter);
    });

    it('on 返回 this 支持链式调用', () => {
      const emitter = new ProgressEmitter();
      const result = emitter.on('start', () => {});
      expect(result).toBe(emitter);
    });

    it('once 返回 this 支持链式调用', () => {
      const emitter = new ProgressEmitter();
      const result = emitter.once('start', () => {});
      expect(result).toBe(emitter);
    });

    it('off 返回 this 支持链式调用', () => {
      const emitter = new ProgressEmitter();
      const fn = () => {};
      emitter.on('start', fn);
      const result = emitter.off('start', fn);
      expect(result).toBe(emitter);
    });

    it('removeAllListeners 返回 this 支持链式调用', () => {
      const emitter = new ProgressEmitter();
      const result = emitter.removeAllListeners();
      expect(result).toBe(emitter);
    });

    it('多个监听器按注册顺序执行', () => {
      const emitter = new ProgressEmitter();
      const order: number[] = [];
      emitter.on('start', () => order.push(1));
      emitter.on('start', () => order.push(2));
      emitter.on('start', () => order.push(3));
      emitter.emit('start', { totalFiles: 1 });
      expect(order).toEqual([1, 2, 3]);
    });

    it('相同监听器可注册多次且都被触发', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      emitter.on('start', fn);
      emitter.on('start', fn);
      emitter.emit('start', { totalFiles: 1 });
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('once 一次性监听器', () => {
    it('once 只触发一次', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      emitter.once('start', fn);
      emitter.emit('start', { totalFiles: 10 });
      emitter.emit('start', { totalFiles: 20 });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('once 触发后监听器被移除', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      emitter.once('start', fn);
      expect(emitter.listenerCount('start')).toBe(1);
      emitter.emit('start', { totalFiles: 10 });
      expect(emitter.listenerCount('start')).toBe(0);
    });

    it('off 可移除 once 监听器（通过原始函数引用）', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      emitter.once('start', fn);
      emitter.off('start', fn);
      emitter.emit('start', { totalFiles: 10 });
      expect(fn).not.toHaveBeenCalled();
    });

    it('多个 once 监听器各自独立', () => {
      const emitter = new ProgressEmitter();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      emitter.once('start', fn1);
      emitter.once('start', fn2);
      emitter.emit('start', { totalFiles: 10 });
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });
  });

  describe('off 取消监听', () => {
    it('off 移除指定监听器', () => {
      const emitter = new ProgressEmitter();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      emitter.on('start', fn1);
      emitter.on('start', fn2);
      emitter.off('start', fn1);
      emitter.emit('start', { totalFiles: 10 });
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it('off 不存在的监听器不报错', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      expect(() => emitter.off('start', fn)).not.toThrow();
    });

    it('off 无监听器的事件不报错', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      expect(() => emitter.off('error', fn)).not.toThrow();
    });
  });

  describe('listenerCount 监听器计数', () => {
    it('初始为 0', () => {
      const emitter = new ProgressEmitter();
      expect(emitter.listenerCount('start')).toBe(0);
    });

    it('on 增加计数', () => {
      const emitter = new ProgressEmitter();
      emitter.on('start', () => {});
      expect(emitter.listenerCount('start')).toBe(1);
      emitter.on('start', () => {});
      expect(emitter.listenerCount('start')).toBe(2);
    });

    it('off 减少计数', () => {
      const emitter = new ProgressEmitter();
      const fn = () => {};
      emitter.on('start', fn);
      expect(emitter.listenerCount('start')).toBe(1);
      emitter.off('start', fn);
      expect(emitter.listenerCount('start')).toBe(0);
    });

    it('不同事件独立计数', () => {
      const emitter = new ProgressEmitter();
      emitter.on('start', () => {});
      emitter.on('complete', () => {});
      emitter.on('complete', () => {});
      expect(emitter.listenerCount('start')).toBe(1);
      expect(emitter.listenerCount('complete')).toBe(2);
      expect(emitter.listenerCount('error')).toBe(0);
    });
  });

  describe('removeAllListeners 清空监听器', () => {
    it('不传参数清空所有事件的监听器', () => {
      const emitter = new ProgressEmitter();
      emitter.on('start', () => {});
      emitter.on('complete', () => {});
      emitter.removeAllListeners();
      expect(emitter.listenerCount('start')).toBe(0);
      expect(emitter.listenerCount('complete')).toBe(0);
    });

    it('传参数清空指定事件的监听器', () => {
      const emitter = new ProgressEmitter();
      emitter.on('start', () => {});
      emitter.on('complete', () => {});
      emitter.removeAllListeners('start');
      expect(emitter.listenerCount('start')).toBe(0);
      expect(emitter.listenerCount('complete')).toBe(1);
    });

    it('清空不存在的事件不报错', () => {
      const emitter = new ProgressEmitter();
      expect(() => emitter.removeAllListeners('error')).not.toThrow();
    });
  });

  describe('getProgress 进度计算', () => {
    it('初始状态返回 0', () => {
      const emitter = new ProgressEmitter();
      expect(emitter.getProgress()).toBe(0);
    });

    it('start 后 totalFiles > 0 且未处理文件返回 0', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 10 });
      expect(emitter.getProgress()).toBe(0);
    });

    it('处理一半文件返回 50', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 10 });
      for (let i = 0; i < 5; i++) {
        emitter.emit('file-complete', {
          file: `f${i}`,
          index: i,
          total: 10,
          findings: [],
        });
      }
      expect(emitter.getProgress()).toBe(50);
    });

    it('全部文件处理完返回 100', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 3 });
      for (let i = 0; i < 3; i++) {
        emitter.emit('file-complete', {
          file: `f${i}`,
          index: i,
          total: 3,
          findings: [],
        });
      }
      expect(emitter.getProgress()).toBe(100);
    });

    it('complete 事件后固定返回 100', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 10 });
      emitter.emit('complete', {
        totalFiles: 10,
        findingsCount: 0,
        durationMs: 100,
      });
      expect(emitter.getProgress()).toBe(100);
    });

    it('totalFiles = 0 时返回 100', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 0 });
      expect(emitter.getProgress()).toBe(100);
    });

    it('totalFiles 为负数时按 0 处理返回 100', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: -5 });
      expect(emitter.getProgress()).toBe(100);
    });

    it('file-error 也计入已处理文件数', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 4 });
      emitter.emit('file-complete', {
        file: 'a.ts',
        index: 0,
        total: 4,
        findings: [],
      });
      emitter.emit('file-error', {
        file: 'b.ts',
        index: 1,
        total: 4,
        error: new Error('test'),
      });
      expect(emitter.getProgress()).toBe(50);
    });

    it('file-start 不计入已处理文件数', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 10 });
      emitter.emit('file-start', { file: 'a.ts', index: 0, total: 10 });
      emitter.emit('file-start', { file: 'b.ts', index: 1, total: 10 });
      expect(emitter.getProgress()).toBe(0);
    });

    it('进度向下取整', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 3 });
      emitter.emit('file-complete', {
        file: 'a.ts',
        index: 0,
        total: 3,
        findings: [],
      });
      expect(emitter.getProgress()).toBe(33);
    });

    it('processedFiles 超过 totalFiles 时仍返回 100', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 2 });
      for (let i = 0; i < 10; i++) {
        emitter.emit('file-complete', {
          file: `f${i}`,
          index: i,
          total: 2,
          findings: [],
        });
      }
      expect(emitter.getProgress()).toBe(100);
    });

    it('多次调用 start 重置状态', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 10 });
      for (let i = 0; i < 5; i++) {
        emitter.emit('file-complete', {
          file: `f${i}`,
          index: i,
          total: 10,
          findings: [],
        });
      }
      expect(emitter.getProgress()).toBe(50);

      emitter.emit('start', { totalFiles: 20 });
      expect(emitter.getProgress()).toBe(0);
    });
  });

  describe('监听器错误隔离', () => {
    it('单个监听器抛出错误不影响其他监听器', () => {
      const emitter = new ProgressEmitter();
      const badFn = vi.fn(() => {
        throw new Error('listener error');
      });
      const goodFn = vi.fn();
      emitter.on('start', badFn);
      emitter.on('start', goodFn);
      emitter.emit('start', { totalFiles: 10 });
      expect(badFn).toHaveBeenCalledTimes(1);
      expect(goodFn).toHaveBeenCalledTimes(1);
    });

    it('emit 本身不抛出监听器的错误', () => {
      const emitter = new ProgressEmitter();
      emitter.on('start', () => {
        throw new Error('boom');
      });
      expect(() => emitter.emit('start', { totalFiles: 10 })).not.toThrow();
    });
  });

  describe('状态边界情况', () => {
    it('未 start 就 emit file-complete 不崩溃', () => {
      const emitter = new ProgressEmitter();
      expect(() => {
        emitter.emit('file-complete', {
          file: 'a.ts',
          index: 0,
          total: 1,
          findings: [],
        });
      }).not.toThrow();
      expect(emitter.getProgress()).toBe(0);
    });

    it('complete 后再 emit file-complete 不改变进度', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 10 });
      emitter.emit('complete', {
        totalFiles: 10,
        findingsCount: 0,
        durationMs: 100,
      });
      expect(emitter.getProgress()).toBe(100);
      emitter.emit('file-complete', {
        file: 'extra.ts',
        index: 99,
        total: 10,
        findings: [],
      });
      expect(emitter.getProgress()).toBe(100);
    });

    it('error 事件不影响进度', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 10 });
      emitter.emit('error', { error: new Error('test') });
      expect(emitter.getProgress()).toBe(0);
    });

    it('file-start 事件不影响进度计数', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 5 });
      emitter.emit('file-start', { file: 'a.ts', index: 0, total: 5 });
      emitter.emit('file-start', { file: 'b.ts', index: 1, total: 5 });
      expect(emitter.getProgress()).toBe(0);
    });

    it('start 事件重置 completed 状态', () => {
      const emitter = new ProgressEmitter();
      emitter.emit('start', { totalFiles: 5 });
      emitter.emit('complete', {
        totalFiles: 5,
        findingsCount: 0,
        durationMs: 100,
      });
      expect(emitter.getProgress()).toBe(100);
      emitter.emit('start', { totalFiles: 3 });
      expect(emitter.getProgress()).toBe(0);
    });

    it('空字符串文件路径正常工作', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      emitter.on('file-complete', fn);
      emitter.emit('start', { totalFiles: 1 });
      emitter.emit('file-complete', {
        file: '',
        index: 0,
        total: 1,
        findings: [],
      });
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ file: '' }),
      );
    });

    it('空 findings 数组正常工作', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      emitter.on('file-complete', fn);
      emitter.emit('start', { totalFiles: 1 });
      emitter.emit('file-complete', {
        file: 'test.ts',
        index: 0,
        total: 1,
        findings: [],
      });
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ findings: [] }),
      );
    });

    it('大量 findings 正常传递', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      const findings = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      emitter.on('file-complete', fn);
      emitter.emit('start', { totalFiles: 1 });
      emitter.emit('file-complete', {
        file: 'test.ts',
        index: 0,
        total: 1,
        findings,
      });
      expect(fn.mock.calls[0][0].findings).toHaveLength(100);
    });
  });

  describe('所有事件类型', () => {
    const events: { event: ProgressEvent; payload: unknown }[] = [
      { event: 'start', payload: { totalFiles: 10, startTime: Date.now() } },
      { event: 'file-start', payload: { file: 'a.ts', index: 0, total: 10 } },
      {
        event: 'file-complete',
        payload: {
          file: 'a.ts',
          index: 0,
          total: 10,
          findings: [],
          durationMs: 100,
        },
      },
      {
        event: 'file-error',
        payload: {
          file: 'b.ts',
          index: 1,
          total: 10,
          error: new Error('test error'),
        },
      },
      {
        event: 'complete',
        payload: {
          totalFiles: 10,
          findingsCount: 5,
          durationMs: 5000,
          failedFiles: 1,
        },
      },
      { event: 'error', payload: { error: new Error('fatal'), stage: 'review' } },
    ];

    it.each(events)('$event 事件能正常触发和监听', ({ event, payload }) => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      (emitter.on as any)(event, fn);
      (emitter.emit as any)(event, payload);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(payload);
    });
  });

  describe('链式调用', () => {
    it('支持 on -> on -> emit 链式调用', () => {
      const emitter = new ProgressEmitter();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      emitter.on('start', fn1).on('start', fn2).emit('start', { totalFiles: 5 });
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it('支持 once -> emit 链式调用', () => {
      const emitter = new ProgressEmitter();
      const fn = vi.fn();
      emitter.once('start', fn).emit('start', { totalFiles: 5 });
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
