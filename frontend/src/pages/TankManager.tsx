/**
 * /tanks 成品卤罐管理
 * 提锂车间管理的成品卤罐：容量满时走水排队到下一班，罐位空出来由本侧接着排。
 * 消费模型：FinishedBrineTank、Pond；复用组件：<StatBadge>、<EmptyPanel>
 */
import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import AppDialog from '../components/common/AppDialog';
import EmptyPanel from '../components/common/EmptyPanel';
import StatBadge from '../components/common/StatBadge';
import { usePondStore } from '../stores/pondStore';
import { useTankStore } from '../stores/tankStore';
import type { FinishedBrineTank, TankDraft, TankStatus } from '../types/tank';
import { TANK_STATUS_OPTIONS } from '../types/tank';

const INPUT =
  'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brine-500 focus:ring-1 focus:ring-brine-400';
const BTN_PRIMARY =
  'rounded-md bg-brine-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-brine-700 disabled:opacity-50';
const BTN_GHOST =
  'rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100';
const BTN_DANGER = 'rounded-md bg-rose-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700';

const STATUS_STYLE: Record<TankStatus, string> = {
  正常: 'border-sky-300 bg-sky-50 text-sky-700',
  满: 'border-rose-300 bg-rose-50 text-rose-700',
  空: 'border-slate-300 bg-slate-100 text-slate-600',
};

function emptyDraft(): TankDraft {
  return { code: '', capacityM3: 3000, currentLevelM3: 0, pondId: null, note: '' };
}

