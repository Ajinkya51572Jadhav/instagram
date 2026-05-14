import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Activity,
  ChevronRight,
  Download,
  Film,
  Gauge,
  Image,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Settings as SettingsIcon,
  Upload,
} from 'lucide-react';

const DEFAULT_SETTINGS = {
  posts: {
    autoScroll: true,
    autoLike: true,
    dataScrape: true,
  },
  reels: {
    autoScroll: true,
    autoLike: true,
    dataScrape: true,
  },
  stories: {
    autoScroll: true,
    autoLike: true,
    dataScrape: true,
  },
  search: {
    autoFollow: true,
  },
};

const DEFAULT_ADVANCED_SETTINGS = {
  scrollDelay: { min: 2000, max: 5000 },
  likeDelay: { min: 3000, max: 8000 },
  dailyLikeLimit: 350,
  dailyFollowLimit: 150,
  sessionDuration: 30,
};

const DEFAULT_STATS = {
  scrolls: 0,
  likes: 0,
  follows: 0,
  scraped: 0,
  dailyLikes: 0,
  dailyFollows: 0,
};

const MODE_CONFIG = {
  posts: {
    label: 'Posts',
    icon: Image,
    color: 'from-blue-500 to-cyan-500',
    description: 'Open the Instagram feed and run post actions on visible posts.',
    destination: 'instagram.com',
    toggles: [
      { key: 'autoScroll', icon: '📜', label: 'Auto Scroll', desc: 'Scroll through the post feed automatically' },
      { key: 'autoLike', icon: '❤️', label: 'Auto Like', desc: 'Like visible posts when a Like button is available' },
      { key: 'dataScrape', icon: '📊', label: 'Data Scrape', desc: 'Capture usernames, captions, and media details' },
    ],
  },
  reels: {
    label: 'Reels',
    icon: Film,
    color: 'from-purple-500 to-pink-500',
    description: 'Open Reels, move through videos, and run reel actions.',
    destination: 'instagram.com/reels/',
    toggles: [
      { key: 'autoScroll', icon: '🎬', label: 'Auto Scroll', desc: 'Advance to the next reel automatically' },
      { key: 'autoLike', icon: '❤️', label: 'Auto Like', desc: 'Like reels when the current reel is not liked yet' },
      { key: 'dataScrape', icon: '📊', label: 'Data Scrape', desc: 'Capture usernames, audio names, and reel metadata' },
    ],
  },
  stories: {
    label: 'Stories',
    icon: MessageCircle,
    color: 'from-orange-500 to-red-500',
    description: 'Open the story tray from the Instagram home feed and advance through stories.',
    destination: 'instagram.com',
    toggles: [
      { key: 'autoScroll', icon: '👁️', label: 'Auto Advance', desc: 'Move to the next story after a short view delay' },
      { key: 'autoLike', icon: '❤️', label: 'Auto Like', desc: 'Like each visible story when a Like action is available' },
      { key: 'dataScrape', icon: '📊', label: 'Data Scrape', desc: 'Capture usernames and story context when available' },
    ],
  },
  search: {
    label: 'Search',
    icon: Search,
    color: 'from-green-500 to-emerald-500',
    description: 'Upload usernames and process them one by one for follow automation.',
    destination: 'instagram.com/explore/search/',
    toggles: [
      { key: 'autoFollow', icon: '👥', label: 'Auto Follow', desc: 'Send a follow request on each matching profile' },
    ],
  },
};

function mergeModeSettings(savedSettings) {
  const next = { ...DEFAULT_SETTINGS };
  Object.keys(DEFAULT_SETTINGS).forEach((mode) => {
    next[mode] = {
      ...DEFAULT_SETTINGS[mode],
      ...(savedSettings?.[mode] || {}),
    };
  });
  return next;
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[^\w.]/g, '')
    .toLowerCase();
}

function parseRowsToUsernames(rows) {
  const usernames = [];
  const seen = new Set();

  rows.forEach((row) => {
    const cells = Array.isArray(row) ? row : [row];
    cells.forEach((cell) => {
      const username = normalizeUsername(cell);
      if (!username || username === 'username' || seen.has(username)) {
        return;
      }
      seen.add(username);
      usernames.push(username);
    });
  });

  return usernames;
}

