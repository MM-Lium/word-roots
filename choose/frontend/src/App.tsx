import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BarChart2, Filter, TrendingUp, Activity } from 'lucide-react';
import StockSearch from './components/StockSearch';
import StockDetail from './components/StockDetail';
import StockScreener from './components/StockScreener';
import BacktestPanel from './components/BacktestPanel';
import PaperTradePanel from './components/PaperTradePanel';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1000 * 60 * 5 },
  },
});

type PageKey = 'detail' | 'screener' | 'backtest' | 'paper';

const App: React.FC = () => {
  const [page, setPage] = useState<PageKey>('screener');
  const [selectedStock, setSelectedStock] = useState<string>('');

  const handleSelectStock = (stockId: string) => {
    setSelectedStock(stockId);
    setPage('detail');
  };

  const navItems: { key: PageKey; label: string; icon: React.ReactNode }[] = [
    { key: 'screener', label: '智能選股', icon: <Filter className="w-4 h-4" /> },
    { key: 'detail', label: '個股分析', icon: <BarChart2 className="w-4 h-4" /> },
    { key: 'backtest', label: '策略回測', icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'paper', label: '模擬下單', icon: <Activity className="w-4 h-4" /> },
  ];

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <header className="sticky top-0 z-40 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
          <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-4">
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-sm hidden sm:block">智能選股系統</span>
            </div>
            <nav className="flex gap-1">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setPage(item.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    page === item.key
                      ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                  }`}
                >
                  {item.icon}
                  <span className="hidden sm:block">{item.label}</span>
                </button>
              ))}
            </nav>
            {page === 'detail' && (
              <div className="flex-1 max-w-xs ml-auto">
                <StockSearch
                  value={selectedStock}
                  onChange={(id) => setSelectedStock(id)}
                  placeholder="搜尋股票..."
                />
              </div>
            )}
          </div>
        </header>
        <main className="max-w-screen-2xl mx-auto px-4 py-5">
          {page === 'screener' && <StockScreener onSelectStock={handleSelectStock} />}
          {page === 'detail' && <StockDetail stockId={selectedStock} />}
          {page === 'backtest' && <BacktestPanel />}
          {page === 'paper' && <PaperTradePanel />}
        </main>
      </div>
    </QueryClientProvider>
  );
};

export default App;
