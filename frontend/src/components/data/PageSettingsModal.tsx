import { useState } from 'react'
import { Check } from 'lucide-react'
import { storage } from '@/lib/storage'

export type CardKey =
  | 'instruments' | 'daily' | 'adj_factor' | 'enriched'
  | 'index' | 'etf' | 'minute' | 'financials'

interface CardDef {
  key: CardKey
  label: string
  desc: string
  /** 档位能力不足时该卡片是否默认隐藏(减少干扰) */
  defaultHiddenIfNoCap: boolean
}

/** 数据画像卡片定义 —— 顺序即弹窗展示顺序 */
export const DATA_CARD_DEFS: CardDef[] = [
  { key: 'instruments', label: '个股维表', desc: 'A 股股票元数据', defaultHiddenIfNoCap: false },
  { key: 'daily',       label: '日 K',     desc: 'A 股日K线数据',          defaultHiddenIfNoCap: false },
  { key: 'enriched',    label: 'Enriched', desc: '技术指标计算结果',       defaultHiddenIfNoCap: false },
  { key: 'index',       label: '指数',     desc: '主要市场指数日K',        defaultHiddenIfNoCap: false },
  { key: 'etf',         label: 'ETF',      desc: '场内交易基金日K',         defaultHiddenIfNoCap: false },
  { key: 'adj_factor',  label: '除权因子', desc: '复权计算因子',           defaultHiddenIfNoCap: true },
  { key: 'minute',      label: '分钟 K',   desc: '分钟级K线(需 Pro+)',     defaultHiddenIfNoCap: true },
  { key: 'financials',  label: '财务数据', desc: '财报数据(需 Expert)',    defaultHiddenIfNoCap: true },
]

const CAP_KEY_MAP: Partial<Record<CardKey, string>> = {
  adj_factor: 'adj_factor',
  minute: 'kline.minute.batch',
  financials: 'financial',
}

/**
 * 读取卡片显隐状态。结合档位能力决定默认值:
 * - 用户显式设置过 → 用设置值
 * - 未设置 + defaultHiddenIfNoCap + 当前无能力 → 隐藏
 * - 其他 → 显示
 */
export function getCardVisibility(
  caps: Record<string, unknown> | undefined,
): Record<string, boolean> {
  const has = (capKey: string) => !capKey || !!caps?.[capKey]
  const override = storage.dataCardVisible.get({})
  const result: Record<string, boolean> = {}
  for (const def of DATA_CARD_DEFS) {
    if (def.key in override) {
      result[def.key] = override[def.key]
    } else {
      result[def.key] = def.defaultHiddenIfNoCap ? has(CAP_KEY_MAP[def.key] ?? '') : true
    }
  }
  return result
}

export function PageSettingsModal({
  caps,
}: {
  caps: Record<string, unknown> | undefined
}) {
  const [visible, setVisible] = useState<Record<string, boolean>>(() => getCardVisibility(caps))

  const toggle = (key: CardKey) => {
    const next = { ...visible, [key]: !visible[key] }
    setVisible(next)
    storage.dataCardVisible.set(next)
    window.dispatchEvent(new CustomEvent('data-card-visible-change'))
  }

  const reset = () => {
    storage.dataCardVisible.set({})
    setVisible(getCardVisibility(caps))
    window.dispatchEvent(new CustomEvent('data-card-visible-change'))
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-secondary leading-relaxed">
        勾选要在数据画像区显示的卡片。未勾选的卡片将隐藏,不影响数据本身。
      </p>
      <div className="space-y-1.5">
        {DATA_CARD_DEFS.map((def) => {
          const on = visible[def.key] ?? true
          return (
            <label
              key={def.key}
              className={`flex items-center gap-2.5 rounded-card border px-3 py-2 cursor-pointer transition-colors ${
                on ? 'border-accent/40 bg-accent/[0.05]' : 'border-border bg-base/30 hover:border-border/70'
              }`}
            >
              <button
                type="button"
                onClick={() => toggle(def.key)}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  on ? 'bg-accent border-accent' : 'bg-base border-border'
                }`}
                role="checkbox"
                aria-checked={on}
              >
                {on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground">{def.label}</div>
                <div className="text-[10px] text-muted leading-snug">{def.desc}</div>
              </div>
            </label>
          )
        })}
      </div>
      <div className="flex items-center justify-end pt-1">
        <button
          onClick={reset}
          className="px-2 py-0.5 rounded-btn text-[10px] text-secondary hover:text-foreground transition-colors"
        >
          恢复默认
        </button>
      </div>
    </div>
  )
}
