/**
 * AI 大盘复盘页 —— 盘后复盘看板 + 流式 LLM 复盘报告 + 历史归档。
 *
 * 数据分工:
 *  - 顶部看板(指数/涨跌/连板/封板/情绪雷达)来自 GET /api/overview/market
 *  - 复盘报告(markdown)由 POST /api/market-recap/analyze 流式生成
 * 视觉语言对齐 Dashboard:A 股红涨绿跌、rounded-card 卡片、SectionTitle 层级。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  BookOpenCheck, RefreshCw, Sparkles, Trash2, History, ChevronRight, AlertTriangle,
  BarChart3, Activity, Layers, ArrowUpRight, ArrowDownRight, Database, Wand2,
} from 'lucide-react'

import { api, type OverviewMarket, type AiReviewReport } from '@/lib/api'
import { QK } from '@/lib/queryKeys'
import { cn } from '@/lib/cn'
import { fmtPrice } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { MarkdownRenderer } from '@/components/financials/MarkdownRenderer'
import { toast } from '@/components/Toast'

// ================================================================
// 涨跌幅格式化(注意单位差异)
// overview 的 indices.change_pct / breadth.up_pct / seal_rate / *_pct / emotion.score
//   都是【已是百分比值】(如 1.2 表示 1.2%),直接 toFixed 即可,不要 *100。
// ================================================================
function fmtPctAlready(v: number | null | undefined, digits = 2, withSign = false): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = withSign && v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}
function pctClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v) || v === 0) return 'text-muted'
  return v > 0 ? 'text-bull' : 'text-bear'
}
// A 股惯例: 强势=红, 弱式=绿(对齐 Dashboard scoreColor)
function scoreColor(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '#71717A'
  if (v >= 70) return '#F04438'
  if (v >= 55) return '#FB923C'
  if (v >= 45) return '#F59E0B'
  if (v >= 30) return '#84CC16'
  return '#12B76A'
}

type Phase = 'idle' | 'loading' | 'streaming' | 'done' | 'error'

export function Review() {
  const qc = useQueryClient()
  // 复盘日期:当前固定取最新交易日(后续如需日期选择可改回 useState)
  const asOf: string | undefined = undefined
  const [focus, setFocus] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<{ as_of?: string; emotion_score?: number; emotion_label?: string; summary?: string } | null>(null)
  const [viewing, setViewing] = useState<AiReviewReport | null>(null)  // 查看历史报告
  const abortRef = useRef<AbortController | null>(null)
  const reportEndRef = useRef<HTMLDivElement>(null)

  // 看板数据(与总览页同源)
  const marketQuery = useQuery<OverviewMarket>({
    queryKey: QK.overviewMarket(asOf),
    queryFn: () => api.overviewMarket(asOf),
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  })

  // 历史报告
  const historyQuery = useQuery<{ reports: AiReviewReport[] }>({
    queryKey: QK.reviewReports,
    queryFn: () => api.reviewReportsList(),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.reviewReportDelete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.reviewReports })
      toast('已删除', 'success')
    },
    onError: () => { /* request() 已 toast */ },
  })

  // 自动滚动到报告底部(streaming 时)
  useEffect(() => {
    if (phase === 'streaming') {
      reportEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [content, phase])

  // 主流程:生成复盘
  const generate = useCallback(async () => {
    if (phase === 'loading' || phase === 'streaming') return
    setViewing(null)
    setPhase('loading')
    setContent('')
    setError('')
    setMeta(null)

    const ctrl = new AbortController()
    abortRef.current = ctrl
    let buf = ''
    let failed = false
    try {
      for await (const evt of api.reviewStream(asOf, focus)) {
        if (ctrl.signal.aborted) break
        if (evt.type === 'meta') {
          setMeta(evt)
        } else if (evt.type === 'delta' && evt.content) {
          buf += evt.content
          setContent(buf)
          setPhase('streaming')
        } else if (evt.type === 'error') {
          failed = true
          setError(evt.message ?? '复盘失败')
          setPhase('error')
          return
        } else if (evt.type === 'done') {
          setPhase('done')
        }
      }
      // 流正常结束但无 done 事件,按 done 处理
      if (buf && !failed) setPhase('done')
    } catch (e: any) {
      if (!ctrl.signal.aborted) {
        setError(e?.message ?? '复盘失败')
        setPhase('error')
      }
    } finally {
      abortRef.current = null
    }
  }, [asOf, focus, phase])

  // 保存当前报告
  const saveCurrent = useCallback(async () => {
    if (!content) return
    const reportAsOf = meta?.as_of ?? marketQuery.data?.as_of ?? asOf ?? new Date().toISOString().slice(0, 10)
    try {
      await api.reviewReportSave({
        as_of: reportAsOf,
        focus,
        content,
        summary: meta?.summary,
        emotion_score: meta?.emotion_score ?? null,
        emotion_label: meta?.emotion_label ?? '',
      })
      qc.invalidateQueries({ queryKey: QK.reviewReports })
      toast('复盘已归档', 'success')
    } catch { /* request() 已 toast */ }
  }, [content, meta, asOf, focus, marketQuery.data, qc])

  // 查看历史报告
  const viewReport = useCallback((r: AiReviewReport) => {
    abortRef.current?.abort()
    setViewing(r)
    setContent(r.content)
    setMeta({ as_of: r.as_of, emotion_score: r.emotion_score ?? undefined, emotion_label: r.emotion_label, summary: r.summary })
    setPhase('done')
    setError('')
  }, [])

  const isGenerating = phase === 'loading' || phase === 'streaming'
  const displayDate = viewing?.as_of ?? meta?.as_of ?? marketQuery.data?.as_of ?? asOf ?? '最新'
  const data = marketQuery.data

  return (
    <>
      <PageHeader
        title="AI 复盘"
        titleExtra={<Sparkles className="h-4 w-4 text-accent" />}
        subtitle={`${displayDate}${data?.emotion ? ` · 情绪 ${data.emotion.label}` : ''}`}
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={() => { marketQuery.refetch() }}
              disabled={marketQuery.isFetching}
              className="inline-flex items-center gap-1 rounded-btn border border-border bg-elevated px-2 py-1 text-[11px] text-secondary transition-colors hover:text-foreground disabled:opacity-50"
              title="刷新看板数据"
            >
              <RefreshCw className={cn('h-3 w-3', marketQuery.isFetching && 'animate-spin')} />刷新
            </button>
            <button
              onClick={generate}
              disabled={isGenerating}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-btn px-3.5 py-1.5 text-xs font-medium transition-all',
                isGenerating
                  ? 'border border-accent/40 bg-accent/10 text-accent cursor-not-allowed'
                  : 'bg-accent text-white shadow-sm shadow-accent/25 hover:bg-accent/90 hover:shadow hover:shadow-accent/30',
              )}
            >
              {isGenerating ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin" />生成中…</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5" />生成复盘</>
              )}
            </button>
          </div>
        }
      />

      <div className="min-h-full bg-[radial-gradient(circle_at_15%_-5%,rgba(59,130,246,0.10),transparent_30%),radial-gradient(circle_at_85%_5%,rgba(139,92,246,0.08),transparent_30%)] px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-[1440px] space-y-4">

          {marketQuery.isLoading && !data ? (
            <div className="flex h-40 items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-muted">
                <RefreshCw className="h-4 w-4 animate-spin" /> 加载市场数据…
              </div>
            </div>
          ) : !data || !data.as_of ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-card border border-border bg-surface/80 px-6 py-16">
              <div className="relative">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-accent/20 to-purple-500/15 border border-accent/30">
                  <Database className="h-6 w-6 text-accent" strokeWidth={1.8} />
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-foreground">暂无市场数据</div>
                <p className="mt-1 text-xs text-muted">复盘需要日 K 与指数,请先前往「数据」页同步</p>
              </div>
              <Link
                to="/data"
                className="inline-flex items-center gap-1.5 rounded-btn bg-accent px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-accent/90 hover:shadow"
              >
                <Database className="h-3.5 w-3.5" />前往数据页同步
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <>
              {/* ===== 指数行情条(对齐 Dashboard IndexTicker) ===== */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.indices.map(item => <IndexTicker key={item.symbol} item={item} />)}
              </div>

              {/* ===== KPI 网格 ===== */}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                <KpiCell label="涨 / 平 / 跌" value={<><span className="text-bull">{data.breadth.up}</span><span className="text-muted">/</span><span className="text-muted">{data.breadth.flat}</span><span className="text-muted">/</span><span className="text-bear">{data.breadth.down}</span></>} sub={`上涨率 ${data.breadth.up_pct.toFixed(1)}%`} />
                <KpiCell label="涨停 / 跌停" value={<><span className="text-bull">{data.limit.limit_up}</span><span className="text-muted">/</span><span className="text-bear">{data.limit.limit_down}</span></>} sub={`封板率 ${(data.limit.seal_rate ?? 0).toFixed(0)}% · 炸板 ${data.limit.broken ?? 0}`} />
                <KpiCell label="最高连板" value={`${data.limit.max_boards || 0}板`} sub={`梯队 ${data.limit.tiers.length}档`} tone="accent" />
                <KpiCell label="两市成交" value={`${((data.amount.total ?? 0) / 1e8).toFixed(0)}亿`} sub={`均额 ${((data.amount.avg ?? 0) / 1e8).toFixed(1)}亿`} />
                <KpiCell label="换手 / 量比" value={`${fmtPrice(data.activity.avg_turnover, 1)}% / ${fmtPrice(data.activity.vol_ratio, 2)}`} sub={`高换手 ${data.activity.high_turnover}`} tone="accent" />
                <KpiCell label="MA5 / 20 / 60" value={`${data.trend.above_ma5_pct.toFixed(0)}%`} sub={`${data.trend.above_ma20_pct.toFixed(0)}% / ${data.trend.above_ma60_pct.toFixed(0)}%`} />
              </div>

              {/* ===== 情绪雷达 + 板块排名 双栏 ===== */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <EmotionSection data={data} />
                <SectorSection title="概念板块" rank={data.concept_rank} tone="concept" />
                <SectorSection title="行业板块" rank={data.industry_rank} tone="industry" />
              </div>

              {/* ===== 关注点输入 ===== */}
              <div className="flex items-center gap-2 rounded-card border border-border bg-surface/80 px-3.5 py-2.5 transition-colors focus-within:border-accent/40">
                <Wand2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                <input
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !isGenerating) generate() }}
                  placeholder="可选:补充复盘关注点,如「明日是否加仓半导体」「量能是否持续」"
                  className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted/60"
                />
                {focus && (
                  <button onClick={() => setFocus('')} className="text-xs text-muted transition-colors hover:text-foreground">清除</button>
                )}
              </div>

              {/* ===== 报告 + 历史 双栏 ===== */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_18rem]">
                <ReportPanel
                  phase={phase}
                  content={content}
                  error={error}
                  isGenerating={isGenerating}
                  viewing={viewing}
                  onSave={saveCurrent}
                  onRegenerate={generate}
                  reportEndRef={reportEndRef}
                />
                <HistoryPanel
                  reports={historyQuery.data?.reports ?? []}
                  loading={historyQuery.isLoading}
                  viewingId={viewing?.id ?? null}
                  onView={viewReport}
                  onDelete={(id) => deleteMut.mutate(id)}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ================================================================
