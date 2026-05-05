"""
股票自動選股系統 - Backend Entry Point
整合基本面、技術面、籌碼面分析
"""
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.api import stocks, screener, backtest, paper_trade

scheduler = AsyncIOScheduler(timezone="Asia/Taipei")

@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.paper_trade_service import run_scan
    # 每 10 分鐘掃描一次（盤中 9:00~13:30，服務內部自行判斷）
    scheduler.add_job(run_scan, "interval", minutes=10, id="paper_trade_scan")
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(
    title="智能選股系統 API",
    description="整合基本面、技術面、籌碼面的自動選股系統",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks.router,      prefix="/api/stocks",      tags=["股票資料"])
app.include_router(screener.router,    prefix="/api/screener",    tags=["選股篩選"])
app.include_router(backtest.router,    prefix="/api/backtest",    tags=["策略回測"])
app.include_router(paper_trade.router, prefix="/api/paper-trade", tags=["模擬下單"])


@app.get("/")
async def root():
    return {"message": "智能選股系統 API 運行中", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}
