import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, RefreshCw, Trash2, Zap } from 'lucide-react';
import { getPaperPositions, getPaperTrades, getPaperSummary, triggerPaperScan, clearPaperTrades } from '../services/api';
import type { PaperPosition, PaperTrade } from '../types';
import { Card } from './ui/Card';

const GREEN = 'text-green-400';
const RED   = 'text-red-400';
const DIM   = 'text-[var(--text-secondary)]';
const ROW   = 'border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors';

const pnlColor = (v: number) => (v > 0 ? GREEN : v < 0 ? RED : DIM);
const pnlText  = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

const PaperTradePanel: React.FC = () => {
  const qc = useQueryClient();

  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ['paper-summary'],
    queryFn: getPaperSummary,
    refetchInterval: 60_000,
  });

  const { data: positions = [] } = useQuery({
    queryKey: ['paper-positions'],
    queryFn: getPaperPositions,
    refetchInterval: 60_000,
  });

  const { data: trades = [] } = useQuery({
    queryKey: ['paper-trades'],
    queryFn: getPaperTrades,
    refetchInterval: 60_000,
  });

  const scanMut = useMutation({
    mutationFn: triggerPaperScan,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['paper-summary'] }); qc.invalidateQueries({ queryKey: ['paper-positions'] }); qc.invalidateQueries({ queryKey: ['paper-trades'] }); },
  });

  const clearMut = useMutation({
    mutationFn: clearPaperTrades,
    onSuccess: () => { qc.invalidateQueries(); },
  });

  return (
    <div className="space-y-4">
      {/* 標題列 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-green-400" />
          <h2 className="text-base font-semibold">模擬下單看板</h2>
          <span className="text-xs text-[var(--text-secondary)]">每 10 分鐘自動掃描（盤中 9:00~13:30）</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => scanMut.mutate()}
            disabled={scanMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-500 transition-colors disabled:opacity-50"
          >
            {scanMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            立即掃描
          </button>
          <button
            onClick={() => clearMut.mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> 重置
          </button>
        </div>
      </div>

      {/* 摘要卡 */}
      {!sumLoading && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '最後掃描', value: summary.last_scan ?? '-' },
            { label: '持倉數', value: String(summary.open_positions) },
            { label: '勝率', value: `${summary.win_count}/${summary.closed_trades}  (${summary.win_rate}%)` },
            { label: '累計損益', value: pnlText(summary.total_pnl_pct), color: pnlColor(summary.total_pnl_pct) },
          ].map((s) => (
            <div key={s.label} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-3">
              <p className="text-xs text-[var(--text-secondary)] mb-1">{s.label}</p>
              <p className={`text-sm font-bold ${s.color ?? 'text-[var(--text-primary)]'}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* 目前持倉 */}
        <Card title={'目前持倉 · ' + positions.length + ' 支'}>
          {positions.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)] py-6 text-center">目前無持倉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
                    {['代號', '名稱', '進場時間', '進場價', '現價', '損益%'].map((h) => (
                      <th key={h} className="text-left py-2 pr-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p: PaperPosition) => (
                    <tr key={p.stock_id} className={ROW}>
                      <td className="py-2 pr-3 font-medium text-[var(--accent)]">{p.stock_id}</td>
                      <td className="py-2 pr-3">{p.stock_name}</td>
                      <td className={`py-2 pr-3 ${DIM}`}>{p.entry_time}</td>
                      <td className="py-2 pr-3">{p.entry_price.toFixed(2)}</td>
                      <td className="py-2 pr-3">{p.current_price.toFixed(2)}</td>
                      <td className={`py-2 font-bold ${pnlColor(p.pnl_pct)}`}>{pnlText(p.pnl_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* 今日平倉紀錄 */}
        <Card title={'今日交易紀錄 · ' + trades.length + ' 筆'}>
          {trades.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)] py-6 text-center">今日尚無平倉紀錄</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
                    {['代號', '名稱', '進場', '出場', '損益%', '原因'].map((h) => (
                      <th key={h} className="text-left py-2 pr-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t: PaperTrade, i: number) => (
                    <tr key={i} className={ROW}>
                      <td className="py-2 pr-3 font-medium text-[var(--accent)]">{t.stock_id}</td>
                      <td className="py-2 pr-3">{t.stock_name}</td>
                      <td className={`py-2 pr-3 ${DIM}`}>{t.entry_time} @{t.entry_price.toFixed(2)}</td>
                      <td className={`py-2 pr-3 ${DIM}`}>{t.exit_time} @{t.exit_price.toFixed(2)}</td>
                      <td className={`py-2 pr-3 font-bold ${pnlColor(t.profit_loss)}`}>{pnlText(t.profit_loss)}</td>
                      <td className={`py-2 text-[0.65rem] ${DIM}`}>{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* 設定說明 */}
      <Card title="Telegram 推播設定">
        <div className="text-xs text-[var(--text-secondary)] space-y-2">
          <p>在 <code className="bg-[var(--bg-secondary)] px-1 rounded">backend/.env</code> 加入以下設定後重啟後端：</p>
          <pre className="bg-[var(--bg-secondary)] rounded p-3 text-[var(--text-primary)] leading-relaxed overflow-x-auto">
{`TELEGRAM_BOT_TOKEN=你的Bot Token
TELEGRAM_CHAT_ID=你的Chat ID

# 選填（預設值如下）
PAPER_STOP_LOSS=-3.0
PAPER_TAKE_PROFIT=6.0`}
          </pre>
          <p className="opacity-70">
            取得方式：Telegram 搜尋 <b>@BotFather</b> → /newbot 取得 Token；
            再搜尋 <b>@userinfobot</b> 取得你的 Chat ID。
          </p>
        </div>
      </Card>
    </div>
  );
};

export default PaperTradePanel;