// 指数行情卡(对齐 Dashboard IndexTicker)
// ================================================================
function IndexTicker({ item }: { item: OverviewMarket['indices'][number] }) {
  const pct = item.change_pct
  const isUp = (pct ?? 0) >= 0
  return (
    <div className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5 rounded-card border border-border bg-surface/80 px-3 py-2 transition-colors hover:border-accent/40">
      <div className="truncate text-xs font-medium text-foreground">{item.name || item.symbol}</div>
      <div className={cn('font-mono text-xs font-semibold tabular-nums', pctClass(pct))}>{fmtPctAlready(pct, 2, true)}</div>
      <div className="font-mono text-[10px] text-muted">{item.symbol}</div>
      <div className={cn('flex items-center gap-0.5 font-mono text-[11px] tabular-nums', pctClass(pct))}>
        {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        {fmtPrice(item.last_price)}
      </div>
    </div>
  )
}

// ================================================================
// KPI 单元(对齐 Dashboard KpiCell)
// ================================================================
function KpiCell({ label, value, sub, tone }: {
  label: React.ReactNode
  value: React.ReactNode
  sub?: string
  tone?: 'bull' | 'bear' | 'accent'
}) {
  const isPlain = typeof value === 'string' || typeof value === 'number'
  const color = tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : tone === 'accent' ? 'text-accent' : 'text-foreground'
  return (
    <div className="min-w-0 rounded-card border border-border bg-surface/80 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted">{label}</div>
      <div className={cn('mt-1 truncate font-mono text-base font-semibold leading-none tabular-nums', isPlain ? color : 'text-foreground')}>{value}</div>
      {sub && <div className="mt-1 truncate text-[10px] text-muted">{sub}</div>}
    </div>
  )
}

// ================================================================
// 章节标题(对齐 Dashboard SectionTitle)
// ================================================================
function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Activity; title: string; hint?: React.ReactNode }) {
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

// ================================================================
// 情绪雷达章节(SVG 雷达图,对齐 Dashboard EmotionRadar)
// ================================================================
function EmotionSection({ data }: { data: OverviewMarket }) {
  const score = data.emotion.score
  const color = scoreColor(score)
  const radar = data.radar ?? []
  const size = 220
  const cx = size / 2
  const cy = size / 2
  const maxR = 68

  const points = radar.map((r, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / radar.length
    const radius = maxR * Math.max(0, Math.min(100, r.value)) / 100
    return {
      ...r,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      lx: cx + Math.cos(angle) * (maxR + 24),
      ly: cy + Math.sin(angle) * (maxR + 24),
      gx: cx + Math.cos(angle) * maxR,
      gy: cy + Math.sin(angle) * maxR,
    }
  })
  const polygon = points.map(p => `${p.x},${p.y}`).join(' ')
  const gridPolygons = [1, 0.66, 0.33].map((level, idx) => ({
    level, idx,
    points: radar.map((_, i) => {
      const angle = -Math.PI / 2 + i * 2 * Math.PI / radar.length
      return `${cx + Math.cos(angle) * maxR * level},${cy + Math.sin(angle) * maxR * level}`
    }).join(' '),
  }))

  return (
    <section
      className="rounded-card border bg-surface/80 p-3"
      style={{ borderColor: `${color}40` }}
    >
      <SectionTitle icon={Sparkles} title="情绪雷达" hint={`评分 ${score} · ${data.emotion.label}`} />
      {radar.length === 0 ? (
        <div className="flex h-44 items-center justify-center text-xs text-muted">暂无雷达数据</div>
      ) : (
        <div className="flex justify-center">
          <svg viewBox={`0 0 ${size} ${size}`} className="h-52 w-full">
            <defs>
              <radialGradient id="reviewRadarFill" cx="50%" cy="45%" r="70%">
                <stop offset="0%" stopColor={`${color}57`} />
                <stop offset="100%" stopColor={`${color}1f`} />
              </radialGradient>
              <radialGradient id="reviewRadarCenter" cx="50%" cy="50%" r="55%">
                <stop offset="0%" stopColor="rgba(24,24,27,0.92)" />
                <stop offset="68%" stopColor="rgba(24,24,27,0.70)" />
                <stop offset="100%" stopColor="rgba(24,24,27,0)" />
              </radialGradient>
            </defs>
            {gridPolygons.map(g => (
              <polygon
                key={g.level}
                points={g.points}
                fill={g.idx % 2 === 0 ? 'rgba(33,33,38,0.26)' : 'rgba(24,24,27,0.16)'}
                stroke={g.level === 1 ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.12)'}
                strokeWidth={g.level === 1 ? 1.2 : 0.8}
              />
            ))}
            {points.map(p => <line key={p.key} x1={cx} y1={cy} x2={p.gx} y2={p.gy} stroke="rgba(148,163,184,0.08)" />)}
            <polygon points={polygon} fill="url(#reviewRadarFill)" stroke={color} strokeWidth="2" />
            {points.map(p => <circle key={p.key} cx={p.x} cy={p.y} r="2.8" fill={color} stroke="rgba(24,24,27,0.9)" strokeWidth="1" />)}
            <circle cx={cx} cy={cy} r="26" fill="url(#reviewRadarCenter)" />
            <text x={cx} y={cy + 6} textAnchor="middle" className="fill-foreground font-mono text-[22px] font-bold">{score}</text>
            {points.map(p => (
              <text key={`${p.key}-label`} x={p.lx} y={p.ly + 4} textAnchor="middle" className="fill-secondary text-[9px] font-medium">{p.label}</text>
            ))}
          </svg>
        </div>
      )}
    </section>
  )
}

// ================================================================
// 板块排名章节(领涨/领跌)
// ================================================================
function SectorSection({ title, rank, tone }: {
  title: string
  rank: OverviewMarket['concept_rank'] | OverviewMarket['industry_rank']
  tone: 'concept' | 'industry'
}) {
  const leading = rank?.leading ?? []
  const lagging = rank?.lagging ?? []
  const hasData = leading.length > 0 || lagging.length > 0
  return (
    <section className="rounded-card border border-border bg-surface/80 p-3">
      <SectionTitle icon={tone === 'concept' ? Layers : BarChart3} title={title} hint="领涨/领跌" />
      {!hasData ? (
        <div className="py-6 text-center text-[11px] text-muted">暂无数据</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <RankColumn rows={leading} tone="bull" />
          <RankColumn rows={lagging} tone="bear" />
        </div>
      )}
    </section>
  )
}

function RankColumn({ rows, tone }: { rows: OverviewMarket['concept_rank']['leading']; tone: 'bull' | 'bear' }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className={cn('text-[10px] font-medium', tone === 'bull' ? 'text-bull' : 'text-bear')}>
        {tone === 'bull' ? '领涨' : '领跌'}
      </div>
      {rows.slice(0, 5).map((r, idx) => (
        <div key={`${r.name}-${idx}`} className="grid grid-cols-[14px_1fr_auto] items-center gap-1 rounded bg-elevated/40 px-1.5 py-1">
          <span className="text-center font-mono text-[9px] text-muted">{idx + 1}</span>
          <div className="min-w-0">
            <div className="truncate text-[11px] text-foreground" title={r.name}>{r.name}</div>
            <div className="truncate text-[9px] text-muted">{r.count}只 · {r.leader?.name ?? '—'}</div>
          </div>
          <div className={cn('font-mono text-[10px] font-semibold tabular-nums', pctClass(r.avg_pct))}>
            {fmtPctAlready((r.avg_pct ?? 0) * 100, 2, true)}
          </div>
        </div>
      ))}
      {rows.length === 0 && <div className="rounded border border-dashed border-border py-3 text-center text-[10px] text-muted">—</div>}
    </div>
  )
}