function escapeCsvValue(value) {
  const normalizedValue = Array.isArray(value)
    ? value.join(' | ')
    : value === null || value === undefined
      ? ''
      : String(value);

  return `"${normalizedValue.replace(/"/g, '""')}"`;
}

function convertRecordsToCsv(records) {
  if (!records.length) {
    return '';
  }

  const preferredHeaders = [
    'platform',
    'contentType',
    'timestamp',
    'username',
    'channelName',
    'audioName',
    'caption',
    'postUrl',
    'imageUrl',
    'videoUrl',
    'isVideo',
    'hashtags',
    'mentions',
    'storyUrl',
  ];

  const dynamicHeaders = new Set(preferredHeaders);
  records.forEach((record) => {
    Object.keys(record || {}).forEach((key) => dynamicHeaders.add(key));
  });

  const headers = [...dynamicHeaders];
  const rows = records.map((record) => headers.map((header) => escapeCsvValue(record?.[header])));
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function App() {
  const [selectedMode, setSelectedMode] = useState('posts');
  const [isRunning, setIsRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Ready to start.');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [advancedSettings, setAdvancedSettings] = useState(DEFAULT_ADVANCED_SETTINGS);
  const [stats, setStats] = useState(DEFAULT_STATS);
  const [csvFile, setCsvFile] = useState('');
  const [usernames, setUsernames] = useState([]);
  const [followProgress, setFollowProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    chrome.storage.local.get(
      ['settings', 'stats', 'advancedSettings', 'statusMessage', 'selectedMode', 'searchUsernames', 'searchFileName'],
      (result) => {
        setSettings(mergeModeSettings(result.settings));
        setStats({ ...DEFAULT_STATS, ...(result.stats || {}) });
        setAdvancedSettings({ ...DEFAULT_ADVANCED_SETTINGS, ...(result.advancedSettings || {}) });
        setStatusMessage(result.statusMessage || 'Ready to start.');
        setSelectedMode(result.selectedMode || 'posts');
        setUsernames(Array.isArray(result.searchUsernames) ? result.searchUsernames : []);
        setCsvFile(result.searchFileName || '');
      }
    );

    const handleMessage = (message) => {
      if (message.type === 'STATS_UPDATE') {
        setStats({ ...DEFAULT_STATS, ...(message.stats || {}) });
      } else if (message.type === 'STATUS_UPDATE') {
        setIsRunning(Boolean(message.isRunning));
      } else if (message.type === 'FOLLOW_PROGRESS') {
        setFollowProgress(message.progress || { current: 0, total: 0 });
      } else if (message.type === 'STATUS_MESSAGE') {
        setStatusMessage(message.message || 'Working...');
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  useEffect(() => {
    chrome.storage.local.set({
      selectedMode,
      searchUsernames: usernames,
      searchFileName: csvFile,
    });
  }, [selectedMode, usernames, csvFile]);

  const mode = MODE_CONFIG[selectedMode];
  const currentSettings = settings[selectedMode];
  const enabledToggleCount = mode.toggles.filter((toggle) => Boolean(currentSettings[toggle.key])).length;
  const progressPercent = followProgress.total ? Math.round((followProgress.current / followProgress.total) * 100) : 0;
  const statCards = useMemo(
    () => [
      { label: 'Scrolls', value: stats.scrolls, color: 'from-blue-500 to-cyan-500' },
      { label: 'Likes', value: stats.likes, color: 'from-pink-500 to-rose-500' },
      { label: 'Scraped', value: stats.scraped, color: 'from-purple-500 to-indigo-500' },
      { label: 'Follows', value: stats.follows, color: 'from-emerald-500 to-green-500' },
    ],
    [stats]
  );

  const persistSettings = (nextSettings) => {
    setSettings(nextSettings);
    chrome.storage.local.set({ settings: nextSettings });
  };

  const toggleSetting = (key) => {
    const nextSettings = {
      ...settings,
      [selectedMode]: {
        ...currentSettings,
        [key]: !currentSettings[key],
      },
    };
    persistSettings(nextSettings);
  };

  const handleStartStop = async () => {
    if (isRunning) {
      await chrome.runtime.sendMessage({ type: 'STOP_SESSION' });
      setIsRunning(false);
      setStatusMessage('Automation stopped.');
      return;
    }

    if (selectedMode === 'search' && usernames.length === 0) {
      setStatusMessage('Upload a CSV, TXT, or Excel file with usernames before starting Search.');
      return;
    }

    setFollowProgress({ current: 0, total: usernames.length });
    setStatusMessage(`Opening Instagram for ${mode.label}...`);

    const response = await chrome.runtime.sendMessage({
      type: 'START_SESSION',
      mode: selectedMode,
      settings: currentSettings,
      advancedSettings,
      usernames: selectedMode === 'search' ? usernames : [],
    });

    if (!response?.success) {
      setIsRunning(false);
      setStatusMessage(response?.error || 'Failed to start automation.');
      return;
    }

    setIsRunning(true);
  };

  const handleCSVUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      let extractedUsernames = [];
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        extractedUsernames = parseRowsToUsernames(rows);
      } else {
        const text = await file.text();
        const rows = text
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.split(/[,;\t]/));
        extractedUsernames = parseRowsToUsernames(rows);
      }

      setUsernames(extractedUsernames);
      setCsvFile(file.name);
      setFollowProgress({ current: 0, total: extractedUsernames.length });
      setStatusMessage(`Loaded ${extractedUsernames.length} usernames from ${file.name}.`);
    } catch (error) {
      console.error('Failed to parse upload:', error);
      setStatusMessage('Could not read that file. Use CSV, TXT, XLS, or XLSX.');
    }
  };

  const handleExport = async () => {
    try {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['scrapedData'], resolve);
      });

      const records = Array.isArray(result.scrapedData) ? result.scrapedData : [];
      if (!records.length) {
        setStatusMessage('No scraped data available to export yet.');
        return;
      }

      const csvContent = convertRecordsToCsv(records);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `instagram_data_${Date.now()}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
      setStatusMessage('Export downloaded.');
    } catch (error) {
      console.error('Export failed:', error);
      setStatusMessage('Export failed while preparing local scraped data.');
    }
  };

  const handleRefreshReset = async () => {
    try {
      if (isRunning) {
        await chrome.runtime.sendMessage({ type: 'STOP_SESSION' });
      }

      await chrome.storage.local.remove(['scrapedData', 'stats', 'statusMessage', 'searchUsernames', 'searchFileName']);

      setStats(DEFAULT_STATS);
      setUsernames([]);
      setCsvFile('');
      setFollowProgress({ current: 0, total: 0 });
      setIsRunning(false);
      setStatusMessage('All scraped, view, like, and search data cleared.');
    } catch (error) {
      console.error('Refresh reset failed:', error);
      setStatusMessage('Could not clear extension data.');
    }
  };

  return (
    <div className="relative w-[440px] overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.22),_transparent_34%),linear-gradient(160deg,_#020617_0%,_#0b1120_42%,_#2e1065_100%)] p-3.5">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-10 top-5 h-28 w-28 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute right-0 top-28 h-32 w-32 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute bottom-20 left-20 h-36 w-36 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="relative mb-3 rounded-[24px] border border-white/12 bg-white/[0.07] p-3.5 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-br from-fuchsia-500 via-violet-500 to-indigo-500 shadow-[0_12px_30px_rgba(139,92,246,0.45)]">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="mb-0.5 flex items-center gap-2">
                <h1 className="text-[26px] font-semibold leading-none tracking-tight text-white">InstagramPro</h1>
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                  Live
                </span>
              </div>
              <p className="max-w-[290px] text-xs leading-5 text-slate-300">
                Smarter automation for posts, reels, stories, and search.
              </p>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-2">
            <div className={`h-3 w-3 rounded-full ${isRunning ? 'bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.9)] animate-pulse' : 'bg-slate-500'}`} />
          </div>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2">
          <InfoChip icon={Sparkles} label="Mode" value={mode.label} accent="violet" />
          <InfoChip icon={ShieldCheck} label="Enabled" value={`${enabledToggleCount}/${mode.toggles.length}`} accent="emerald" />
          <InfoChip icon={Gauge} label="State" value={isRunning ? 'Running' : 'Ready'} accent="sky" />
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Status</div>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-slate-300">
              {mode.destination}
            </span>
          </div>
          <div className="text-sm leading-5 text-slate-100">{statusMessage}</div>
        </div>
      </div>

      <section className="mb-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Select Mode</div>
          <div className="text-[11px] font-medium text-slate-500">Pick the automation style</div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(MODE_CONFIG).map(([modeId, config]) => {
            const Icon = config.icon;
            const isSelected = selectedMode === modeId;
            return (
              <button
                key={modeId}
                type="button"
                onClick={() => setSelectedMode(modeId)}
                className={`group rounded-[20px] border p-3 text-left transition duration-200 ${
                  isSelected
                    ? `border-white/20 bg-gradient-to-br ${config.color} shadow-[0_18px_40px_rgba(15,23,42,0.35)]`
                    : 'border-white/10 bg-white/[0.06] hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.09]'
                }`}
              >
                <div className="mb-2 flex items-start justify-between">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
                      isSelected ? 'bg-white/15 text-white' : 'bg-slate-900/70 text-slate-300'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-100'}`}>{config.label}</div>
                <div className={`mt-1 text-[10px] ${isSelected ? 'text-white/85' : 'text-slate-400'}`}>{config.toggles.length} tools</div>
                <div className={`mt-1 flex items-center gap-1 text-[10px] font-medium ${isSelected ? 'text-white/90' : 'text-slate-500'}`}>
                  Open
                  <ChevronRight className={`h-3 w-3 transition ${isSelected ? 'translate-x-0.5' : 'group-hover:translate-x-0.5'}`} />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-3 rounded-[24px] border border-white/12 bg-white/[0.06] p-3.5 shadow-[0_18px_40px_rgba(15,23,42,0.3)] backdrop-blur-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="mb-0.5 text-base font-semibold text-white">{mode.label}</div>
            <div className="text-[11px] leading-4 text-slate-300">{mode.description}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Enabled</div>
            <div className="text-sm font-semibold text-white">{enabledToggleCount}</div>
          </div>
        </div>

        <div className="mb-3 rounded-2xl border border-violet-400/20 bg-gradient-to-r from-violet-500/12 to-fuchsia-500/12 p-2.5 text-[11px] text-violet-100">
          Formula: <span className="font-semibold">Open</span>
          {' -> '}
          <span className="font-semibold">Wait</span>
          {' -> '}
          <span className="font-semibold">Action</span>
          {' -> '}
          <span className="font-semibold">Save</span>
          {' -> '}
          <span className="font-semibold">Move Next</span>
        </div>

        <div className="mb-3 rounded-2xl border border-white/10 bg-slate-950/35 p-2.5 text-[11px] leading-4 text-slate-300">
          Start flow: open Instagram, go to <span className="font-semibold text-white">{mode.destination}</span>, then run the enabled actions below.
        </div>

        <div className="space-y-2">
          {mode.toggles.map((toggle) => (
            <ToggleControl
              key={toggle.key}
              icon={toggle.icon}
              label={toggle.label}
              desc={toggle.desc}
              checked={Boolean(currentSettings[toggle.key])}
              onChange={() => toggleSetting(toggle.key)}
            />
          ))}
        </div>

        {selectedMode === 'search' && (
          <div className="mt-3 rounded-[20px] border border-emerald-400/15 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 p-3">
            <div className="mb-2 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                <Upload className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-white">Upload usernames</div>
                <div className="text-[11px] text-slate-400">CSV, TXT, XLS, XLSX</div>
              </div>
            </div>

            <input
              id="search-upload"
              type="file"
              accept=".csv,.txt,.xls,.xlsx"
              className="hidden"
              onChange={handleCSVUpload}
            />
            <label
              htmlFor="search-upload"
              className="block cursor-pointer rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-2.5 text-center text-sm font-medium text-white shadow-[0_12px_28px_rgba(16,185,129,0.3)] transition hover:from-emerald-400 hover:to-teal-400"
            >
              {csvFile || 'Choose File'}
            </label>

            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Loaded usernames</span>
              <span className="font-semibold text-emerald-300">{usernames.length}</span>
            </div>

            {usernames.length > 0 && (
              <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-2.5 text-[11px] leading-4 text-slate-300">
                Preview: {usernames.slice(0, 4).join(', ')}
                {usernames.length > 6 ? '...' : ''}
              </div>
            )}

            {followProgress.total > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-300">
                  <span>Follow progress</span>
                  <span className="font-semibold text-emerald-200">
                    {followProgress.current} / {followProgress.total} ({progressPercent}%)
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 transition-all"
                    style={{
                      width: `${followProgress.total ? (followProgress.current / followProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mb-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Session Stats</div>
          <div className="text-[11px] text-slate-500">Live numbers</div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {statCards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} color={card.color} />
          ))}
        </div>
        <div className="mt-2 rounded-[20px] border border-white/12 bg-white/[0.06] p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Daily Limits</div>
          <div className="space-y-3">
            <LimitBar label="Likes Today" current={stats.dailyLikes || 0} max={advancedSettings.dailyLikeLimit} />
            <LimitBar label="Follows Today" current={stats.dailyFollows || 0} max={advancedSettings.dailyFollowLimit} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={handleExport}
          className="flex flex-col items-center justify-center gap-1.5 rounded-[20px] border border-white/10 bg-white/[0.06] py-2.5 text-white transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.1]"
        >
          <Download className="h-4.5 w-4.5" />
          <span className="text-[11px] font-medium">Export</span>
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="flex flex-col items-center justify-center gap-1.5 rounded-[20px] border border-white/10 bg-white/[0.06] py-2.5 text-white transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.1]"
        >
          <SettingsIcon className="h-4.5 w-4.5" />
          <span className="text-[11px] font-medium">Settings</span>
        </button>
        <button
          type="button"
          onClick={handleRefreshReset}
          className="flex flex-col items-center justify-center gap-1.5 rounded-[20px] border border-white/10 bg-white/[0.06] py-2.5 text-white transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.1]"
        >
          <RotateCcw className="h-4.5 w-4.5" />
          <span className="text-[11px] font-medium">Refresh</span>
        </button>
        <button
          type="button"
          onClick={handleStartStop}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-[20px] py-2.5 text-white shadow-[0_14px_28px_rgba(88,28,135,0.28)] transition ${
            isRunning
              ? 'bg-red-600 hover:bg-red-500'
              : 'bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500'
          }`}
        >
          {isRunning ? <Pause className="h-4.5 w-4.5" /> : <Play className="h-4.5 w-4.5" />}
          <span className="text-[11px] font-semibold">{isRunning ? 'Stop' : 'Start'}</span>
        </button>
      </section>

      {showSettings && (
        <SettingsModal
          settings={advancedSettings}
          onSave={(nextSettings) => {
            setAdvancedSettings(nextSettings);
            chrome.storage.local.set({ advancedSettings: nextSettings });
            setShowSettings(false);
            setStatusMessage('Advanced settings saved.');
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function ToggleControl({ icon, label, desc, checked, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-[20px] border border-white/10 bg-white/[0.06] p-3 transition hover:border-white/20 hover:bg-white/[0.09]">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-2xl text-base transition ${
            checked
              ? 'bg-gradient-to-br from-violet-500/80 to-fuchsia-500/80 text-white shadow-[0_12px_24px_rgba(139,92,246,0.35)]'
              : 'bg-slate-800/80 text-slate-300'
          }`}
        >
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-white">{label}</div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                checked ? 'bg-emerald-400/15 text-emerald-200' : 'bg-slate-700/70 text-slate-400'
              }`}
            >
              {checked ? 'On' : 'Off'}
            </span>
          </div>
          <div className="text-[11px] leading-4 text-slate-400">{desc}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onChange}
        aria-pressed={checked}
        className={`relative h-8 w-14 rounded-full border transition ${
          checked
            ? 'border-violet-300/30 bg-gradient-to-r from-violet-500 to-fuchsia-500 shadow-[0_10px_22px_rgba(139,92,246,0.45)]'
            : 'border-white/10 bg-slate-700/90'
        }`}
      >
        <span
          className={`absolute top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[9px] font-bold text-slate-900 shadow-md transition ${
            checked ? 'translate-x-7' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className={`rounded-[20px] bg-gradient-to-br ${color} p-2.5 text-center shadow-[0_16px_30px_rgba(15,23,42,0.28)]`}>
      <div className="text-[24px] font-bold leading-none text-white">{value}</div>
      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/80">{label}</div>
    </div>
  );
}

function LimitBar({ label, current, max }) {
  const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const isNearLimit = percentage >= 80;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-slate-300">{label}</span>
        <span className={isNearLimit ? 'font-semibold text-red-400' : 'font-semibold text-emerald-300'}>
          {current} / {max}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-700/80">
        <div
          className={`h-full rounded-full transition-all ${isNearLimit ? 'bg-gradient-to-r from-red-500 to-rose-400' : 'bg-gradient-to-r from-emerald-400 to-cyan-400'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function SettingsModal({ settings, onSave, onClose }) {
  const [localSettings, setLocalSettings] = useState(settings);

  const updateRange = (rangeKey, bound, value) => {
    const numericValue = Number(value) || 0;
    setLocalSettings((current) => ({
      ...current,
      [rangeKey]: {
        ...current[rangeKey],
        [bound]: numericValue,
      },
    }));
  };

  const updateField = (field, value) => {
    setLocalSettings((current) => ({
      ...current,
      [field]: Number(value) || 0,
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(51,24,88,0.96))] p-6 shadow-[0_24px_90px_rgba(2,6,23,0.7)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Advanced Settings</h2>
            <div className="text-xs text-slate-400">Tune speed, safety, and usage limits.</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-slate-300">
            Control
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[24px] border border-white/10 bg-white/[0.06] p-4">
            <div className="mb-3 text-sm font-semibold text-white">Timing</div>
            <div className="space-y-3">
              <NumberRangeField
                label="Scroll Delay (ms)"
                min={localSettings.scrollDelay.min}
                max={localSettings.scrollDelay.max}
                onMinChange={(value) => updateRange('scrollDelay', 'min', value)}
                onMaxChange={(value) => updateRange('scrollDelay', 'max', value)}
              />
              <NumberRangeField
                label="Like Delay (ms)"
                min={localSettings.likeDelay.min}
                max={localSettings.likeDelay.max}
                onMinChange={(value) => updateRange('likeDelay', 'min', value)}
                onMaxChange={(value) => updateRange('likeDelay', 'max', value)}
              />
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/[0.06] p-4">
            <div className="mb-3 text-sm font-semibold text-white">Safety</div>
            <div className="space-y-3">
              <NumberField
                label="Daily Like Limit"
                value={localSettings.dailyLikeLimit}
                onChange={(value) => updateField('dailyLikeLimit', value)}
              />
              <NumberField
                label="Daily Follow Limit"
                value={localSettings.dailyFollowLimit}
                onChange={(value) => updateField('dailyFollowLimit', value)}
              />
              <NumberField
                label="Session Duration (min)"
                value={localSettings.sessionDuration}
                onChange={(value) => updateField('sessionDuration', value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[24px] border border-white/10 bg-white/[0.06] py-3 text-sm font-medium text-white transition hover:bg-white/[0.1]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(localSettings)}
            className="rounded-[24px] bg-gradient-to-r from-fuchsia-600 to-violet-600 py-3 text-sm font-medium text-white transition hover:from-fuchsia-500 hover:to-violet-500"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberRangeField({ label, min, max, onMinChange, onMaxChange }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-300">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          value={min}
          onChange={(event) => onMinChange(event.target.value)}
          className="rounded-2xl border border-white/10 bg-slate-800/90 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20"
          placeholder="Min"
        />
        <input
          type="number"
          value={max}
          onChange={(event) => onMaxChange(event.target.value)}
          className="rounded-2xl border border-white/10 bg-slate-800/90 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20"
          placeholder="Max"
        />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-300">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-slate-800/90 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20"
      />
    </div>
  );
}

function InfoChip({ icon: Icon, label, value, accent = 'violet' }) {
  const accentClasses = {
    violet: 'from-violet-500/20 to-fuchsia-500/10 text-violet-100',
    emerald: 'from-emerald-500/20 to-teal-500/10 text-emerald-100',
    sky: 'from-sky-500/20 to-cyan-500/10 text-sky-100',
  };

  return (
    <div className={`rounded-2xl border border-white/10 bg-gradient-to-br ${accentClasses[accent] || accentClasses.violet} p-3`}>
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

export default App;
