/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactPriorityLevel} from './ReactInternalTypes';

// Intentionally not named imports because Rollup would use dynamic dispatch for
// CommonJS interop named imports.
import * as Scheduler from 'scheduler';
import {__interactionsRef} from 'scheduler/tracing';
import {
  enableSchedulerTracing,
  decoupleUpdatePriorityFromScheduler,
} from 'shared/ReactFeatureFlags';
import invariant from 'shared/invariant';
import {
  SyncLanePriority,
  getCurrentUpdateLanePriority,
  setCurrentUpdateLanePriority,
} from './ReactFiberLane';

const {
  unstable_runWithPriority: Scheduler_runWithPriority,
  unstable_scheduleCallback: Scheduler_scheduleCallback,
  unstable_cancelCallback: Scheduler_cancelCallback,
  unstable_shouldYield: Scheduler_shouldYield,
  unstable_requestPaint: Scheduler_requestPaint,
  unstable_now: Scheduler_now,
  unstable_getCurrentPriorityLevel: Scheduler_getCurrentPriorityLevel,
  unstable_ImmediatePriority: Scheduler_ImmediatePriority,
  unstable_UserBlockingPriority: Scheduler_UserBlockingPriority,
  unstable_NormalPriority: Scheduler_NormalPriority,
  unstable_LowPriority: Scheduler_LowPriority,
  unstable_IdlePriority: Scheduler_IdlePriority,
} = Scheduler;

if (enableSchedulerTracing) {
  // Provide explicit error message when production+profiling bundle of e.g.
  // react-dom is used with production (non-profiling) bundle of
  // scheduler/tracing
  invariant(
    __interactionsRef != null && __interactionsRef.current != null,
    'It is not supported to run the profiling version of a renderer (for ' +
      'example, `react-dom/profiling`) without also replacing the ' +
      '`scheduler/tracing` module with `scheduler/tracing-profiling`. Your ' +
      'bundler might have a setting for aliasing both modules. Learn more at ' +
      'https://reactjs.org/link/profiling',
  );
}

export type SchedulerCallback = (isSync: boolean) => SchedulerCallback | null;

type SchedulerCallbackOptions = {timeout?: number, ...};

const fakeCallbackNode = {};

// Except for NoPriority, these correspond to Scheduler priorities. We use
// ascending numbers so we can compare them like numbers. They start at 90 to
// avoid clashing with Scheduler's priorities.
// == 除 NoPriority 外，这些都与 Scheduler 优先级相对应。
// == 我们用上升数字，因此我们可以像数字一样比较它们。他们从 90 开始避免与 Scheduler 的优先级冲突。
export const ImmediatePriority: ReactPriorityLevel = 99;
export const UserBlockingPriority: ReactPriorityLevel = 98;
export const NormalPriority: ReactPriorityLevel = 97;
export const LowPriority: ReactPriorityLevel = 96;
export const IdlePriority: ReactPriorityLevel = 95;
// NoPriority is the absence of priority. Also React-only.
export const NoPriority: ReactPriorityLevel = 90;

export const shouldYield = Scheduler_shouldYield;
export const requestPaint =
  // Fall back gracefully if we're running an older version of Scheduler.
  Scheduler_requestPaint !== undefined ? Scheduler_requestPaint : () => {};

let syncQueue: Array<SchedulerCallback> | null = null;
let immediateQueueCallbackNode: mixed | null = null;
let isFlushingSyncQueue: boolean = false;
const initialTimeMs: number = Scheduler_now();

// If the initial timestamp is reasonably small, use Scheduler's `now` directly.
// This will be the case for modern browsers that support `performance.now`. In
// older browsers, Scheduler falls back to `Date.now`, which returns a Unix
// timestamp. In that case, subtract the module initialization time to simulate
// the behavior of performance.now and keep our times small enough to fit
// within 32 bits.
// TODO: Consider lifting this into Scheduler.
export const now =
  initialTimeMs < 10000 ? Scheduler_now : () => Scheduler_now() - initialTimeMs;

// == 根据 schedulerPriority 获取 LanePriority
// == schedulerPriority 优先级比较小，对应 LanePriority 比较大，如下所示: 
// ImmediatePriority = 1;    -> 99
// UserBlockingPriority = 2; -> 98
// NormalPriority = 3;       -> 97
// LowPriority = 4;          -> 96
// IdlePriority = 5;         -> 95
// NoPriority = 0;           -> 90
export function getCurrentPriorityLevel(): ReactPriorityLevel {
  switch (Scheduler_getCurrentPriorityLevel()) {
    case Scheduler_ImmediatePriority:
      // == 99
      return ImmediatePriority;
    case Scheduler_UserBlockingPriority:
      // == 98
      return UserBlockingPriority;
    case Scheduler_NormalPriority:
      // == 97
      return NormalPriority;
    case Scheduler_LowPriority:
      // == 96
      return LowPriority;
    case Scheduler_IdlePriority:
      // == 95
      return IdlePriority;
    default:
      invariant(false, 'Unknown priority level.');
  }
}