// ================================================================
// 报告面板(流式 + 错误 + 历史/完成态)
// ================================================================
function ReportPanel({
  phase, content, error, isGenerating, viewing, onSave, onRegenerate, reportEndRef,
}: {
  phase: Phase
  content: string
  error: string
  isGenerating: boolean
  viewing: AiReviewReport | null
  onSave: () => void
  onRegenerate: () => void
  reportEndRef: React.RefObject<HTMLDivElement>
}) {
  if (phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-border bg-surface/80 px-6 py-14">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-danger/10">
          <AlertTriangle className="h-5 w-5 text-danger" />
        </div>
        <div className="text-sm font-medium text-foreground">复盘失败</div>
        <div className="max-w-md text-center text-xs text-secondary">{error || '请检查 AI 配置后重试'}</div>
        <button
          onClick={onRegenerate}
          className="mt-1 inline-flex items-center gap-1.5 rounded-btn bg-accent/15 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent/20"
        >
          <RefreshCw className="h-3.5 w-3.5" />重新生成
        </button>
      </div>
    )
  }

  if (phase === 'idle' && !content) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center gap-4 rounded-card border border-border bg-surface/80 px-6 py-12">
        <div className="relative">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-accent/20 to-purple-500/15 border border-accent/30">
            <BookOpenCheck className="h-7 w-7 text-accent" strokeWidth={1.8} />
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-foreground">AI 大盘复盘</div>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted">
            点击右上角「生成复盘」,基于今日指数结构、涨跌家数、连板梯队、板块轮动与情绪雷达,
            生成可直接指导次日仓位与节奏的盘后复盘报告。
          </p>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <Sparkles className="h-3 w-3 text-accent" />
          七节结构化报告 · 一键归档 · 历史回看
        </div>
      </div>
    )
  }

  const showCursor = isGenerating
  const showSave = phase === 'done' && !!content && !viewing
  const showViewingTag = !!viewing
  const isLoading = phase === 'loading' && !content

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="overflow-hidden rounded-card border border-border bg-surface/80"
    >
      <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-accent/5 to-transparent px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {isGenerating ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" /> : <BookOpenCheck className="h-3.5 w-3.5 text-accent" />}
          <span className="text-xs font-medium text-foreground">
            {showViewingTag ? `历史复盘 · ${viewing!.as_of}` : isGenerating ? 'AI 正在复盘…' : '复盘报告'}
          </span>
        </div>
        {showSave && (
          <button onClick={onSave} className="inline-flex items-center gap-1 rounded-btn bg-accent/10 px-2 py-1 text-[11px] text-accent transition-colors hover:bg-accent/20">
            <History className="h-3 w-3" />归档
          </button>
        )}
      </div>
      <div className="max-h-[calc(100vh-26rem)] overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <div className="relative">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-accent/20 to-purple-500/15 border border-accent/30">
                <Sparkles className="h-5 w-5 animate-pulse text-accent" />
              </div>
              <RefreshCw className="absolute -inset-1 h-13 w-13 animate-spin text-accent/30" style={{ animationDuration: '3s' }} />
            </div>
            <div className="text-xs text-secondary">AI 正在分析今日盘面…</div>
            <div className="text-[10px] text-muted">读取指数结构 · 涨跌家数 · 连板梯队 · 板块轮动 · 情绪雷达</div>
          </div>
        ) : (
          <div className="prose prose-invert max-w-none">
            <MarkdownRenderer content={content} />
            {showCursor && (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />
            )}
          </div>
        )}
        <div ref={reportEndRef} />
      </div>
    </motion.div>
  )
}

