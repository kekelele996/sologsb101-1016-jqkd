/**
 * /patrols 巡测班 · 当班巡测单
 * 巡测班在池边把每口池当班测到的密度、水位和风力逐池记成巡测单；
 * 同池同日期同班次只保留一条，指标状态按池阶段实时判定（到指标 / 未到指标）。
 * 消费模型：PatrolSheet、Pond；复用组件：<StatBadge>、<EmptyPanel>
 */
import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import AppDialog from '../components/common/AppDialog';
import EmptyPanel from '../components/common/EmptyPanel';
import StatBadge from '../components/common/StatBadge';
import StageTag from '../components/common/StageTag';
import { usePondStore } from '../stores/pondStore';
import { usePatrolStore } from '../stores/patrolStore';
import { SHIFT_OPTIONS, type ShiftName } from '../types/shift';
import type { PatrolDraft, PatrolSheet } from '../types/patrol';
import { DISCHARGE_DENSITY_TARGET, MIN_FLOW_LEVEL_CM, patrolStatusOf } from '../utils/handoff';
import { today } from '../utils/id';

const INPUT =
  'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brine-500 focus:ring-1 focus:ring-brine-400';
const BTN_PRIMARY =
  'rounded-md bg-brine-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-brine-700 disabled:opacity-50';
const BTN_GHOST =
  'rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100';
const BTN_DANGER = 'rounded-md bg-rose-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700';

function emptyDraft(pondId: string): PatrolDraft {
  return { pondId, date: today(), shift: '白班', densityGcm3: 1.05, levelCm: 40, windLevel: 2, recorder: '', note: '' };
}

