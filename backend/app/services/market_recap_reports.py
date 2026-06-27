"""AI 大盘复盘报告持久化存储。

与 stock_reports.py(个股分析报告)/ ai_reports.py(财务分析报告)完全独立 ——
单独的文件、字段、上限,互不影响。刻意不复用,避免引入 kind 判别字段与分支
(解耦 > 抽象)。

存储位置: data/user_data/ai_market_recaps.json (数组,按 created_at 降序)
保留最近 MAX_REPORTS 条;超出自动裁剪最旧的。

每条报告结构:
{
  "id": "mkr_xxx",            # 唯一 id(market-recap-report)
  "as_of": "2026-06-27",      # 复盘日期
  "focus": "",                # 用户追加的关心点(可为空)
  "content": "# ...markdown", # 报告正文
  "summary": "三大指数齐涨...",  # 一句话摘要
  "emotion_score": 68,        # 情绪分(0-100, 复盘生成时的市场情绪雷达均分)
  "emotion_label": "偏暖",     # 情绪标签(强势/偏暖/震荡/偏冷/冰点)
  "created_at": "2026-06-27T15:35:00"
}
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

MAX_REPORTS = 30


def _path() -> Path:
    from app.config import settings
    p = settings.data_dir / "user_data" / "ai_market_recaps.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def list_reports() -> list[dict]:
    """返回全部报告(按 created_at 降序)。"""
    p = _path()
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return sorted(data, key=lambda r: r.get("created_at", ""), reverse=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("ai_market_recaps.json malformed: %s", e)
    return []


def _save_all(reports: list[dict]) -> None:
    """全量写入(裁剪到 MAX_REPORTS)。"""
    reports.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    if len(reports) > MAX_REPORTS:
        reports = reports[:MAX_REPORTS]
    _path().write_text(
        json.dumps(reports, indent=2, ensure_ascii=False), encoding="utf-8",
    )


def save_report(report: dict) -> dict:
    """新增一条报告并持久化。返回保存后的报告(含 id / created_at)。"""
    reports = list_reports()
    if not report.get("id"):
        report["id"] = f"mkr_{int(time.time() * 1000)}"
    if not report.get("created_at"):
        report["created_at"] = _now_iso()
    reports.append(report)
    _save_all(reports)
    logger.info("Market recap saved: %s (as_of=%s), total %d",
                report.get("id"), report.get("as_of"), len(reports))
    return report


def delete_report(report_id: str) -> bool:
    """删除指定报告。返回是否删除成功。"""
    reports = list_reports()
    before = len(reports)
    reports = [r for r in reports if r.get("id") != report_id]
    if len(reports) < before:
        _save_all(reports)
        return True
    return False


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")
