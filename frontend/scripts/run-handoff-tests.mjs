/**
 * 巡测班 × 提锂车间交接规则自测（纯逻辑，不碰 IndexedDB / DOM）。
 * 用 esbuild 打包到临时文件后由 node 执行：
 *   node scripts/run-handoff-tests.mjs
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dir = mkdtempSync(join(root, '.handoff-test-'));
const entry = join(dir, 'entry.ts');

writeFileSync(
  entry,
  `
import assert from 'node:assert/strict';
import {
  patrolStatusOf,
  cascadeChainOf,
  cascadePathText,
  reconcileOrder,
  findPatrolSheet,
  tankCanAccept,
  tankFreeM3,
  tankAfterOccupy,
  tankAfterRelease,
  tankIsFull,
  rollToNextShift,
  pickNextQueuedOrder,
  resolveShift,
  isShiftEarlier,
} from '../src/utils/handoff.ts';
import type { Gate } from '../src/types/gate.ts';
import type { PatrolSheet } from '../src/types/patrol.ts';
import type { FlowOrder } from '../src/types/flow.ts';

const gates = [
  { id: 'g1', fromPondId: 'a', toPondId: 'b', openingPct: 60, widthCm: 100, state: '半开', note: '', createdAt: '', updatedAt: '', revision: 3 },
  { id: 'g2', fromPondId: 'b', toPondId: 'c', openingPct: 40, widthCm: 100, state: '半开', note: '', createdAt: '', updatedAt: '', revision: 3 },
  { id: 'g3', fromPondId: 'b', toPondId: 'e', openingPct: 0, widthCm: 90, state: '关闭', note: '', createdAt: '', updatedAt: '', revision: 3 },
] as Gate[];

const ponds = [
  { id: 'a', code: '北-01' },
  { id: 'b', code: '北-02' },
  { id: 'c', code: '北-03' },
  { id: 'd', code: '南-04' },
];

function sheet(partial: Partial<PatrolSheet> & { pondId: string; date: string; shift: '白班' | '中班' | '夜班' }): PatrolSheet {
  return {
    id: partial.id ?? 's',
    densityGcm3: partial.densityGcm3 ?? 1.1,
    levelCm: partial.levelCm ?? 40,
    windLevel: partial.windLevel ?? 2,
    recorder: '',
    note: '',
    shiftBackfilled: false,
    createdAt: '',
    updatedAt: '',
    revision: 3,
    ...partial,
  };
}

// 1. 指标判定：钠盐 1.10、水位 10cm 门槛
assert.equal(patrolStatusOf({ densityGcm3: 1.099, levelCm: 40 }, '钠盐'), '未到指标');
assert.equal(patrolStatusOf({ densityGcm3: 1.1, levelCm: 40 }, '钠盐'), '到指标');
assert.equal(patrolStatusOf({ densityGcm3: 1.18, levelCm: 9 }, '钾盐'), '未到指标', '水位低于安全线不排');
assert.equal(patrolStatusOf({ densityGcm3: 1.24, levelCm: 30 }, '锂盐'), '到指标');

// 2. 串级走向：关闭闸不参与，a→b→c
assert.deepEqual(cascadeChainOf(gates, 'a'), ['a', 'b', 'c']);
assert.equal(cascadePathText(gates, ponds, 'a'), '北-01 → 北-02 → 北-03');

// 3. 对账：缺单 / 未到指标 / 通过三态
const sheets = [
  sheet({ pondId: 'a', date: '2026-10-05', shift: '白班', densityGcm3: 1.12, levelCm: 38 }),
  sheet({ pondId: 'd', date: '2026-10-05', shift: '白班', densityGcm3: 1.05, levelCm: 44 }),
];
const stageOf = (id: string) => (id === 'd' ? '钠盐' : id === 'a' ? '钠盐' : undefined);
assert.equal(reconcileOrder({ pondId: 'a', planDate: '2026-10-05', shift: '白班' }, sheets, stageOf).result, 'ok');
assert.equal(reconcileOrder({ pondId: 'd', planDate: '2026-10-05', shift: '白班' }, sheets, stageOf).result, 'pending');
assert.equal(reconcileOrder({ pondId: 'a', planDate: '2026-10-05', shift: '夜班' }, sheets, stageOf).result, 'missing');
assert.ok(findPatrolSheet(sheets, 'd', '2026-10-05', '白班'));

// 4. 成品卤罐容量：满则拒、入罐封顶、空出不为负、剩余空间
const tank = { id: 't', name: '罐', capacityM3: 100, occupiedM3: 80, updatedAt: '', revision: 3 };
assert.equal(tankFreeM3(tank), 20);
assert.equal(tankCanAccept(tank, 20), true);
assert.equal(tankCanAccept(tank, 21), false);
assert.equal(tankAfterOccupy(tank, 30).occupiedM3, 100);
assert.equal(tankIsFull(tankAfterOccupy(tank, 20)), true);
assert.equal(tankAfterRelease(tank, 100).occupiedM3, 0);

// 5. 排队到下一班：白→中、中→夜、夜→次日白
assert.deepEqual(rollToNextShift('2026-10-05', '白班'), { date: '2026-10-05', shift: '中班' });
assert.deepEqual(rollToNextShift('2026-10-05', '中班'), { date: '2026-10-05', shift: '夜班' });
assert.deepEqual(rollToNextShift('2026-10-05', '夜班'), { date: '2026-10-06', shift: '白班' });
assert.equal(isShiftEarlier('2026-10-05', '夜班', '2026-10-06', '白班'), true);
assert.equal(isShiftEarlier('2026-10-06', '白班', '2026-10-05', '夜班'), false);

// 6. 罐位空出本侧接着排：取最早且装得下的排队单
function order(partial: Partial<FlowOrder> & { id: string; pondId: string; planDate: string; shift: '白班' | '中班' | '夜班' }): FlowOrder {
  return {
    cascadePath: '', volumeM3: 50, operator: '', state: '排队中',
    queueReason: '', queuedFromDate: '', queuedFromShift: '', deliveredM3: 0, orderIndex: 1,
    createdAt: '', updatedAt: '', revision: 3, ...partial,
  };
}
const orders = [
  order({ id: 'o2', pondId: 'b', planDate: '2026-10-06', shift: '白班', volumeM3: 60, orderIndex: 1 }), // 装不下
  order({ id: 'o1', pondId: 'a', planDate: '2026-10-05', shift: '夜班', volumeM3: 30, orderIndex: 2 }),
  order({ id: 'o3', pondId: 'c', planDate: '2026-10-07', shift: '中班', volumeM3: 10, state: '已排', orderIndex: 3 }),
];
// 罐剩余 40：o2 需 60 装不下，o1 需 30 最早 → 选 o1
assert.equal(pickNextQueuedOrder(orders, { capacityM3: 100, occupiedM3: 60 })?.id, 'o1');
// 全满：没有可接的单
assert.equal(pickNextQueuedOrder(orders, { capacityM3: 100, occupiedM3: 95 }), null);

// 7. 旧数据补班次：缺省/空白补白班；非法值补白班但 matched=false 单列
assert.deepEqual(resolveShift(undefined), { value: '白班', matched: true });
assert.deepEqual(resolveShift('夜班'), { value: '夜班', matched: true });
assert.deepEqual(resolveShift('早班'), { value: '白班', matched: false });

console.log('handoff tests: all passed');
`,
);

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(dir, 'out.mjs'),
  logLevel: 'silent',
});

await import(join(dir, 'out.mjs'));
rmSync(dir, { recursive: true, force: true });