export default function PatrolBoard() {
  const pondStore = usePondStore();
  const patrolStore = usePatrolStore();

  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<PatrolSheet | null>(null);
  const [draft, setDraft] = createStore<PatrolDraft>(emptyDraft(''));

  onMount(() => {
    void pondStore.loadAll();
  });

  const pondOf = (pondId: string) => pondStore.state.ponds.find((pond) => pond.id === pondId) ?? null;
  const pondLabel = (pondId: string): string => {
    const pond = pondOf(pondId);
    return pond === null ? '（池已删除）' : `${pond.code} · ${pond.seriesName}`;
  };

  const visible = createMemo(() => patrolStore.visibleFor()(pondStore.state.ponds));

  const stats = createMemo(() => {
    const rows = patrolStore.visibleFor()(pondStore.state.ponds);
    return {
      total: rows.length,
      ready: rows.filter((row) => row.statusLabel === '到指标').length,
      pending: rows.filter((row) => row.statusLabel === '未到指标').length,
      backfilled: patrolStore.state.rows.filter((row) => row.shiftBackfilled).length,
    };
  });

  const previewStatus = createMemo(() => {
    const pond = pondOf(draft.pondId);
    if (pond === null) return null;
    return patrolStatusOf({ densityGcm3: draft.densityGcm3, levelCm: draft.levelCm }, pond.stage);
  });

  const openCreate = (): void => {
    const pondId = pondStore.pondsOfSeries(pondStore.state.currentSeries)[0]?.id ?? pondStore.state.ponds[0]?.id ?? '';
    setEditingId(null);
    setDraft(emptyDraft(pondId));
    setDialogOpen(true);
  };

  const openEdit = (row: PatrolSheet): void => {
    setEditingId(row.id);
    setDraft({
      pondId: row.pondId,
      date: row.date,
      shift: row.shift,
      densityGcm3: row.densityGcm3,
      levelCm: row.levelCm,
      windLevel: row.windLevel,
      recorder: row.recorder,
      note: row.note,
    });
    setDialogOpen(true);
  };

  const submit = async (): Promise<void> => {
    if (draft.pondId === '') {
      patrolStore.setMessage('请选择蒸发池');
      return;
    }
    await patrolStore.saveOne({ ...draft }, editingId());
    setDialogOpen(false);
  };

  const confirmDelete = async (): Promise<void> => {
    const row = deleting();
    if (row === null) return;
    await patrolStore.remove(row.id);
    setDeleting(null);
  };

  return (
    <div class="space-y-3.5">
      <div class="flex flex-wrap gap-3">
        <StatBadge label="本班巡测单" value={stats().total} suffix="张" tone="primary" />
        <StatBadge label="到指标（可排）" value={stats().ready} suffix="池" tone="success" />
        <StatBadge label="未到指标（挂着）" value={stats().pending} suffix="池" tone="warning" />
        <StatBadge label="升级补班次待核" value={stats().backfilled} suffix="张" tone="default" />
      </div>

      <Show when={patrolStore.state.lastMessage !== ''}>
        <div class="rounded-lg border border-brine-200 bg-brine-50 px-3.5 py-2 text-sm text-brine-800">
          {patrolStore.state.lastMessage}
        </div>
      </Show>

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-[15px] font-semibold text-slate-800">巡测班 · 当班巡测单</h2>
            <p class="mt-0.5 text-xs text-slate-500">
              池边逐池记录当班密度、水位、风力；排下一段走水时提锂车间按池号 + 班次与这里对账，没到指标的池先挂着不排。
            </p>
          </div>
          <button type="button" class={BTN_PRIMARY} onClick={openCreate} disabled={pondStore.state.ponds.length === 0}>
            + 记一张巡测单
          </button>
        </header>

        <div class="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <input
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brine-500"
            placeholder="搜日期 / 班次 / 记录人 / 密度"
            value={patrolStore.filters().keyword}
            onInput={(event) => patrolStore.patchFilters({ keyword: event.currentTarget.value })}
          />
          <input
            type="date"
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            value={patrolStore.filters().date}
            onInput={(event) => patrolStore.patchFilters({ date: event.currentTarget.value })}
          />
          <select
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            value={patrolStore.filters().shift}
            onChange={(event) => patrolStore.patchFilters({ shift: event.currentTarget.value as ShiftName | 'all' })}
          >
            <option value="all">全部班次</option>
            <For each={SHIFT_OPTIONS}>{(shift) => <option value={shift}>{shift}</option>}</For>
          </select>
          <select
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            value={patrolStore.filters().status}
            onChange={(event) =>
              patrolStore.patchFilters({ status: event.currentTarget.value as 'all' | '到指标' | '未到指标' })
            }
          >
            <option value="all">全部指标状态</option>
            <option value="到指标">到指标</option>
            <option value="未到指标">未到指标</option>
          </select>
          <label class="flex items-center gap-1 text-slate-600">
            <input
              type="checkbox"
              checked={patrolStore.filters().backfilledOnly}
              onChange={(event) => patrolStore.patchFilters({ backfilledOnly: event.currentTarget.checked })}
            />
            只看升级补班次待核
          </label>
          <button class={BTN_GHOST} onClick={() => patrolStore.resetFilters()}>
            重置
          </button>
          <span class="text-xs text-slate-500">命中 {visible().length} / {patrolStore.state.rows.length} 张</span>
        </div>

        <Show when={patrolStore.state.rows.length === 0}>
          <EmptyPanel
            title="还没有巡测单"
            description="巡测班把每口池当班测到的密度、水位、风力记下来，同池同班只保留一张；到指标的池才会被提锂车间排入走水。"
            actionText="记第一张巡测单"
            onAction={openCreate}
          />
        </Show>

        <Show when={patrolStore.state.rows.length > 0}>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr class="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th class="px-3 py-2">蒸发池</th>
                  <th class="px-3 py-2">日期 / 班次</th>
                  <th class="px-3 py-2 text-right">密度（g/cm³）</th>
                  <th class="px-3 py-2 text-right">水位（cm）</th>
                  <th class="px-3 py-2 text-right">风力</th>
                  <th class="px-3 py-2">当班指标</th>
                  <th class="px-3 py-2">记录人 / 备注</th>
                  <th class="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                <For each={visible()}>
                  {(row) => {
                    const pond = () => pondOf(row.pondId);
                    const target = (): number => (pond() === null ? 0 : DISCHARGE_DENSITY_TARGET[pond()!.stage]);
                    return (
                      <tr class="border-b border-slate-100 hover:bg-slate-50/60">
                        <td class="px-3 py-2.5">
                          <div class="flex items-center gap-2">
                            <span class="font-medium text-slate-800">{pondLabel(row.pondId)}</span>
                            <StageTag stage={pond()?.stage ?? null} size="sm" />
                          </div>
                        </td>
                        <td class="px-3 py-2.5 tabular-nums">
                          {row.date} · {row.shift}
                          <Show when={row.shiftBackfilled}>
                            <span class="ml-1 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] text-amber-700">
                              班次待核
                            </span>
                          </Show>
                        </td>
                        <td class="px-3 py-2.5 text-right tabular-nums">{row.densityGcm3}</td>
                        <td class="px-3 py-2.5 text-right tabular-nums">{row.levelCm}</td>
                        <td class="px-3 py-2.5 text-right tabular-nums">{row.windLevel} 级</td>
                        <td class="px-3 py-2.5">
                          <span
                            class={`rounded border px-2 py-0.5 text-[11px] ${
                              row.statusLabel === '到指标'
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                : 'border-amber-300 bg-amber-50 text-amber-700'
                            }`}
                          >
                            {row.statusLabel}
                          </span>
                          <p class="mt-0.5 text-[10px] text-slate-400">
                            指标 ≥ {target()} · 水位 ≥ {MIN_FLOW_LEVEL_CM} cm
                          </p>
                        </td>
                        <td class="px-3 py-2.5 text-xs text-slate-600">
                          <p>{row.recorder === '' ? '未署名' : row.recorder}</p>
                          <p class="text-slate-400">{row.note}</p>
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
        </Show>
      </section>

      <AppDialog
        open={dialogOpen()}
        title={editingId() === null ? '记一张巡测单' : '编辑巡测单'}
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
            <select class={INPUT} value={draft.shift} onChange={(event) => setDraft('shift', event.currentTarget.value as ShiftName)}>
              <For each={SHIFT_OPTIONS}>{(shift) => <option value={shift}>{shift}</option>}</For>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>巡测日期</span>
            <input type="date" class={INPUT} value={draft.date} onInput={(event) => setDraft('date', event.currentTarget.value)} />
          </label>
          <label class="flex flex-col gap-1 text-[13px] text-slate-600">
            <span>记录人</span>
            <input class={INPUT} value={draft.recorder} onInput={(event) => setDraft('recorder', event.currentTarget.value)} />
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
          <label class="flex flex-col gap-1 text-[13px] text-slate-600 sm:col-span-2">
            <span>备注</span>
            <input class={INPUT} value={draft.note} onInput={(event) => setDraft('note', event.currentTarget.value)} />
          </label>
        </div>
        <p class="mt-3 rounded-md bg-brine-50 px-3 py-2 text-xs leading-relaxed text-brine-800">
          当班判定：
          {previewStatus() === null
            ? '请先选择蒸发池。'
            : previewStatus() === '到指标'
              ? '到指标，提锂车间对账通过即可排入走水。'
              : '还没到指标，这口池会先挂着不排。'}
          同池同日期同班次只保留一张巡测单，重复保存覆盖原记录。
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
          将删除「{pondLabel(deleting()?.pondId ?? '')}」{deleting()?.date} {deleting()?.shift} 的巡测单；
          删除后该班对账会变成「缺巡测单」，相关编排单将无法排入。
        </p>
      </AppDialog>
    </div>
  );
}
