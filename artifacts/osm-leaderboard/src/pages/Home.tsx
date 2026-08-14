import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Leaderboard } from '@/components/Leaderboard';
import { PeriodTabs } from '@/components/PeriodTabs';
import { Period, UserStats } from '@/types';
import { RefreshCw, Map as MapIcon, X, Download, Play, Square, TrendingUp } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn, pad2, formatFileTimestamp } from '@/lib/utils';

const MapPanel = lazy(() => import('@/components/MapPanel').then((m) => ({ default: m.MapPanel })));
const GrowthChart = lazy(() => import('@/components/GrowthChart').then((m) => ({ default: m.GrowthChart })));

const VERSION = 'v1.9.0';

// Dwell time per stop while touring: 3s matches MapPanel's flyTo duration,
// plus ~2s to actually look at the marker before moving on.
const TOUR_INTERVAL_MS = 5000;

const PERIOD_PARAM: Record<string, Period> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  alltime: 'All Time',
  'all-time': 'All Time',
};

function getPeriodFromURL(): Period {
  const p = new URLSearchParams(window.location.search).get('period') ?? '';
  return PERIOD_PARAM[p.toLowerCase()] ?? 'Weekly';
}

function periodToParam(period: Period): string {
  return period.toLowerCase().replace(' ', '');
}

function buildLogContent(users: UserStats[], period: Period, now: Date): string {
  const dateStr = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const sep = '─'.repeat(76);

  const header = [
    `OSM LEADERBOARD ${VERSION}`,
    `Generated : ${dateStr}`,
    `Period    : ${period}`,
    `Users     : ${users.length}`,
    sep,
    `${'Rank'.padStart(4)}  ${'Username'.padEnd(26)}  ${'Score'.padStart(7)}  ${'Changes'.padStart(7)}  ${'Buildings'.padStart(9)}  ${'Wheelchair'.padStart(10)}  ${'Hashtags'.padStart(8)}  Last Active (UTC)`,
    sep,
  ];

  const rows = users.map(u => {
    const lastActive = u.lastChangeset
      ? u.lastChangeset.createdAt.toISOString().replace('T', ' ').slice(0, 19)
      : '-';
    return [
      String(u.rank).padStart(4),
      u.username.padEnd(26),
      String(u.score).padStart(7),
      String(u.totalChanges).padStart(7),
      String(u.buildingsAdded).padStart(9),
      String(u.wheelchairMapped).padStart(10),
      String(u.hashtagChangesets).padStart(8),
      lastActive,
    ].join('  ');
  });

  const changesets: string[] = [sep, '', 'Last Edit Changesets:', ''];
  for (const u of users) {
    if (u.lastChangeset) {
      const ts = u.lastChangeset.createdAt.toISOString().replace('T', ' ').slice(0, 19);
      const bbox = u.lastChangeset.bbox
        ? ` bbox:[${u.lastChangeset.bbox.minLat.toFixed(4)},${u.lastChangeset.bbox.minLon.toFixed(4)},${u.lastChangeset.bbox.maxLat.toFixed(4)},${u.lastChangeset.bbox.maxLon.toFixed(4)}]`
        : '';
      changesets.push(`  #${u.lastChangeset.id}  ${u.username.padEnd(26)}  ${ts}  "${u.lastChangeset.comment}"${bbox}`);
    }
  }
  changesets.push('', sep, '');

  return [...header, ...rows, ...changesets].join('\n');
}

