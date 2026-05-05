"""
模擬下單 API 路由
提供前端查詢持倉、歷史交易、今日損益摘要
"""
from fastapi import APIRouter
from app.services import paper_trade_service as pts

router = APIRouter()


@router.get("/positions")
async def get_positions():
    """取得目前持倉列表"""
    return pts.get_positions()


@router.get("/trades")
async def get_trades():
    """取得今日已平倉紀錄"""
    return pts.get_closed_trades()


@router.get("/summary")
async def get_summary():
    """取得今日損益摘要"""
    return pts.get_summary()


@router.post("/clear")
async def clear():
    """手動重置（換日或測試用）"""
    pts.clear_today()
    return {"ok": True}


@router.post("/scan")
async def manual_scan():
    """手動觸發一次掃描（測試用）"""
    from datetime import datetime
    await pts.run_scan()
    return {"ok": True, "time": datetime.now().strftime("%H:%M:%S")}
