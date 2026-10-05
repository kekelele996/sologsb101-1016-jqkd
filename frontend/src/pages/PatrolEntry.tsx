/**
 * /patrol 巡测单录入与对账
 * 巡测班在池边把每口池当班测到的密度、水位和风力记成巡测单；
 * 提锂车间排下一段走水时按池号和班次对账，还没到指标的池先挂着不排。
 * 消费模型：PatrolSheet、Shift、Pond、Schedule；复用组件：<FilterBar>、<StatBadge>、<EmptyPanel>
 */
import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import AppDialog from '../components/common/AppDialog';
import EmptyPanel from '../components/common/EmptyPanel';
import FilterBar from '../components/common/FilterBar';
import StatBadge from '../components/common/StatBadge';
import { usePatrolStore } from '../stores/patrolStore';
import { usePondStore } from '../stores/pondStore';
import { useShiftStore } from '../stores/shiftStore';
import type { PatrolSheet, PatrolSheetDraft } from '../types/patrolSheet';
import { shiftLabel } from '../types/shift';
import { isHeld, isMissingSheet, reconcileByPondAndShift } from '../utils/reconcile';
import { nowIso } from '../utils/id';

const INPUT =
  'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brine-500 focus:ring-1 focus:ring-brine-400';
const BTN_PRIMARY =
  'rounded-md bg-brine-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-brine-700 disabled:opacity-50';
const BTN_GHOST =
  'rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100';
const BTN_DANGER = 'rounded-md bg-rose-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700';

function emptyDraft(pondId: string, shiftId: string): PatrolSheetDraft {
  return {
    pondId,
    shiftId,
    densityGcm3: 1.05,
    levelCm: 40,
    windLevel: 2,
    measuredAt: nowIso().slice(0, 16),
    note: '',
  };
}