// ================================================================
// 历史面板
// ================================================================
function HistoryPanel({
  reports, loading, viewingId, onView, onDelete,
}: {
  reports: AiReviewReport[]
  loading: boolean
  viewingId: string | null
  onView: (r: AiReviewReport) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface/80">
      <div className="flex items-center gap-1.5 border-b border-border bg-gradient-to-r from-accent/5 to-transparent px-3 py-2.5">
        <History className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-medium text-foreground">历史复盘</span>
        <span className="font-mono text-[10px] text-muted">({reports.length})</span>
      </div>
      <div className="max-h-[calc(100vh-26rem)] overflow-y-auto p-2">
        {loading ? (
          <div className="grid h-20 place-items-center"><RefreshCw className="h-4 w-4 animate-spin text-muted" /></div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-10 text-center">
            <History className="h-7 w-7 text-muted/40" strokeWidth={1.5} />
            <div className="text-[11px] text-muted">暂无历史复盘</div>
            <div className="text-[10px] text-muted/60">生成后点「归档」即可保存</div>
          </div>
        ) : (
          <div className="space-y-1">
            {reports.map((r) => {
              const color = scoreColor(r.emotion_score)
              return (
                <div
                  key={r.id}
                  className={cn(
                    'group flex items-center gap-2 rounded px-2 py-2 cursor-pointer transition-colors',
                    viewingId === r.id ? 'bg-accent/10 ring-1 ring-accent/20' : 'hover:bg-elevated/60',
                  )}
                  onClick={() => onView(r)}
                >
                  <div
                    className="grid h-8 w-8 shrink-0 place-items-center rounded font-mono text-[10px] font-bold tabular-nums"
                    style={{ color, backgroundColor: `${color}1a` }}
                  >
                    {r.emotion_score ?? '—'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-medium text-foreground">{r.emotion_label ?? '—'}</span>
                      <span className="font-mono text-[10px] text-muted">{r.as_of}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted">
                      {r.summary ?? r.content.slice(0, 40)}
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(r.id) }}
                    className="shrink-0 p-1 text-muted opacity-0 transition-all hover:text-bear group-hover:opacity-100"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
