/**
 * /workshop 提锂车间 · 串级走向 / 走水编排单 / 成品卤罐
 * 排下一段走水前与巡测班按「池号 + 班次」对账：巡测未到指标的池先挂着不排；
 * 成品卤罐满时排队到下一班，罐位空出由提锂车间本侧接着排。
 * 消费模型：FlowOrder、BrineTank、PatrolSheet、Gate、Pond；复用组件：<StatBadge>、<EmptyPanel>、<StageTag>
 */
import { For, Show, createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import AppDialog from '../components/common/AppDialog';
import EmptyPanel from '../components/common/EmptyPanel';
import StatBadge from '../components/common/StatBadge';
import { useFlowStore } from '../stores/flowStore';
import { SHIFT_OPTIONS, type ShiftName } from '../types/shift';
import type { FlowOrder, FlowOrderDraft, FlowOrderState } from '../types/flow';
import { cascadeChainOf } from '../utils/handoff';
import { today } from '../utils/id';

const INPUT =
  'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brine-500 focus:ring-1 focus:ring-brine-400';
const BTN_PRIMARY =
  'rounded-md bg-brine-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-brine-700 disabled:opacity-50';
const BTN_GHOST =
  'rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100';
const BTN_DANGER = 'rounded-md bg-rose-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700';

const STATE_STYLE: Record<FlowOrderState, string> = {
  挂起: 'border-amber-300 bg-amber-50 text-amber-700',
  排队中: 'border-violet-300 bg-violet-50 text-violet-700',
  已排: 'border-sky-300 bg-sky-50 text-sky-700',
  走水中: 'border-orange-300 bg-orange-50 text-orange-700',
  已入罐: 'border-emerald-300 bg-emerald-50 text-emerald-700',
};

function emptyDraft(pondId: string, orderIndex: number): FlowOrderDraft {
  return { pondId, planDate: today(), shift: '白班', volumeM3: 600, operator: '', state: '已排', orderIndex };
}

export default function FlowBoard() {
  const flow = useFlowStore();

  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<FlowOrder | null>(null);
  const [tankOpen, setTankOpen] = createSignal(false);
  const [releaseText, setReleaseText] = createSignal('300');
  const [tankDraft, setTankDraft] = createStore({ name: '', capacityM3: 2000, occupiedM3: 0 });
  const [draft, setDraft] = createStore<FlowOrderDraft>(emptyDraft('', 1));

  const pondOf = (pondId: string) => flow.state.ponds.find((pond) => pond.id === pondId) ?? null;
  const codeOf = (pondId: string): string => pondOf(pondId)?.code ?? pondId;

  const sources = createMemo(() => {
    // 有出流闸、可作为一段走水源头的在用池
    return flow.state.ponds
      .filter((pond) => flow.state.gates.some((gate) => gate.fromPondId === pond.id && gate.state !== '关闭' && gate.openingPct > 0))
      .sort((a, b) => a.seriesName.localeCompare(b.seriesName, 'zh-Hans-CN') || a.code.localeCompare(b.code));
  });

  const filtered = createMemo<FlowOrder[]>(() => {
    const current = flow.filters();
    const keyword = current.keyword.trim().toLowerCase();
    return flow.state.rows.filter((row) => {
      if (current.shift !== 'all' && row.shift !== current.shift) return false;
      if (current.state !== 'all' && row.state !== current.state) return false;
      if (keyword === '') return true;
      return (
        flow.pondLabel(row.pondId).toLowerCase().includes(keyword) ||
        row.cascadePath.toLowerCase().includes(keyword) ||
        row.operator.toLowerCase().includes(keyword) ||
        row.planDate.includes(keyword)
      );
    });
  });

  /** 建单前的实时对账 + 罐容预览（与 createOrder 的判定一致） */
  const draftDecision = createMemo(() => {
    if (draft.pondId === '') return null;
    return flow.decidePlacement(draft.pondId, draft.planDate, draft.shift, draft.volumeM3);
  });

  const tankPct = createMemo(() => {
    const tank = flow.state.tank;
    if (tank.capacityM3 <= 0) return 0;
    return Math.round((tank.occupiedM3 / tank.capacityM3) * 1000) / 10;
  });

  const openCreate = (): void => {
    const pondId = sources()[0]?.id ?? flow.state.ponds[0]?.id ?? '';
    setEditingId(null);
    setDraft(emptyDraft(pondId, flow.state.rows.length + 1));
    setDialogOpen(true);
  };

  const openEdit = (row: FlowOrder): void => {
    setEditingId(row.id);
    setDraft({
      pondId: row.pondId,
      planDate: row.planDate,
      shift: row.shift,
      volumeM3: row.volumeM3,
      operator: row.operator,
      state: row.state,
      orderIndex: row.orderIndex,
    });
    setDialogOpen(true);
  };

  const submit = async (): Promise<void> => {
    if (draft.pondId === '') {
      flow.setMessage('请选择走水源头池');
      return;
    }
    if (editingId() === null) {
      await flow.createOrder({ ...draft });
    } else {
      await flow.updateOrder(editingId() as string, { ...draft });
    }
    setDialogOpen(false);
  };

  const confirmDelete = async (): Promise<void> => {
    const row = deleting();
    if (row === null) return;
    await flow.remove(row.id);
    setDeleting(null);
  };

  const openTank = (): void => {
    setTankDraft({
      name: flow.state.tank.name,
      capacityM3: flow.state.tank.capacityM3,
      occupiedM3: flow.state.tank.occupiedM3,
    });
    setTankOpen(true);
  };

  const submitTank = async (): Promise<void> => {
    await flow.saveTank({ ...tankDraft });
    setTankOpen(false);
  };

  return (
    <div class="space-y-3.5">
      <div class="flex flex-wrap gap-3">
        <StatBadge label="编排单" value={flow.stats().total} suffix="张" tone="primary" />
        <StatBadge label="挂起（未到指标）" value={flow.stats().suspended} suffix="张" tone="warning" />
        <StatBadge label="排队中（罐满）" value={flow.stats().queued} suffix="张" tone="info" />
        <StatBadge label="走水中" value={flow.stats().running} suffix="张" tone="warning" />
        <StatBadge label="已入罐" value={flow.stats().delivered} suffix="张" tone="success" />
      </div>

      <Show when={flow.state.lastMessage !== ''}>
        <div class="rounded-lg border border-brine-200 bg-brine-50 px-3.5 py-2 text-sm text-brine-800">
          {flow.state.lastMessage}
        </div>
      </Show>

      {/* 成品卤罐 */}
      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-[15px] font-semibold text-slate-800">成品卤罐（提锂车间本侧管理）</h2>
            <p class="mt-0.5 text-xs text-slate-500">容量满时新走水排队到下一班；罐位空出后由本侧把最早排队的单子接着排入。</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class={BTN_GHOST} onClick={openTank}>编辑罐台账</button>
            <button
              class={BTN_PRIMARY}
              disabled={Number(releaseText()) <= 0 || Number.isNaN(Number(releaseText()))}
              onClick={() => void flow.releaseTank(Number(releaseText()))}
            >
              罐位空出（外运/倒罐）
            </button>
          </div>
        </header>
        <div class="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div class="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>{flow.state.tank.name}</span>
              <span class="tabular-nums">
                {flow.state.tank.occupiedM3} / {flow.state.tank.capacityM3} m³ · 剩余 {flow.stats().freeM3} m³
              </span>
            </div>
            <div class="h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                class={`h-full rounded-full ${flow.stats().isFull ? 'bg-rose-500' : 'bg-brine-600'}`}
                style={{ width: `${Math.min(100, tankPct())}%` }}
              />
            </div>
          </div>
          <label class="flex items-center gap-1.5 text-[13px] text-slate-600">
            <span>本次空出</span>
            <input
              type="number"
              min="0"
              step="10"
              class="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={releaseText()}
              onInput={(event) => setReleaseText(event.currentTarget.value)}
            />
            <span>m³</span>
          </label>
        </div>
      </section>

      {/* 串级走向 */}
      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="mb-3 text-[15px] font-semibold text-slate-800">池系串级走向</h2>
        <Show when={sources().length === 0} fallback={
          <ul class="grid gap-2 md:grid-cols-2">
            <For each={sources()}>
              {(pond) => {
                const chain = (): string[] => cascadeChainOf(flow.state.gates, pond.id).map(codeOf);
                return (
                  <li class="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
                    <p class="mb-1 text-xs text-slate-500">{pond.seriesName} · 源头 {pond.code}</p>
                    <p class="flex flex-wrap items-center gap-1 font-medium text-slate-800">
                      <For each={chain()}>
                        {(code, index) => (
                          <>
                            <Show when={index() > 0}>
                              <span class="text-brine-500">→</span>
                            </Show>
                            <span class="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{code}</span>
                          </>
                        )}
                      </For>
                    </p>
                  </li>
                );
              }}
            </For>
          </ul>
        }>
          <EmptyPanel title="还没有可用的串级走向" description="先在 /gates 配置开启状态的闸门，提锂车间才能沿闸门排出各池系的走水走向。" />
        </Show>
      </section>

      {/* 走水编排单 */}
      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-[15px] font-semibold text-slate-800">走水编排单（按池号 + 班次与巡测班对账）</h2>
          <button type="button" class={BTN_PRIMARY} onClick={openCreate} disabled={flow.state.ponds.length === 0}>
            + 排下一段走水
          </button>
        </header>

        <div class="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <input
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brine-500"
            placeholder="搜池号 / 走向 / 调度员 / 日期"
            value={flow.filters().keyword}
            onInput={(event) => flow.patchFilters({ keyword: event.currentTarget.value })}
          />
          <select
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            value={flow.filters().shift}
            onChange={(event) => flow.patchFilters({ shift: event.currentTarget.value as ShiftName | 'all' })}
          >
            <option value="all">全部班次</option>
            <For each={SHIFT_OPTIONS}>{(shift) => <option value={shift}>{shift}</option>}</For>
          </select>
          <select
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            value={flow.filters().state}
            onChange={(event) => flow.patchFilters({ state: event.currentTarget.value as FlowOrderState | 'all' })}
          >
            <option value="all">全部状态</option>
            <For each={(['挂起', '排队中', '已排', '走水中', '已入罐'] as FlowOrderState[])}>
              {(state) => <option value={state}>{state}</option>}
            </For>
          </select>
          <button class={BTN_GHOST} onClick={() => flow.resetFilters()}>
            重置
          </button>
          <span class="text-xs text-slate-500">命中 {filtered().length} / {flow.state.rows.length} 张</span>
        </div>

        <Show when={flow.state.rows.length === 0}>
          <EmptyPanel
            title="还没有走水编排单"
            description="排下一段走水时系统先与巡测班对账：池号 + 班次一致且巡测到指标才排入；没到指标的先挂着，卤罐满了就排队到下一班。"
            actionText="排第一段走水"
            onAction={openCreate}
          />
        </Show>

        <Show when={flow.state.rows.length > 0}>
          <ul class="space-y-2">
            <For each={filtered()}>
              {(row) => {
                const check = () => (row.state === '挂起' ? flow.reconcile(row.pondId, row.planDate, row.shift) : null);
                return (
                  <li class="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-3">
                    <div class="min-w-[220px] flex-1">
                      <p class="text-sm font-medium text-slate-800">{flow.pondLabel(row.pondId)}</p>
                      <p class="text-xs text-slate-500">
                        {row.planDate} · {row.shift} · 调度员 {row.operator === '' ? '未填写' : row.operator}
                      </p>
                      <p class="mt-0.5 text-[11px] text-brine-700">走向：{row.cascadePath || '（无可用闸门走向）'}</p>
                      <Show when={row.state === '排队中'}>
                        <p class="mt-0.5 text-[11px] text-violet-700">
                          {row.queueReason}（原排 {row.queuedFromDate} {row.queuedFromShift}）
                        </p>
                      </Show>
                      <Show when={row.state === '挂起' && check() !== null}>
                        <p class="mt-0.5 text-[11px] text-amber-700">{check()!.message}</p>
                      </Show>
                    </div>
                    <div class="text-xs text-slate-600">
                      <p>
                        计划量 <span class="tabular-nums font-medium text-slate-800">{row.volumeM3}</span> m³
                      </p>
                      <p>
                        已入罐 <span class="tabular-nums font-medium text-emerald-700">{row.deliveredM3}</span> m³
                      </p>
                    </div>
                    <span class={`rounded border px-2 py-0.5 text-[11px] ${STATE_STYLE[row.state]}`}>{row.state}</span>
                    <div class="flex flex-wrap items-center gap-2">
                      <Show when={row.state === '挂起'}>
                        <button
                          class="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-100"
                          onClick={() => void flow.retrySuspended(row.id)}
                        >
                          重新对账
                        </button>
                      </Show>
                      <Show when={row.state === '已排'}>
                        <button
                          class="rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1 text-xs text-orange-700 hover:bg-orange-100"
                          onClick={() => void flow.startRunning(row.id)}
                        >
                          开始走水
                        </button>
                      </Show>
                      <Show when={row.state === '走水中'}>
                        <button
                          class="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                          onClick={() => void flow.completeToTank(row.id)}
                        >
                          完成入罐
                        </button>
                      </Show>
                      <button class="text-xs text-brine-700 hover:underline" onClick={() => openEdit(row)}>
                        编辑
                      </button>
                      <button class="text-xs text-rose-600 hover:underline" onClick={() => setDeleting(row)}>
                        删除
                      </button>
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>

      <AppDialog
        open={dialogOpen()}
        title={editingId() === null ? '排下一段走水' : '编辑走水编排单'}
        onClose={() => setDialogOpen(false)}
        footer={
          <>
            <button class={BTN_GHOST} onClick={() => setDialogOpen(false)}>
              取消
            </button>
            <button class={BTN_PRIMARY} onClick={() => void submit()}>
              保存
            </button>
          </>
        }
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>走水源头池</span>
            <select class={INPUT} value={draft.pondId} onChange={(event) => setDraft('pondId', event.currentTarget.value)}>
              <option value="">请选择</option>
              <For each={flow.state.ponds}>
                {(pond) => (
                  <option value={pond.id}>
                    {pond.code} · {pond.seriesName} · {pond.stage}
                  </option>
                )}
              </For>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>班次</span>
            <select class={INPUT} value={draft.shift} onChange={(event) => setDraft('shift', event.currentTarget.value as ShiftName)}>
              <For each={SHIFT_OPTIONS}>{(shift) => <option value={shift}>{shift}</option>}</For>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>计划走水日期</span>
            <input type="date" class={INPUT} value={draft.planDate} onInput={(event) => setDraft('planDate', event.currentTarget.value)} />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>计划量（m³）</span>
            <input
              type="number"
              step="10"
              class={INPUT}
              value={draft.volumeM3}
              onInput={(event) => setDraft('volumeM3', Number(event.currentTarget.value))}
            />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>调度员</span>
            <input class={INPUT} value={draft.operator} onInput={(event) => setDraft('operator', event.currentTarget.value)} />
          </label>
        </div>
        <Show when={draft.pondId !== ''}>
          <p class="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            串级走向：<span class="font-medium text-brine-800">{flow.cascadePathOf(draft.pondId) || '（无可用闸门走向）'}</span>
          </p>
        </Show>
        <Show when={editingId() === null} fallback={
          <p class="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            编辑模式直接按所选状态保存，不再自动对账或排队。
          </p>
        }>
          <p
            class={`mt-2 rounded-md px-3 py-2 text-xs leading-relaxed ${
              draftDecision()?.state === '挂起'
                ? 'bg-amber-50 text-amber-800'
                : draftDecision()?.state === '排队中'
                  ? 'bg-violet-50 text-violet-800'
                  : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            {draftDecision() === null
              ? '请选择源头池。'
              : draftDecision()!.state === '已排'
                ? `对账通过，罐位剩余 ${flow.stats().freeM3} m³，保存后排为「已排」。`
                : draftDecision()!.state === '排队中'
                  ? `本班对账通过但卤罐仅剩 ${flow.stats().freeM3} m³，且下一班（${draftDecision()!.planDate} ${draftDecision()!.shift}）巡测也到指标，保存后排队到该班。`
                  : `${draftDecision()!.check.message}，保存后状态为「挂起」，先不排。`}
          </p>
        </Show>
      </AppDialog>

      <AppDialog
        open={tankOpen()}
        title="成品卤罐台账"
        onClose={() => setTankOpen(false)}
        footer={
          <>
            <button class={BTN_GHOST} onClick={() => setTankOpen(false)}>
              取消
            </button>
            <button class={BTN_PRIMARY} onClick={() => void submitTank()}>
              保存
            </button>
          </>
        }
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-[13px] text-slate-600 sm:col-span-2">
            <span>罐名</span>
            <input class={INPUT} value={tankDraft.name} onInput={(event) => setTankDraft('name', event.currentTarget.value)} />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>总容量（m³）</span>
            <input
              type="number"
              min="0"
              step="10"
              class={INPUT}
              value={tankDraft.capacityM3}
              onInput={(event) => setTankDraft('capacityM3', Number(event.currentTarget.value))}
            />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>当前存量（m³）</span>
            <input
              type="number"
              min="0"
              step="10"
              class={INPUT}
              value={tankDraft.occupiedM3}
              onInput={(event) => setTankDraft('occupiedM3', Number(event.currentTarget.value))}
            />
          </label>
        </div>
      </AppDialog>

      <AppDialog
        open={deleting() !== null}
        title="确认删除走水编排单？"
        width="max-w-lg"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <button class={BTN_GHOST} onClick={() => setDeleting(null)}>
              取消
            </button>
            <button class={BTN_DANGER} onClick={() => void confirmDelete()}>
              确认删除
            </button>
          </>
        }
      >
        <p class="text-sm leading-relaxed text-slate-600">
          将删除「{flow.pondLabel(deleting()?.pondId ?? '')}」{deleting()?.planDate} {deleting()?.shift} 的走水编排单。
          已入罐存量不受影响（如需调整罐存量，请在成品卤罐台账中处理）。
        </p>
      </AppDialog>
    </div>
  );
}