export default function PatrolEntry() {
  const patrolStore = usePatrolStore();
  const pondStore = usePondStore();
  const shiftStore = useShiftStore();

  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<PatrolSheet | null>(null);
  const [draft, setDraft] = createStore<PatrolSheetDraft>(emptyDraft('', ''));

  onMount(() => {
    void pondStore.loadAll();
  });

  const pondOf = (pondId: string) => pondStore.state.ponds.find((pond) => pond.id === pondId) ?? null;
  const pondLabel = (pondId: string): string => {
    const pond = pondOf(pondId);
    return pond === null ? '（池已删除）' : `${pond.code} · ${pond.seriesName}`;
  };
  const shiftOf = (shiftId: string) => shiftStore.state.rows.find((shift) => shift.id === shiftId) ?? null;

  /** 组合池系筛选 + 班次筛选 */
  const filtered = createMemo<PatrolSheet[]>(() => {
    const series = pondStore.state.currentSeries;
    const shiftId = patrolStore.filters().shiftId;
    const keyword = patrolStore.filters().keyword.trim().toLowerCase();
    return patrolStore.state.rows.filter((row) => {
      if (shiftId !== 'all' && row.shiftId !== shiftId) return false;
      if (series !== null) {
        const pond = pondOf(row.pondId);
        if (pond?.seriesName !== series) return false;
      }
      if (keyword === '') return true;
      return pondLabel(row.pondId).toLowerCase().includes(keyword) || row.note.toLowerCase().includes(keyword);
    });
  });

  /** 按班次分组的巡测单 */
  const groupedByShift = createMemo<Array<{ shiftId: string; label: string; rows: PatrolSheet[] }>>(() => {
    const map = new Map<string, PatrolSheet[]>();
    filtered().forEach((row) => {
      const list = map.get(row.shiftId) ?? [];
      list.push(row);
      map.set(row.shiftId, list);
    });
    return Array.from(map.entries())
      .map(([shiftId, rows]) => ({
        shiftId,
        label: shiftOf(shiftId) === null ? '未知班次' : shiftLabel(shiftOf(shiftId) as NonNullable<ReturnType<typeof shiftOf>>),
        rows: rows.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)),
      }))
      .sort((a, b) => b.label.localeCompare(a.label));
  });

  /** 统计：巡测单条数、已到指标、挂着、缺单 */
  const stats = createMemo(() => {
    const total = filtered().length;
    let matched = 0;
    let held = 0;
    let missing = 0;
    filtered().forEach((row) => {
      const result = reconcileByPondAndShift(row.pondId, row.shiftId, pondStore.state.patrolSheets, pondStore.state.schedules);
      if (result.matched) matched += 1;
      else if (isHeld(result)) held += 1;
      else if (isMissingSheet(result)) missing += 1;
    });
    return { total, matched, held, missing };
  });

  const openCreate = (): void => {
    const pondId = pondStore.pondsOfSeries(pondStore.state.currentSeries)[0]?.id ?? pondStore.state.ponds[0]?.id ?? '';
    const shiftId = shiftStore.state.rows[0]?.id ?? '';
    setEditingId(null);
    setDraft(emptyDraft(pondId, shiftId));
    setDialogOpen(true);
  };

  const openEdit = (row: PatrolSheet): void => {
    setEditingId(row.id);
    setDraft({
      pondId: row.pondId,
      shiftId: row.shiftId,
      densityGcm3: row.densityGcm3,
      levelCm: row.levelCm,
      windLevel: row.windLevel,
      measuredAt: row.measuredAt,
      note: row.note,
    });
    setDialogOpen(true);
  };

  const submit = async (): Promise<void> => {
    if (draft.pondId === '') {
      patrolStore.setMessage('请选择蒸发池');
      return;
    }
    if (draft.shiftId === '') {
      patrolStore.setMessage('请选择班次');
      return;
    }
    await patrolStore.saveOne({ ...draft });
    setDialogOpen(false);
  };

  const confirmDelete = async (): Promise<void> => {
    const row = deleting();
    if (row === null) return;
    await patrolStore.deletePatrolSheet(row.id);
    setDeleting(null);
  };

  return (
    <div class="space-y-3.5">
      <div class="flex flex-wrap gap-3">
        <StatBadge label="巡测单条数" value={stats().total} suffix="条" tone="primary" />
        <StatBadge label="已到指标" value={stats().matched} suffix="条" tone="success" />
        <StatBadge label="挂着未排" value={stats().held} suffix="条" tone="warning" />
        <StatBadge label="缺巡测单" value={stats().missing} suffix="条" tone="danger" />
      </div>

      <Show when={patrolStore.state.lastMessage !== ''}>
        <div class="rounded-lg border border-brine-200 bg-brine-50 px-3.5 py-2 text-sm text-brine-800">
          {patrolStore.state.lastMessage}
        </div>
      </Show>

      <Show when={patrolStore.state.error !== ''}>
        <div class="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700">
          {patrolStore.state.error}
        </div>
      </Show>

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-[15px] font-semibold text-slate-800">巡测单录入与对账</h2>
          <button type="button" class={BTN_PRIMARY} onClick={openCreate} disabled={pondStore.state.ponds.length === 0}>
            + 录入巡测单
          </button>
        </header>

        <FilterBar
          keyword={patrolStore.filters().keyword}
          onKeyword={(value) => patrolStore.patchFilters({ keyword: value })}
          fields={[
            { key: 'series', label: '池系', options: pondStore.seriesOptions() },
            { key: 'shift', label: '班次', options: shiftStore.state.rows.map((row) => shiftLabel(row)) },
          ]}
          values={{ series: pondStore.state.currentSeries ?? 'all', shift: patrolStore.filters().shiftId }}
          onChange={(key, value) => {
            if (key === 'series') pondStore.setCurrentSeries(value === 'all' ? null : value);
            if (key === 'shift') {
              const shift = shiftStore.state.rows.find((row) => shiftLabel(row) === value);
              patrolStore.patchFilters({ shiftId: value === 'all' ? 'all' : (shift?.id ?? 'all') });
            }
          }}
          onReset={() => {
            patrolStore.patchFilters({ keyword: '', shiftId: 'all' });
            pondStore.setCurrentSeries(pondStore.seriesOptions()[0] ?? null);
          }}
          resultText={`命中 ${filtered().length} / ${patrolStore.state.rows.length} 条`}
        />

        <Show when={patrolStore.state.rows.length === 0 && !patrolStore.state.loading}>
          <EmptyPanel
            title="还没有巡测单记录"
            description="巡测班在池边把每口池当班测到的密度、水位和风力记成巡测单；提锂车间按池号和班次对账，还没到指标的池先挂着不排。"
            actionText="录入第一条巡测单"
            onAction={openCreate}
          />
        </Show>

        <Show when={patrolStore.state.rows.length > 0}>
          <div class="space-y-4">
            <For each={groupedByShift()}>
              {(group) => (
                <div>
                  <h3 class="mb-2 text-sm font-semibold text-slate-700">{group.label}</h3>
                  <div class="overflow-x-auto">
                    <table class="w-full min-w-[860px] border-collapse text-sm">
                      <thead>
                        <tr class="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                          <th class="px-3 py-2">蒸发池</th>
                          <th class="px-3 py-2 text-right">密度（g/cm³）</th>
                          <th class="px-3 py-2 text-right">水位（cm）</th>
                          <th class="px-3 py-2 text-right">风力等级</th>
                          <th class="px-3 py-2">测量时间</th>
                          <th class="px-3 py-2">对账状态</th>
                          <th class="px-3 py-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={group.rows}>
                          {(row) => {
                            const result = (): ReturnType<typeof reconcileByPondAndShift> =>
                              reconcileByPondAndShift(row.pondId, row.shiftId, pondStore.state.patrolSheets, pondStore.state.schedules);
                            return (
                              <tr class="border-b border-slate-100 hover:bg-slate-50/60">
                                <td class="px-3 py-2.5">{pondLabel(row.pondId)}</td>
                                <td class="px-3 py-2.5 text-right tabular-nums">{row.densityGcm3}</td>
                                <td class="px-3 py-2.5 text-right tabular-nums">{row.levelCm}</td>
                                <td class="px-3 py-2.5 text-right tabular-nums">{row.windLevel} 级</td>
                                <td class="px-3 py-2.5 text-xs text-slate-500">{row.measuredAt.replace('T', ' ')}</td>
                                <td class="px-3 py-2.5">
                                  <Show
                                    when={result().matched}
                                    fallback={
                                      <span
                                        class={`rounded border px-2 py-0.5 text-[11px] ${
                                          isHeld(result())
                                            ? 'border-amber-300 bg-amber-50 text-amber-700'
                                            : 'border-rose-300 bg-rose-50 text-rose-700'
                                        }`}
                                      >
                                        {result().reason || '未对账'}
                                      </span>
                                    }
                                  >
                                    <span class="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                                      已到指标（{result().densityGcm3} ≥ {result().targetDensity}）
                                    </span>
                                  </Show>
                                </td>
                                <td class="px-3 py-2.5">
                                  <div class="flex gap-2">
                                    <button class="text-xs text-brine-700 hover:underline" onClick={() => openEdit(row)}>
                                      编辑
                                    </button>
                                    <button class="text-xs text-rose-600 hover:underline" onClick={() => setDeleting(row)}>
                                      删除
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          }}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={patrolStore.state.rows.length > 0 && filtered().length === 0}>
          <EmptyPanel
            title="没有符合筛选条件的巡测单"
            description="可以切换池系或班次筛选，或直接重置筛选。"
            actionText="重置筛选"
            onAction={() => patrolStore.patchFilters({ keyword: '', shiftId: 'all' })}
          />
        </Show>
      </section>

      <AppDialog
        open={dialogOpen()}
        title={editingId() === null ? '录入巡测单' : '编辑巡测单'}
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
            <span>蒸发池</span>
            <select class={INPUT} value={draft.pondId} onChange={(event) => setDraft('pondId', event.currentTarget.value)}>
              <option value="">请选择</option>
              <For each={pondStore.state.ponds}>
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
            <select class={INPUT} value={draft.shiftId} onChange={(event) => setDraft('shiftId', event.currentTarget.value)}>
              <option value="">请选择</option>
              <For each={shiftStore.state.rows}>
                {(shift) => <option value={shift.id}>{shiftLabel(shift)}</option>}
              </For>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>密度（g/cm³）</span>
            <input
              type="number"
              step="0.001"
              min="1"
              max="1.4"
              class={INPUT}
              value={draft.densityGcm3}
              onInput={(event) => setDraft('densityGcm3', Number(event.currentTarget.value))}
            />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>水位（cm）</span>
            <input
              type="number"
              step="1"
              class={INPUT}
              value={draft.levelCm}
              onInput={(event) => setDraft('levelCm', Number(event.currentTarget.value))}
            />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>风力等级（0–8）</span>
            <input
              type="number"
              min="0"
              max="8"
              step="1"
              class={INPUT}
              value={draft.windLevel}
              onInput={(event) => setDraft('windLevel', Number(event.currentTarget.value))}
            />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>测量时间</span>
            <input
              type="datetime-local"
              class={INPUT}
              value={draft.measuredAt}
              onInput={(event) => setDraft('measuredAt', event.currentTarget.value)}
            />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600 sm:col-span-2">
            <span>备注</span>
            <input class={INPUT} value={draft.note} onInput={(event) => setDraft('note', event.currentTarget.value)} />
          </label>
        </div>
        <p class="mt-3 rounded-md bg-brine-50 px-3 py-2 text-xs leading-relaxed text-brine-800">
          同一蒸发池与同一班次只会保留一条巡测单，重复保存将覆盖原记录；排下一段走水时按池号和班次对账，还没到指标的池先挂着不排。
        </p>
      </AppDialog>

      <AppDialog
        open={deleting() !== null}
        title="确认删除巡测单？"
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
          将删除「{pondLabel(deleting()?.pondId ?? '')}」在 {shiftOf(deleting()?.shiftId ?? '') === null ? '未知班次' : shiftLabel(shiftOf(deleting()?.shiftId ?? '') as NonNullable<ReturnType<typeof shiftOf>>)} 的巡测记录。
        </p>
      </AppDialog>
    </div>
  );
}
