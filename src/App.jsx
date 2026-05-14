import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Activity,
  Download,
  Film,
  Image,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
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
    <div className="min-h-screen w-[400px] bg-gradient-to-br from-slate-950 via-slate-900 to-purple-950 p-5">
      <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">InstagramPro</h1>
              <p className="text-xs text-slate-300">Automation launcher for posts, reels, stories, and search</p>
            </div>
          </div>
          <div className={`mt-1 h-3 w-3 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Status</div>
          <div className="text-sm text-slate-100">{statusMessage}</div>
        </div>
      </div>

      <section className="mb-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Select Mode</div>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(MODE_CONFIG).map(([modeId, config]) => {
            const Icon = config.icon;
            const isSelected = selectedMode === modeId;
            return (
              <button
                key={modeId}
                type="button"
                onClick={() => setSelectedMode(modeId)}
                className={`rounded-2xl border p-4 text-left transition ${
                  isSelected
                    ? `border-white/20 bg-gradient-to-br ${config.color} shadow-lg`
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <Icon className={`mb-3 h-6 w-6 ${isSelected ? 'text-white' : 'text-slate-300'}`} />
                <div className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-100'}`}>{config.label}</div>
                <div className={`mt-1 text-xs ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>{config.destination}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-1 text-sm font-semibold text-white">{mode.label}</div>
        <div className="mb-4 text-xs leading-5 text-slate-300">{mode.description}</div>

        <div className="mb-3 rounded-xl border border-violet-400/20 bg-violet-500/10 p-3 text-xs text-violet-100">
          Start flow: open Instagram, go to <span className="font-semibold">{mode.destination}</span>, then run the enabled actions below.
        </div>

        <div className="space-y-3">
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
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                <Upload className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-white">Upload CSV or Excel</div>
                <div className="text-xs text-slate-400">Accepted formats: CSV, TXT, XLS, XLSX</div>
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
              className="block cursor-pointer rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              {csvFile || 'Choose File'}
            </label>

            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-slate-400">Loaded usernames</span>
              <span className="font-semibold text-emerald-300">{usernames.length}</span>
            </div>

            {usernames.length > 0 && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
                Preview: {usernames.slice(0, 6).join(', ')}
                {usernames.length > 6 ? '...' : ''}
              </div>
            )}

            {followProgress.total > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
                  <span>Follow progress</span>
                  <span>
                    {followProgress.current} / {followProgress.total}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-700">
                  <div
                    className="h-2 rounded-full bg-emerald-500 transition-all"
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

      <section className="mb-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Session Stats</div>
        <div className="grid grid-cols-2 gap-3">
          {statCards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} color={card.color} />
          ))}
        </div>
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Daily Limits</div>
          <div className="space-y-3">
            <LimitBar label="Likes Today" current={stats.dailyLikes || 0} max={advancedSettings.dailyLikeLimit} />
            <LimitBar label="Follows Today" current={stats.dailyFollows || 0} max={advancedSettings.dailyFollowLimit} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-4 gap-3">
        <button
          type="button"
          onClick={handleExport}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3 text-white transition hover:bg-white/10"
        >
          <Download className="h-5 w-5" />
          <span className="text-xs font-medium">Export</span>
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3 text-white transition hover:bg-white/10"
        >
          <SettingsIcon className="h-5 w-5" />
          <span className="text-xs font-medium">Settings</span>
        </button>
        <button
          type="button"
          onClick={handleRefreshReset}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3 text-white transition hover:bg-white/10"
        >
          <RotateCcw className="h-5 w-5" />
          <span className="text-xs font-medium">Refresh</span>
        </button>
        <button
          type="button"
          onClick={handleStartStop}
          className={`flex flex-col items-center justify-center gap-2 rounded-2xl py-3 text-white transition ${
            isRunning
              ? 'bg-red-600 hover:bg-red-500'
              : 'bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500'
          }`}
        >
          {isRunning ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          <span className="text-xs font-semibold">{isRunning ? 'Stop' : 'Start'}</span>
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
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-lg">{icon}</div>
        <div>
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="text-xs text-slate-400">{desc}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onChange}
        className={`relative h-7 w-12 rounded-full transition ${checked ? 'bg-violet-600' : 'bg-slate-600'}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${color} p-4 text-center shadow`}>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-white/80">{label}</div>
    </div>
  );
}

function LimitBar({ label, current, max }) {
  const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const isNearLimit = percentage >= 80;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className={isNearLimit ? 'font-semibold text-red-400' : 'font-semibold text-emerald-300'}>
          {current} / {max}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-700">
        <div
          className={`h-2 rounded-full transition-all ${isNearLimit ? 'bg-red-500' : 'bg-emerald-500'}`}
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
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-white">Advanced Settings</h2>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
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

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
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
            className="rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(localSettings)}
            className="rounded-2xl bg-violet-600 py-3 text-sm font-medium text-white transition hover:bg-violet-500"
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
          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white"
          placeholder="Min"
        />
        <input
          type="number"
          value={max}
          onChange={(event) => onMaxChange(event.target.value)}
          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white"
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
        className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white"
      />
    </div>
  );
}

export default App;