function downloadLog(users: UserStats[], period: Period): void {
  const now = new Date();
  const filename = `OSMLB_${formatFileTimestamp(now)}.log`;
  const content = buildLogContent(users, period, now);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [period, setPeriod] = useState<Period>(getPeriodFromURL);
  const [focusedUser, setFocusedUser] = useState<UserStats | undefined>();
  const [isMapOpenMobile, setIsMapOpenMobile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [leaderboardSnapshot, setLeaderboardSnapshot] = useState<{ users: UserStats[]; period: Period } | null>(null);
  const [isTouring, setIsTouring] = useState(false);
  const [isGrowthChartOpen, setIsGrowthChartOpen] = useState(false);
  const queryClient = useQueryClient();

  // Tour state lives in refs, not React state: the tick interval reads the
  // latest tourable-user list without restarting every time leaderboardSnapshot
  // updates mid-load (which would otherwise re-fly to the same stop repeatedly
  // instead of smoothly advancing on a fixed interval).
  const tourableUsersRef = useRef<UserStats[]>([]);
  const tourIndexRef = useRef(0);

  // Keep URL in sync with selected period
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('period', periodToParam(period));
    window.history.replaceState(null, '', url.toString());
  }, [period]);

  // Switching periods invalidates whatever tour was in progress.
  useEffect(() => {
    setIsTouring(false);
  }, [period]);

  useEffect(() => {
    tourableUsersRef.current = leaderboardSnapshot?.users.filter(u => u.lastChangeset?.bbox) ?? [];
  }, [leaderboardSnapshot]);

  useEffect(() => {
    if (!isTouring) return;

    const tick = () => {
      const users = tourableUsersRef.current;
      if (users.length === 0) return;
      const idx = tourIndexRef.current % users.length;
      setFocusedUser(users[idx]);
      setIsMapOpenMobile(true);
      tourIndexRef.current = idx + 1;
    };

    tick(); // jump to the first stop immediately, then advance on an interval
    const id = setInterval(tick, TOUR_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isTouring]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['userStats'] });
  };

  const handleViewMap = (stats: UserStats) => {
    setIsTouring(false); // a manual pick interrupts an in-progress tour
    setFocusedUser(stats);
    setIsMapOpenMobile(true);
  };

  const handleToggleTour = () => {
    setIsTouring(prev => !prev);
  };

  const handleDataReady = useCallback((users: UserStats[], p: Period) => {
    setLeaderboardSnapshot({ users, period: p });
  }, []);

  const handleDownload = () => {
    if (leaderboardSnapshot) downloadLog(leaderboardSnapshot.users, leaderboardSnapshot.period);
  };

  const hasTourableUsers = (leaderboardSnapshot?.users ?? []).some(u => u.lastChangeset?.bbox);

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      
      {/* LEFT PANEL: Leaderboard */}
      <div className="w-full md:w-[60%] flex flex-col h-full z-10 relative">
        <header className="flex flex-col gap-4 p-4 md:p-6 border-b border-border bg-card/50 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="flex items-baseline gap-2 text-2xl md:text-3xl font-black tracking-tighter">
                <span className="bg-gradient-to-br from-primary to-blue-600 bg-clip-text text-transparent">OSM LEADERBOARD</span>
                <span className="text-xs font-normal text-muted-foreground tracking-normal">{VERSION}</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Contributor editing achievements</p>
            </div>

            <div className="flex items-center gap-1">
              {/* Loading indicator */}
              {isLoading && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse mr-1">
                  <RefreshCw size={13} className="animate-spin" />
                  Loading now...
                </span>
              )}
              {/* Storytelling tour: cycle "View Last Edit on Map" for every ranked user, looping */}
              <button
                onClick={handleToggleTour}
                disabled={!hasTourableUsers}
                className={cn(
                  "p-2 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                  isTouring
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                )}
                title={isTouring ? "Stop tour" : "Play tour of last edits"}
              >
                {isTouring ? <Square size={16} className="fill-current" /> : <Play size={20} />}
              </button>
              {/* 3-year growth chart */}
              <button
                onClick={() => setIsGrowthChartOpen(true)}
                className="p-2 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="3-year growth chart"
              >
                <TrendingUp size={20} />
              </button>
              {/* Download log */}
              <button
                onClick={handleDownload}
                disabled={!leaderboardSnapshot}
                className="p-2 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Download log file"
              >
                <Download size={20} />
              </button>
              {/* Refresh */}
              <button
                onClick={handleRefresh}
                className="p-2 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Refresh Data"
              >
                <RefreshCw size={20} />
              </button>
            </div>
          </div>
          
          <PeriodTabs activePeriod={period} onChange={setPeriod} />
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6 custom-scrollbar">
          <Leaderboard
            period={period}
            onViewMap={handleViewMap}
            onLoadingChange={setIsLoading}
            onDataReady={handleDataReady}
            tourActiveUsername={isTouring ? focusedUser?.username : undefined}
          />
        </div>

        {/* Footer */}
        <footer className="hidden md:flex items-center justify-between px-6 py-2 border-t border-border bg-card/50 text-xs text-muted-foreground shrink-0">
          <span>© mapconcierge, <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">CC0</a></span>
          <a
            href="https://github.com/mapconcierge/osm-leaderboard"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
            title="GitHub repository"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-label="GitHub">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
        </footer>

        {/* Mobile Map Toggle */}
        <div className="md:hidden absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
          <button 
            onClick={() => setIsMapOpenMobile(true)}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-full shadow-lg shadow-primary/20"
          >
            <MapIcon size={18} />
            Show Map
          </button>
        </div>
      </div>

      {/* RIGHT PANEL: Map */}
      <div className={cn(
        "fixed inset-0 z-40 md:relative md:w-[40%] md:h-full md:block md:z-0 transition-transform duration-300",
        isMapOpenMobile ? "translate-y-0" : "translate-y-full md:translate-y-0"
      )}>
        {/* Mobile close button */}
        <button
          onClick={() => { setIsTouring(false); setIsMapOpenMobile(false); }}
          className="md:hidden absolute top-4 right-4 z-50 p-2 bg-background/80 backdrop-blur border border-border rounded-full shadow-lg"
        >
          <X size={20} className="text-foreground" />
        </button>
        
        <Suspense fallback={<div className="w-full h-full bg-muted" />}>
          <MapPanel focusedUser={focusedUser} />
        </Suspense>
      </div>

      {isGrowthChartOpen && (
        <Suspense fallback={null}>
          <GrowthChart open={isGrowthChartOpen} onOpenChange={setIsGrowthChartOpen} />
        </Suspense>
      )}
    </div>
  );
}