export default function TankManager() {
  const tankStore = useTankStore();
  const pondStore = usePondStore();

  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<FinishedBrineTank | null>(null);
  const [draft, setDraft] = createStore<TankDraft>(emptyDraft());

  onMount(() => {
    void pondStore.loadAll();
  });

  const pondLabel = (pondId: string | null): string => {
    if (pondId === null) return '共用';
    const pond = pondStore.state.ponds.find((row) => row.id === pondId);
    return pond === undefined ? '（池已删除）' : `${pond.code} · ${pond.seriesName}`;
  };

  const filtered = createMemo<FinishedBrineTank[]>(() => {
    const keyword = tankStore.filters().keyword.trim().toLowerCase();
    const status = tankStore.filters().status;
    return tankStore.state.rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (keyword === '') return true;
      return row.code.toLowerCase().includes(keyword) || row.note.toLowerCase().includes(keyword);
    });
  });

  const stats = createMemo(() => {
    const total = tankStore.state.rows.length;
    const full = tankStore.state.rows.filter((row) => row.status === '满').length;
    const empty = tankStore.state.rows.filter((row) => row.status === '空').length;
    const totalCapacity = tankStore.state.rows.reduce((acc, row) => acc + row.capacityM3, 0);
    const totalLevel = tankStore.state.rows.reduce((acc, row) => acc + row.currentLevelM3, 0);
    return { total, full, empty, totalCapacity, totalLevel };
  });

  const openCreate = (): void => {
    setEditingId(null);
    setDraft(emptyDraft());
    setDialogOpen(true);
  };

  const openEdit = (row: FinishedBrineTank): void => {
    setEditingId(row.id);
    setDraft({
      code: row.code,
      capacityM3: row.capacityM3,
      currentLevelM3: row.currentLevelM3,
      pondId: row.pondId,
      note: row.note,
    });
    setDialogOpen(true);
  };

  const submit = async (): Promise<void> => {
    if (editingId() === null) {
      await tankStore.createTank({ ...draft });
    } else {
      await tankStore.updateTank(editingId() as string, { ...draft });
    }
    setDialogOpen(false);
  };

  const confirmDelete = async (): Promise<void> => {
    const row = deleting();
    if (row === null) return;
    await tankStore.deleteTank(row.id);
    setDeleting(null);
  };

  return (
    <div class="space-y-3.5">
      <div class="flex flex-wrap gap-3">
        <StatBadge label="卤罐总数" value={stats().total} suffix="个" tone="primary" />
        <StatBadge label="已满" value={stats().full} suffix="个" tone="danger" />
        <StatBadge label="已空" value={stats().empty} suffix="个" tone="default" />
        <StatBadge label="总容量" value={stats().totalCapacity} suffix="m³" tone="info" />
        <StatBadge label="总液位" value={stats().totalLevel} suffix="m³" tone="warning" />
      </div>

      <Show when={tankStore.state.lastMessage !== ''}>
        <div class="rounded-lg border border-brine-200 bg-brine-50 px-3.5 py-2 text-sm text-brine-800">
          {tankStore.state.lastMessage}
        </div>
      </Show>

      <Show when={tankStore.state.error !== ''}>
        <div class="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700">
          {tankStore.state.error}
        </div>
      </Show>

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-[15px] font-semibold text-slate-800">成品卤罐管理</h2>
          <button type="button" class={BTN_PRIMARY} onClick={openCreate} disabled={pondStore.state.ponds.length === 0}>
            + 新建成品卤罐
          </button>
        </header>

        <div class="mb-3.5 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-3">
          <input
            type="text"
            value={tankStore.filters().keyword}
            placeholder="输入罐号或备注筛选"
            class="w-52 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brine-500 focus:ring-1 focus:ring-brine-400"
            onInput={(event) => tankStore.patchFilters({ keyword: event.currentTarget.value })}
          />
          <label class="flex items-center gap-1.5 text-[13px] text-slate-600">
            <span>状态</span>
            <select
              class="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brine-500"
              value={tankStore.filters().status}
              onChange={(event) => tankStore.patchFilters({ status: event.currentTarget.value })}
            >
              <option value="all">全部状态</option>
              <For each={TANK_STATUS_OPTIONS}>{(status) => <option value={status}>{status}</option>}</For>
            </select>
          </label>
          <button
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100"
            onClick={() => tankStore.patchFilters({ keyword: '', status: 'all' })}
          >
            重置筛选
          </button>
          <span class="rounded-full bg-brine-50 px-2.5 py-0.5 text-xs text-brine-700">
            命中 {filtered().length} / {tankStore.state.rows.length} 个
          </span>
        </div>

        <Show when={tankStore.state.rows.length === 0 && !tankStore.state.loading}>
          <EmptyPanel
            title="还没有成品卤罐"
            description="提锂车间管理的成品卤罐：容量满时走水排队到下一班，罐位空出来由本侧接着排。"
            actionText="新建第一个成品卤罐"
            onAction={openCreate}
          />
        </Show>

        <Show when={tankStore.state.rows.length > 0}>
          <div class="grid gap-3 sm:grid-cols-2">
            <For each={filtered()}>
              {(tank) => (
                <div class="rounded-lg border border-slate-200 bg-white p-4">
                  <div class="mb-2 flex items-center justify-between">
                    <h3 class="text-sm font-semibold text-slate-800">{tank.code}</h3>
                    <span class={`rounded border px-2 py-0.5 text-[11px] ${STATUS_STYLE[tank.status]}`}>{tank.status}</span>
                  </div>
                  <div class="mb-2">
                    <div class="mb-1 flex items-center justify-between text-xs text-slate-500">
                      <span>
                        液位 {tank.currentLevelM3} / {tank.capacityM3} m³
                      </span>
                      <span class="tabular-nums">{Math.round((tank.currentLevelM3 / tank.capacityM3) * 100)}%</span>
                    </div>
                    <div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        class={`h-full rounded-full ${tank.status === '满' ? 'bg-rose-500' : tank.status === '空' ? 'bg-slate-400' : 'bg-brine-600'}`}
                        style={{ width: `${Math.min(100, (tank.currentLevelM3 / tank.capacityM3) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <p class="mb-3 text-xs text-slate-500">所属：{pondLabel(tank.pondId)}</p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      class="rounded-md border border-brine-300 bg-brine-50 px-2.5 py-1 text-xs text-brine-700 transition hover:bg-brine-100 disabled:opacity-50"
                      disabled={tank.status === '满'}
                      onClick={() => void tankStore.advanceLevel(tank.id, tank.capacityM3)}
                    >
                      走水入罐
                    </button>
                    <button
                      class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                      disabled={tank.status === '空'}
                      onClick={() => void tankStore.advanceLevel(tank.id, 0)}
                    >
                      出卤排空
                    </button>
                    <button class="text-xs text-brine-700 hover:underline" onClick={() => openEdit(tank)}>
                      编辑
                    </button>
                    <button class="text-xs text-rose-600 hover:underline" onClick={() => setDeleting(tank)}>
                      删除
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={tankStore.state.rows.length > 0 && filtered().length === 0}>
          <EmptyPanel
            title="没有符合筛选条件的卤罐"
            description="可以切换状态筛选，或直接重置筛选。"
            actionText="重置筛选"
            onAction={() => tankStore.patchFilters({ keyword: '', status: 'all' })}
          />
        </Show>
      </section>

      <AppDialog
        open={dialogOpen()}
        title={editingId() === null ? '新建成品卤罐' : '编辑成品卤罐'}
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
            <span>罐号</span>
            <input class={INPUT} value={draft.code} onInput={(event) => setDraft('code', event.currentTarget.value)} />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>所属蒸发池</span>
            <select
              class={INPUT}
              value={draft.pondId ?? ''}
              onChange={(event) => setDraft('pondId', event.currentTarget.value === '' ? null : event.currentTarget.value)}
            >
              <option value="">共用</option>
              <For each={pondStore.state.ponds}>
                {(pond) => (
                  <option value={pond.id}>
                    {pond.code} · {pond.seriesName}
                  </option>
                )}
              </For>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>容量（m³）</span>
            <input
              type="number"
              step="100"
              class={INPUT}
              value={draft.capacityM3}
              onInput={(event) => setDraft('capacityM3', Number(event.currentTarget.value))}
            />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>当前液位（m³）</span>
            <input
              type="number"
              step="100"
              class={INPUT}
              value={draft.currentLevelM3}
              onInput={(event) => setDraft('currentLevelM3', Number(event.currentTarget.value))}
            />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600 sm:col-span-2">
            <span>备注</span>
            <input class={INPUT} value={draft.note} onInput={(event) => setDraft('note', event.currentTarget.value)} />
          </label>
        </div>
        <p class="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
          状态由容量与当前液位自动派生：液位 ≤ 0 为「空」，液位 ≥ 容量为「满」，其余为「正常」。
        </p>
      </AppDialog>

      <AppDialog
        open={deleting() !== null}
        title="确认删除成品卤罐？"
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
          将删除成品卤罐「{deleting()?.code}」（{pondLabel(deleting()?.pondId ?? null)}），容量 {deleting()?.capacityM3} m³。
        </p>
      </AppDialog>
    </div>
  );
}