// == 根据 LanePriority 获取 schedulerPriority
function reactPriorityToSchedulerPriority(reactPriorityLevel) {
  switch (reactPriorityLevel) {
    case ImmediatePriority:
      return Scheduler_ImmediatePriority;
    case UserBlockingPriority:
      return Scheduler_UserBlockingPriority;
    case NormalPriority:
      return Scheduler_NormalPriority;
    case LowPriority:
      return Scheduler_LowPriority;
    case IdlePriority:
      return Scheduler_IdlePriority;
    default:
      invariant(false, 'Unknown priority level.');
  }
}

// == 执行优先级调度 - 循环调用 fn 函数
export function runWithPriority<T>(
  reactPriorityLevel: ReactPriorityLevel,
  fn: () => T,
): T {
  // == 根据 LanePriority 获取 schedulerPriority
  const priorityLevel = reactPriorityToSchedulerPriority(reactPriorityLevel);
  // == 执行优先级调度 - 循环调用 fn 函数
  return Scheduler_runWithPriority(priorityLevel, fn);
}

export function scheduleCallback(
  reactPriorityLevel: ReactPriorityLevel,
  callback: SchedulerCallback,
  options: SchedulerCallbackOptions | void | null,
) {
  const priorityLevel = reactPriorityToSchedulerPriority(reactPriorityLevel);
  return Scheduler_scheduleCallback(priorityLevel, callback, options);
}

export function scheduleSyncCallback(callback: SchedulerCallback) {
  // Push this callback into an internal queue. We'll flush these either in
  // the next tick, or earlier if something calls `flushSyncCallbackQueue`.
  if (syncQueue === null) {
    syncQueue = [callback];
    // Flush the queue in the next tick, at the earliest.
    immediateQueueCallbackNode = Scheduler_scheduleCallback(
      Scheduler_ImmediatePriority,
      flushSyncCallbackQueueImpl,
    );
  } else {
    // Push onto existing queue. Don't need to schedule a callback because
    // we already scheduled one when we created the queue.
    syncQueue.push(callback);
  }
  return fakeCallbackNode;
}

export function cancelCallback(callbackNode: mixed) {
  if (callbackNode !== fakeCallbackNode) {
    Scheduler_cancelCallback(callbackNode);
  }
}

// == 执行同步回调队列
export function flushSyncCallbackQueue() {
  // == immediateQueueCallbackNode 不为 null
  if (immediateQueueCallbackNode !== null) {
    const node = immediateQueueCallbackNode;
    immediateQueueCallbackNode = null;
    // == 取消任务回调
    Scheduler_cancelCallback(node);
  }
  // == 执行同步回调队列接口
  flushSyncCallbackQueueImpl();
}

// == 执行同步回调队列接口
function flushSyncCallbackQueueImpl() {
  if (!isFlushingSyncQueue && syncQueue !== null) {
    // Prevent re-entrancy.
    // == 防止再次进入
    isFlushingSyncQueue = true;
    let i = 0;
    // == 将更新优先级与调度程序分离
    if (decoupleUpdatePriorityFromScheduler) {
      // == 获取 currentUpdateLanePriority
      const previousLanePriority = getCurrentUpdateLanePriority();
      try {
        const isSync = true;
        const queue = syncQueue;
        // == 设置当前更新优先级
        setCurrentUpdateLanePriority(SyncLanePriority);
        // == 执行优先级调度 - 循环调用 fn 函数
        runWithPriority(ImmediatePriority, () => {
          // == 循环执行 syncQueue 的每一项
          for (; i < queue.length; i++) {
            let callback = queue[i];
            do {
              callback = callback(isSync);
            } while (callback !== null);
          }
        });
        // == 将 syncQueue 置为空
        syncQueue = null;
      } catch (error) {
        // If something throws, leave the remaining callbacks on the queue.
        // == 如果发生异常，将其余的回调保留在队列中。
        if (syncQueue !== null) {
          syncQueue = syncQueue.slice(i + 1);
        }
        // Resume flushing in the next tick
        // == 在下一个 tick 中恢复
        Scheduler_scheduleCallback(
          Scheduler_ImmediatePriority,
          flushSyncCallbackQueue,
        );
        throw error;
      } finally {
        // == 设置当前更新优先级
        setCurrentUpdateLanePriority(previousLanePriority);
        isFlushingSyncQueue = false;
      }
    } else {
      try {
        const isSync = true;
        const queue = syncQueue;
        runWithPriority(ImmediatePriority, () => {
          // == 循环执行 syncQueue 的每一项
          for (; i < queue.length; i++) {
            let callback = queue[i];
            do {
              callback = callback(isSync);
            } while (callback !== null);
          }
        });
        syncQueue = null;
      } catch (error) {
        // If something throws, leave the remaining callbacks on the queue.
        // == 如果发生异常，将其余的回调保留在队列中。
        if (syncQueue !== null) {
          syncQueue = syncQueue.slice(i + 1);
        }
        // Resume flushing in the next tick
        // == 在下一个 tick 中恢复
        Scheduler_scheduleCallback(
          Scheduler_ImmediatePriority,
          flushSyncCallbackQueue,
        );
        throw error;
      } finally {
        // == 设置当前更新优先级
        isFlushingSyncQueue = false;
      }
    }
  }
}
