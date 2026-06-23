import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, BellRing, Flame, Gauge, LineChart, Loader2, RefreshCw, Sparkles, Target, Timer } from 'lucide-react'
import { DatePicker } from '@/components/DatePicker'
import { api, type MarketSnapshotRow, type OverviewDimensionRankItem, type OverviewMarket, type AlertEvent } from '@/lib/api'
import { QK } from '@/lib/queryKeys'
import { fmtBigNum, fmtPct } from '@/lib/format'
import { useDataStatus, useCapabilities } from '@/lib/useSharedQueries'
import { SealedBadge } from '@/components/SealedBadge'
import { StockPreviewDialog } from '@/components/StockPreviewDialog'
import { cn } from '@/lib/cn'
import { cnSignal } from '@/lib/signals'
import { boardTag } from '@/components/stock-table/primitives'

function n(v: number | null | undefined) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function scoreColor(v: number) {
  // A 股惯例: 强势=红, 弱式=绿
  if (v >= 70) return '#F04438'
  if (v >= 55) return '#FB923C'
  if (v >= 45) return '#F59E0B'
  if (v >= 30) return '#84CC16'
  return '#12B76A'
}

function fmtPrice(v: number | null | undefined, digits = 2) {
  const x = n(v)
  return x == null ? '—' : x.toFixed(digits)
}

function fmtIndexPct(v: number | null | undefined) {
  const x = n(v)
  if (x == null) return '—'
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`
}

function fmtStockPct(v: number | null | undefined) {
  const x = n(v)
  if (x == null) return '—'
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`
}

function pctClass(v: number | null | undefined) {
  const x = n(v)
  if (x == null || x === 0) return 'text-muted'
  return x > 0 ? 'text-bull' : 'text-bear'
}

function quoteAge(ms?: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60}s`
}

function compactCount(v: number | null | undefined) {
  const x = n(v)
  if (x == null) return '—'
  if (x >= 1000) return `${(x / 1000).toFixed(1)}k`
  return x.toFixed(0)
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Activity; title: string; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-accent" />
        <h2 className="text-xs font-semibold text-foreground">{title}</h2>
      </div>
      {hint && <span className="font-mono text-[10px] text-muted">{hint}</span>}
    </div>
  )
}

// 看板监控中心小组件 — 显示前 10 条触发记录 + 更多按钮
const _SOURCE_BADGE: Record<string, string> = {
  strategy: 'bg-amber-400/10 text-amber-400',
  signal: 'bg-accent/10 text-accent',
  price: 'bg-emerald-400/10 text-emerald-400',
  market: 'bg-purple-500/10 text-purple-400',
}
const _SOURCE_LABEL: Record<string, string> = {
  strategy: '策略', signal: '信号', price: '价格', market: '异动',
}
const _SEVERITY_BAR: Record<string, string> = {
  info: 'bg-accent/40', warn: 'bg-warning', critical: 'bg-danger',
}

function MonitorWidget() {
  const [previewEv, setPreviewEv] = useState<AlertEvent | null>(null)
  const alerts = useQuery({
    queryKey: ['alerts', ''],
    queryFn: () => api.alertsList({ days: 7, limit: 10 }),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  })
  const events: AlertEvent[] = alerts.data?.alerts ?? []

  if (events.length === 0) {
    return (
      <div className="mt-1 py-6 text-center text-[11px] text-muted">暂无触发记录</div>
    )
  }

  return (
    <>
      <div className="mt-1 space-y-1.5">
        {events
          .filter((ev: AlertEvent) => !(ev.source === 'strategy' && !ev.symbol))
          .map((ev, i) => {
          const sev = _SEVERITY_BAR[ev.severity ?? 'info'] ?? _SEVERITY_BAR.info
          const pct = ev.change_pct ?? 0
          const isStrategy = ev.source === 'strategy'
          const sm = isStrategy ? ev.message?.match(/策略「([^」]+)」/) : null
          const sname = sm ? sm[1] : ''
          const isNew = ev.type === 'new_entry'
          return (
            <motion.div
              key={`${ev.ts}-${i}`}
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3) }}
              className="relative overflow-hidden rounded-md border border-border/40 bg-surface/60 pl-2.5 pr-2 py-1.5 hover:border-border hover:bg-surface transition-colors"
            >
              <div className={cn('absolute left-0 top-0 h-full w-0.5', sev)} />
              {/* 第一行: 代码 + 名称 + 价格 + 涨跌幅 (点击代码/名称弹日K) */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => ev.symbol && setPreviewEv(ev)}
                  title={ev.symbol ? `查看 ${ev.symbol} 日K` : undefined}
                  className="inline-flex items-center gap-1 min-w-0 shrink-0 rounded hover:bg-elevated/60 transition-colors -mx-0.5 px-0.5 cursor-pointer"
                >
                  <span className="font-mono text-[10px] font-medium text-foreground/80 hover:text-accent">{ev.symbol?.replace(/\.(SH|SZ|BJ)$/, '')}</span>
                  {ev.symbol && (() => {
                    const board = boardTag(ev.symbol)
                    return board && (
                      <span className={`inline-flex items-center justify-center h-3 w-3 rounded text-[7px] font-bold leading-none border ${board.color}`}>
                        {board.label}
                      </span>
                    )
                  })()}
                  {ev.name && <span className="text-[10px] text-secondary truncate max-w-[5rem] hover:text-foreground">{ev.name}</span>}
                </button>
                <span className="flex-1" />
                {ev.price != null && (
                  <span className="text-[10px] font-mono text-foreground/60 shrink-0">{fmtPrice(ev.price)}</span>
                )}
                {ev.change_pct != null && (
                  <span className={cn('text-[10px] font-mono font-medium shrink-0 w-12 text-right', pct >= 0 ? 'text-danger' : 'text-bear')}>
                    {fmtPct(pct)}
                  </span>
                )}
              </div>
              {/* 第二行: 策略类型走新格式, 其他走旧格式 */}
              {isStrategy ? (
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={cn('text-[9px] font-medium', isNew ? 'text-danger' : 'text-emerald-400')}>
                    {isNew ? '进入' : '移出'}
                  </span>
                  <span className="text-[9px] text-muted">策略</span>
                  <span className="text-[9px] font-medium text-amber-400">「{sname}」</span>
                  <span className="flex-1" />
                  <span className="text-[8px] text-muted/50 shrink-0 font-mono">
                    {ev.ts ? new Date(ev.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              ) : (
                <>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className={cn('shrink-0 rounded px-1 py-px text-[8px] font-medium', _SOURCE_BADGE[ev.source] ?? 'bg-elevated text-muted')}>
                      {_SOURCE_LABEL[ev.source] ?? ev.source}
                    </span>
                    {ev.message && (
                      <span className="text-[9px] text-muted truncate flex-1">{ev.message}</span>
                    )}
                    <span className="text-[8px] text-muted/50 shrink-0 font-mono">
                      {ev.ts ? new Date(ev.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  {ev.signals && ev.signals.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ev.signals.map((s, j) => (
                        <span key={j} className="rounded bg-accent/8 px-1 py-px text-[8px] text-accent/80">{cnSignal(s)}</span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )
        })}
      </div>

      <StockPreviewDialog
        symbol={previewEv?.symbol ?? null}
        name={previewEv?.name ?? undefined}
        triggerInfo={previewEv ? {
          price: previewEv.price ?? null,
          changePct: previewEv.change_pct ?? null,
          ts: previewEv.ts,
          signals: previewEv.signals,
          message: previewEv.message,
        } : null}
        onClose={() => setPreviewEv(null)}
      />
    </>
  )
}

function KpiCell({ label, value, sub, tone = 'neutral' }: { label: ReactNode; value: ReactNode; sub?: string; tone?: 'bull' | 'bear' | 'accent' | 'neutral' }) {
  const isPlain = typeof value === 'string' || typeof value === 'number'
  const color = tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : tone === 'accent' ? 'text-accent' : 'text-foreground'
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface/80 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted">{label}</div>
      <div className={`mt-1 truncate font-mono text-lg font-semibold leading-none tabular-nums ${isPlain ? color : 'text-foreground'}`}>{value}</div>
      {sub && <div className="mt-1 truncate text-[10px] text-muted">{sub}</div>}
    </div>
  )
}

function IndexTicker({ item }: { item: OverviewMarket['indices'][number] }) {
  const pct = item.change_pct
  const isUp = (n(pct) ?? 0) >= 0
  return (
    <Link
      to={`/indices?symbol=${encodeURIComponent(item.symbol)}`}
      className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5 rounded-lg border border-border bg-elevated/45 px-2.5 py-1.5 transition-colors hover:border-accent/40 hover:bg-elevated"
    >
      <div className="truncate text-xs font-medium text-foreground">{item.name || item.symbol}</div>
      <div className={`font-mono text-xs font-semibold ${pctClass(pct)}`}>{fmtIndexPct(pct)}</div>
      <div className="font-mono text-[10px] text-muted">{item.symbol}</div>
      <div className={`flex items-center gap-1 font-mono text-[11px] ${pctClass(pct)}`}>
        {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        {fmtPrice(item.last_price)}
      </div>
    </Link>
  )
}

function BreadthBar({ data }: { data: OverviewMarket['breadth'] }) {
  const denom = Math.max(data.total, 1)
  const upW = data.up / denom * 100
  const downW = data.down / denom * 100
  const flatW = Math.max(0, 100 - upW - downW)
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-elevated">
        <div className="bg-bull/85" style={{ width: `${upW}%` }} />
        <div className="bg-muted/45" style={{ width: `${flatW}%` }} />
        <div className="bg-bear/85" style={{ width: `${downW}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-[11px]">
        <div className="rounded bg-bull/8 px-2 py-1 text-bull">涨 <span className="font-mono">{data.up}</span></div>
        <div className="rounded bg-elevated/70 px-2 py-1 text-muted">平 <span className="font-mono">{data.flat}</span></div>
        <div className="rounded bg-bear/8 px-2 py-1 text-bear">跌 <span className="font-mono">{data.down}</span></div>
      </div>
    </div>
  )
}

function DistributionBars({ rows }: { rows: OverviewMarket['distribution'] }) {
  const maxCount = Math.max(...rows.map(r => r.count), 1)
  return (
    <div className="grid h-24 grid-cols-8 items-end gap-1 pt-1">
      {rows.map((r, i) => {
        const positive = i >= 4
        return (
          <div key={r.label} className="flex h-full min-w-0 flex-col items-center justify-end gap-0.5">
            <div className="font-mono text-[9px] text-muted">{r.count || ''}</div>
            <div
              className={`w-2 rounded-full ${positive ? 'bg-gradient-to-t from-bull/45 to-bull/90' : 'bg-gradient-to-t from-bear/45 to-bear/90'}`}
              style={{ height: `${Math.max(4, r.count / maxCount * 86)}%` }}
              title={`${r.label}: ${r.count}只`}
            />
            <div className="truncate text-[9px] text-muted">{r.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function EmotionRadar({ radar, score }: { radar: OverviewMarket['radar']; score: number }) {
  const size = 240
  const cx = size / 2
  const cy = size / 2
  const maxR = 78
  const color = scoreColor(score)
  if (!radar.length) return <div className="flex h-52 items-center justify-center text-xs text-muted">暂无雷达数据</div>
  const points = radar.map((r, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / radar.length
    const radius = maxR * Math.max(0, Math.min(100, r.value)) / 100
    return {
      ...r,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      lx: cx + Math.cos(angle) * (maxR + 27),
      ly: cy + Math.sin(angle) * (maxR + 27),
      gx: cx + Math.cos(angle) * maxR,
      gy: cy + Math.sin(angle) * maxR,
    }
  })
  const polygon = points.map(p => `${p.x},${p.y}`).join(' ')
  const gridPolygons = [1, 0.66, 0.33].map((level, idx) => ({
    level,
    idx,
    points: radar.map((_, i) => {
      const angle = -Math.PI / 2 + i * 2 * Math.PI / radar.length
      return `${cx + Math.cos(angle) * maxR * level},${cy + Math.sin(angle) * maxR * level}`
    }).join(' '),
  }))
  return (
    <div className="flex justify-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-56 w-full">
        <defs>
          <radialGradient id="emotionRadarFill" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor={`${color}57`} />
            <stop offset="100%" stopColor={`${color}1f`} />
          </radialGradient>
          <radialGradient id="emotionRadarCenter" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="rgba(15,23,42,0.92)" />
            <stop offset="68%" stopColor="rgba(15,23,42,0.70)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0)" />
          </radialGradient>
        </defs>
        {gridPolygons.map(g => (
          <polygon
            key={g.level}
            points={g.points}
            fill={g.idx % 2 === 0 ? 'rgba(30,41,59,0.26)' : 'rgba(15,23,42,0.16)'}
            stroke={g.level === 1 ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.12)'}
            strokeWidth={g.level === 1 ? 1.2 : 0.8}
          />
        ))}
        {points.map(p => <line key={p.key} x1={cx} y1={cy} x2={p.gx} y2={p.gy} stroke="rgba(148,163,184,0.08)" />)}
        <polygon points={polygon} fill="url(#emotionRadarFill)" stroke={color} strokeWidth="2" />
        {points.map(p => <circle key={p.key} cx={p.x} cy={p.y} r="2.8" fill={color} stroke="rgba(15,23,42,0.9)" strokeWidth="1" />)}
        <circle cx={cx} cy={cy} r="29" fill="url(#emotionRadarCenter)" />
        <text x={cx} y={cy + 7} textAnchor="middle" className="fill-foreground font-mono text-[24px] font-bold">{score}</text>
        {points.map(p => (
          <text key={`${p.key}-label`} x={p.lx} y={p.ly + 4} textAnchor="middle" className="fill-secondary text-[10px] font-medium">{p.label}</text>
        ))}
      </svg>
    </div>
  )
}

function LadderMini({ limit }: { limit: OverviewMarket['limit'] }) {
  const tiers = limit.tiers.filter(t => t.boards >= 2).slice(0, 6)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between rounded bg-elevated/55 px-2 py-1.5 text-[11px]">
        <span className="text-muted">封板率</span>
        <span className="font-mono text-accent">{(limit.seal_rate ?? 0).toFixed(0)}%</span>
      </div>
      {tiers.length === 0 && <div className="rounded border border-dashed border-border py-5 text-center text-xs text-muted">暂无 2 板以上</div>}
      {tiers.map(t => (
        <div key={t.boards} className="grid grid-cols-[42px_1fr_auto] items-center gap-2 rounded bg-elevated/35 px-2 py-1.5">
          <span className={`font-mono text-sm font-bold ${t.boards >= 5 ? 'text-bull' : t.boards >= 3 ? 'text-accent' : 'text-secondary'}`}>{t.boards}板</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-base">
            <div className="h-full rounded-full bg-bull/70" style={{ width: `${Math.min(100, t.count * 12)}%` }} />
          </div>
          <span className="font-mono text-xs text-foreground">{t.count}</span>
        </div>
      ))}
    </div>
  )
}

function MiniMetric({ label, value, cls = 'text-foreground' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded bg-elevated/45 px-2 py-1.5">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-xs font-semibold ${cls}`}>{value}</div>
    </div>
  )
}

function StockList({ title, rows, mode }: { title: string; rows: MarketSnapshotRow[]; mode: 'gain' | 'loss' | 'amount' | 'active' }) {
  return (
    <div className="rounded-card border border-border bg-surface/80 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        <span className="text-[9px] text-muted">TOP {Math.min(rows.length, 8)}</span>
      </div>
      <div className="space-y-1">
        {rows.slice(0, 8).map((r, idx) => (
          <div key={`${r.symbol}-${idx}`} className="grid grid-cols-[18px_1fr_auto] items-center gap-1.5 rounded bg-elevated/40 px-1.5 py-1">
            <span className="text-center font-mono text-[10px] text-muted">{idx + 1}</span>
            <div className="min-w-0">
              <div className="truncate text-[11px] text-foreground">{r.name || r.symbol}</div>
              <div className="font-mono text-[9px] text-muted">{r.symbol}</div>
            </div>
            <div className="text-right">
              {mode === 'amount' ? (
                <>
                  <div className="font-mono text-[11px] text-foreground">{fmtBigNum(r.amount)}</div>
                  <div className={`font-mono text-[9px] ${pctClass(r.change_pct)}`}>{fmtStockPct(r.change_pct)}</div>
                </>
              ) : mode === 'active' ? (
                <>
                  {/* overview 的 turnover_rate 为小数制, 需 ×100 转百分数显示 */}
                  <div className="font-mono text-[11px] text-accent">{fmtPrice(r.turnover_rate != null ? r.turnover_rate * 100 : null, 1)}%</div>
                  <div className={`font-mono text-[9px] ${pctClass(r.change_pct)}`}>{fmtStockPct(r.change_pct)}</div>
                </>
              ) : (
                <>
                  <div className={`font-mono text-[11px] font-semibold ${pctClass(r.change_pct)}`}>{fmtStockPct(r.change_pct)}</div>
                  <div className="font-mono text-[9px] text-muted">{fmtPrice(r.close)}</div>
                </>
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="py-5 text-center text-xs text-muted">暂无数据</div>}
      </div>
    </div>
  )
}

function RankColumn({ title, rows, tone }: { title: string; rows: OverviewDimensionRankItem[]; tone: 'bull' | 'bear' }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className={`text-[10px] font-medium ${tone === 'bull' ? 'text-bull' : 'text-bear'}`}>{title}</div>
      {rows.slice(0, 5).map((r, idx) => (
        <div key={`${title}-${r.name}-${idx}`} className="grid grid-cols-[14px_1fr_auto] items-center gap-1 rounded bg-elevated/40 px-1.5 py-1">
          <span className="text-center font-mono text-[9px] text-muted">{idx + 1}</span>
          <div className="min-w-0">
            <div className="truncate text-[11px] text-foreground" title={r.name}>{r.name}</div>
            <div className="truncate text-[9px] text-muted">{r.count}只 · {r.leader?.name ?? '—'}</div>
          </div>
          <div className={`font-mono text-[10px] font-semibold ${pctClass(r.avg_pct)}`}>{fmtStockPct(r.avg_pct)}</div>
        </div>
      ))}
      {rows.length === 0 && <div className="rounded border border-dashed border-border py-4 text-center text-xs text-muted">暂无数据</div>}
    </div>
  )
}

function HotRankCard({ title, rank, configUrl }: { title: string; rank?: OverviewMarket['concept_rank']; configUrl: string }) {
  const hasData = (rank?.leading?.length ?? 0) > 0 || (rank?.lagging?.length ?? 0) > 0
  return (
    <section className="rounded-card border border-border bg-surface/80 p-2.5">
      <SectionTitle icon={Flame} title={title} hint="领涨/领跌" />
      {hasData ? (
        <div className="grid grid-cols-2 gap-2">
          <RankColumn title="领涨" rows={rank?.leading ?? []} tone="bull" />
          <RankColumn title="领跌" rows={rank?.lagging ?? []} tone="bear" />
        </div>
      ) : (
        <div className="py-4 text-center">
          <p className="text-[11px] text-muted">未配置扩展数据源</p>
          <Link
            to={configUrl}
            className="mt-1.5 inline-block text-[11px] text-accent hover:text-accent/80 transition-colors"
          >
            前往配置 →
          </Link>
        </div>
      )}
    </section>
  )
}

export function Dashboard() {
  const [selectedDate, setSelectedDate] = useState<string | undefined>()
  const [manualFetching, setManualFetching] = useState(false)
  const dataStatus = useDataStatus({ staleTime: 60_000 })
  const overview = useQuery({
    queryKey: QK.overviewMarket(selectedDate),
    queryFn: () => api.overviewMarket(selectedDate),
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  })
  const data = overview.data
  const caps = useCapabilities()
  const hasDepth = !!caps.data?.capabilities?.['depth5.batch']
  const sealedReady = !!data?.limit?.sealed_ready
  const isSealedDegrade = !hasDepth || !sealedReady

  // 手动刷新: 显示旋转动画; SSE 自动刷新: 静默, 无体感
  const handleRefresh = () => {
    setManualFetching(true)
    overview.refetch().finally(() => setManualFetching(false))
  }

  if (overview.isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center bg-base">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载市场看板…
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center bg-base p-6">
        <div className="rounded-card border border-border bg-surface p-6 text-center">
          <div className="text-sm text-danger">看板加载失败</div>
          <button onClick={() => overview.refetch()} className="mt-3 rounded-btn bg-accent px-3 py-1.5 text-xs font-medium text-base">重试</button>
        </div>
      </div>
    )
  }

  const score = data.emotion?.score ?? 50
  const strongUp = data.breadth.strong_up ?? 0
  const strongDown = data.breadth.strong_down ?? 0
  const latestDate = dataStatus.data?.enriched?.latest_date ?? null
  const currentDate = selectedDate ?? data.as_of ?? ''
  const quoteRunning = (!selectedDate || selectedDate === latestDate) && data.quote_status?.running

  return (
    <div className="min-h-full bg-base p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface/85 px-3 py-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-accent" />
          <h1 className="text-base font-semibold text-foreground">市场看板</h1>
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{
              color: scoreColor(score),
              borderColor: `${scoreColor(score)}40`,
              background: `${scoreColor(score)}14`,
            }}
          >
            {data.emotion.label} · {score}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          {currentDate ? (
            <DatePicker
              value={currentDate}
              onChange={setSelectedDate}
              min={dataStatus.data?.enriched?.earliest_date ?? undefined}
              max={latestDate ?? undefined}
              className="w-32"
            />
          ) : (
            <span className="font-mono text-secondary">—</span>
          )}
          <span className="flex items-center gap-1"><Timer className="h-3 w-3" />{quoteAge(data.quote_status?.quote_age_ms)}</span>
          <span className={quoteRunning ? 'text-accent' : 'text-warning'}>{quoteRunning ? '实时' : '非实时'}</span>
          <button
            onClick={handleRefresh}
            disabled={manualFetching}
            className="inline-flex items-center gap-1 rounded-btn border border-border bg-elevated px-2 py-1 text-[11px] text-secondary transition-colors hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${manualFetching ? 'animate-spin' : ''}`} />刷新
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-2">
        {data.indices.map(item => <IndexTicker key={item.symbol} item={item} />)}
      </div>

      <div className="mb-3 grid grid-cols-6 gap-2">
        <KpiCell label="个股涨 / 平 / 跌" value={<><span className="text-bull">{data.breadth.up}</span><span className="text-muted">/</span><span className="text-muted">{data.breadth.flat}</span><span className="text-muted">/</span><span className="text-bear">{data.breadth.down}</span></>} sub={`上涨率 ${data.breadth.up_pct.toFixed(1)}%`} />
        <KpiCell label="强势 / 弱势" value={<><span className="text-bull">{strongUp}</span><span className="text-muted">/</span><span className="text-bear">{strongDown}</span></>} sub="涨跌 ≥3%" />
        <KpiCell label={<span className="inline-flex items-center gap-1">涨停 / 跌停<SealedBadge degraded={isSealedDegrade} hasDepth={hasDepth} isHistorical={false} sealedReady={sealedReady} sealedCountsUp={{ real: data.limit.limit_up, fake: data.limit.fake_up ?? 0, pending: 0 }} sealedCountsDown={{ real: data.limit.limit_down, fake: data.limit.fake_down ?? 0, pending: 0 }} rawUp={data.limit.limit_up + (data.limit.fake_up ?? 0)} rawDown={data.limit.limit_down + (data.limit.fake_down ?? 0)} invalidateKeys={['overview-market', 'limit-ladder']} /></span>} value={<><span className="text-bull">{data.limit.limit_up}</span><span className="text-muted">/</span><span className="text-bear">{data.limit.limit_down}</span></>} sub={`封板率 ${(data.limit.seal_rate ?? 0).toFixed(0)}%`} />
        <KpiCell label="最高连板" value={`${data.limit.max_boards || 0}板`} sub={`梯队 ${data.limit.tiers.length}`} tone="accent" />
        <KpiCell label="成交额" value={fmtBigNum(data.amount.total)} sub={`均额 ${fmtBigNum(data.amount.avg)}`} />
        <KpiCell label="换手 / 量比" value={`${fmtPrice(data.activity.avg_turnover, 1)}% / ${fmtPrice(data.activity.vol_ratio, 2)}`} sub={`高换手 ${data.activity.high_turnover} · 放量 ${data.activity.high_vol_ratio}`} tone="accent" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="min-w-0 space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <section className="rounded-card border border-border bg-surface/80 p-2.5">
              <SectionTitle icon={BarChart3} title="涨跌分布 / 广度" hint={`${data.breadth.total}只`} />
              <DistributionBars rows={data.distribution} />
              <div className="mt-2">
                <BreadthBar data={data.breadth} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <MiniMetric label="平均涨跌" value={fmtStockPct(data.breadth.avg_pct)} cls={pctClass(data.breadth.avg_pct)} />
                <MiniMetric label="中位涨跌" value={fmtStockPct(data.breadth.median_pct)} cls={pctClass(data.breadth.median_pct)} />
              </div>
            </section>

            <section
              className="rounded-card border bg-surface/80 p-2.5"
              style={{ borderColor: `${scoreColor(score)}40` }}
            >
              <SectionTitle icon={Sparkles} title="情绪雷达" hint={`情绪评分 ${score}`} />
              <EmotionRadar radar={data.radar} score={score} />
            </section>

            <section className="flex flex-col rounded-card border border-border bg-surface/80 p-2.5">
              <div>
                <SectionTitle icon={LineChart} title="趋势强度" hint="均线/新高低" />
                <div className="grid grid-cols-3 gap-1.5">
                  <MiniMetric label="站上MA5" value={`${data.trend.above_ma5_pct.toFixed(0)}%`} cls="text-accent" />
                  <MiniMetric label="站上MA20" value={`${data.trend.above_ma20_pct.toFixed(0)}%`} cls="text-accent" />
                  <MiniMetric label="站上MA60" value={`${data.trend.above_ma60_pct.toFixed(0)}%`} cls="text-accent" />
                  <MiniMetric label="60日新高" value={compactCount(data.trend.new_high)} cls="text-bull" />
                  <MiniMetric label="60日新低" value={compactCount(data.trend.new_low)} cls="text-bear" />
                  <MiniMetric label="高低比" value={`${data.trend.new_high + data.trend.new_low > 0 ? Math.round(data.trend.new_high / (data.trend.new_high + data.trend.new_low) * 100) : 50}%`} cls={data.trend.new_high >= data.trend.new_low ? 'text-bull' : 'text-bear'} />
                </div>
              </div>
              <div className="mt-3 border-t border-border pt-2.5">
                <SectionTitle icon={Target} title="实用监控" hint="盘中观察" />
                <div className="grid grid-cols-3 gap-1.5">
                  <MiniMetric label="炸板" value={`${data.limit.broken ?? 0}`} cls="text-warning" />
                  <MiniMetric label="跌停" value={`${data.limit.limit_down ?? 0}`} cls="text-bear" />
                  <MiniMetric label="站上MA60" value={`${data.trend.above_ma60_pct.toFixed(0)}%`} cls="text-accent" />
                  <MiniMetric label="新高/新低" value={`${compactCount(data.trend.new_high)}/${compactCount(data.trend.new_low)}`} cls={data.trend.new_high >= data.trend.new_low ? 'text-bull' : 'text-bear'} />
                  <MiniMetric label="高换手数" value={`${data.activity.high_turnover}`} cls="text-accent" />
                  <MiniMetric label="放量家数" value={`${data.activity.high_vol_ratio}`} cls="text-accent" />
                </div>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <HotRankCard title="概念热度" rank={data.concept_rank} configUrl="/concept-analysis" />
            <HotRankCard title="行业热度" rank={data.industry_rank} configUrl="/industry-analysis" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StockList title="涨幅榜" rows={data.top_gainers} mode="gain" />
            <StockList title="跌幅榜" rows={data.top_losers} mode="loss" />
            <StockList title="成交额榜" rows={data.turnover_leaders} mode="amount" />
            <StockList title="活跃换手" rows={data.active_leaders} mode="active" />
          </div>
        </main>

        <aside className="min-w-0 space-y-3">
          <section className="rounded-card border border-border bg-surface/80 p-3">
            <SectionTitle icon={Flame} title="涨停梯队" hint={<span className="inline-flex items-center gap-1">{`涨停 ${data.limit.limit_up}`}{isSealedDegrade && <span className="text-[9px] px-1 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-500">{hasDepth ? '未修正' : '降级'}</span>}</span>} />
            <LadderMini limit={data.limit} />
          </section>
          <section className="rounded-card border border-border bg-surface/80 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <BellRing className="h-3.5 w-3.5 text-accent" />
                <h2 className="text-xs font-semibold text-foreground">监控中心</h2>
                <span className="font-mono text-[10px] text-muted">实时信号</span>
              </div>
              <Link to="/monitor" className="inline-flex items-center justify-center h-5 w-5 rounded text-muted hover:text-accent hover:bg-accent/10 transition-colors" title="进入监控中心">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <MonitorWidget />
          </section>
        </aside>
      </div>
    </div>
  )
}
