import { useEffect, useMemo, useState } from 'react';
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

const LEGAL_DOCUMENTS = {
  privacy: {
    title: 'Privacy Policy',
    sections: [
      {
        heading: 'Overview',
        body:
          'InstagramPro is an Instagram productivity toolkit with reels scrolling, engagement insights, profile tools, and workflow automation.',
      },
      {
        heading: 'What We Store',
        body:
          'The extension stores your selected settings, progress details, and exported records locally on your device so the enabled workflow features can keep working between sessions.',
      },
      {
        heading: 'How Data Is Used',
        body:
          'Visible Instagram page information is used only for the productivity, engagement tools, and creator tools that you choose to enable inside the extension.',
      },
      {
        heading: 'User Control',
        body:
          'You control when features start, stop, reset, and export. You are responsible for using the extension in a way that follows Instagram rules and your local laws.',
      },
    ],
  },
  terms: {
    title: 'Terms & Conditions',
    sections: [
      {
        heading: 'Accepted Use',
        body:
          'InstagramPro is provided for productivity, workflow support, engagement tools, and creator tools on Instagram accounts that you are authorized to manage.',
      },
      {
        heading: 'Responsible Use',
        body:
          'Use the extension carefully and review your settings before starting any action. You remain fully responsible for account activity, platform compliance, and results.',
      },
      {
        heading: 'No Guarantee',
        body:
          'Instagram interface changes, account limits, or network issues may affect how features perform. Some actions may pause, retry, or require manual review.',
      },
      {
        heading: 'Local Records',
        body:
          'Any exported records or saved settings remain under your control on your device unless you choose to move or share them yourself.',
      },
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
  const [activeLegalDoc, setActiveLegalDoc] = useState(null);
  const [statusMessage, setStatusMessage] = useState('Ready to start.');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [advancedSettings, setAdvancedSettings] = useState(DEFAULT_ADVANCED_SETTINGS);
  const [stats, setStats] = useState(DEFAULT_STATS);
  const [csvFile, setCsvFile] = useState('');
  const [usernames, setUsernames] = useState([]);
  const [followProgress, setFollowProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    chrome.storage.local.get(
      ['settings', 'stats', 'advancedSettings', 'statusMessage', 'selectedMode', 'searchUsernames', 'searchFileName', 'isRunning'],
      (result) => {
        setSettings(mergeModeSettings(result.settings));
        setStats({ ...DEFAULT_STATS, ...(result.stats || {}) });
        setAdvancedSettings({ ...DEFAULT_ADVANCED_SETTINGS, ...(result.advancedSettings || {}) });
        setStatusMessage(result.statusMessage || 'Ready to start.');
        setSelectedMode(result.selectedMode || 'posts');
        setUsernames(Array.isArray(result.searchUsernames) ? result.searchUsernames : []);
        setCsvFile(result.searchFileName || '');
        // Ensure isRunning is properly loaded as boolean
        const runningState = Boolean(result.isRunning);
        setIsRunning(runningState);
        console.log('Popup loaded, isRunning:', runningState);
      }
    );

    const handleMessage = (message) => {
      if (message.type === 'STATS_UPDATE') {
        setStats({ ...DEFAULT_STATS, ...(message.stats || {}) });
      } else if (message.type === 'STATUS_UPDATE') {
        const running = Boolean(message.isRunning);
        console.log('STATUS_UPDATE received, isRunning:', running);
        setIsRunning(running);
        chrome.storage.local.set({ isRunning: running });
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
  const statCards = useMemo(() => {
    const cards = [
      { label: 'Scrolls', value: stats.scrolls },
      { label: 'Likes', value: stats.likes },
      { label: 'Scraped', value: stats.scraped },
      { label: 'Follows', value: stats.follows },
    ];

    if (selectedMode === 'search') {
      return cards.filter((card) => ['Scraped', 'Follows'].includes(card.label));
    }

    return cards;
  }, [selectedMode, stats]);

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
      console.log('Stopping automation...');
      await chrome.runtime.sendMessage({ type: 'STOP_SESSION' });
      setIsRunning(false);
      chrome.storage.local.set({ isRunning: false });
      setStatusMessage('Automation stopped.');
      return;
    }

    if (selectedMode === 'search' && usernames.length === 0) {
      setStatusMessage('Upload a CSV, TXT, or Excel file with usernames before starting Search.');
      return;
    }

    console.log('Starting automation...');
    setFollowProgress({ current: 0, total: usernames.length });
    setStatusMessage(`Opening Instagram for ${mode.label}...`);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_SESSION',
        mode: selectedMode,
        settings: currentSettings,
        advancedSettings,
        usernames: selectedMode === 'search' ? usernames : [],
      });

      if (!response?.success) {
        console.error('START_SESSION failed:', response?.error);
        setIsRunning(false);
        chrome.storage.local.set({ isRunning: false });
        setStatusMessage(response?.error || 'Failed to start automation.');
        return;
      }

      console.log('Automation started successfully');
      setIsRunning(true);
      chrome.storage.local.set({ isRunning: true });
    } catch (error) {
      console.error('Error starting automation:', error);
      setIsRunning(false);
      chrome.storage.local.set({ isRunning: false });
      setStatusMessage('Failed to communicate with extension. Please try again.');
    }
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
    <div className="relative flex h-[520px] w-[380px] flex-col overflow-hidden bg-[linear-gradient(160deg,_#020617_0%,_#0b1120_42%,_#1e1b4b_100%)] px-2.5 pt-2.5 pb-2">
      <div className="relative mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600">
            <Activity className="h-3.5 w-3.5 text-white" />
          </div>
          <h1 className="text-sm font-semibold text-white">InstagramPro</h1>
        </div>
        <div className={`h-2 w-2 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
      </div>

      <div className="mb-1.5 rounded-lg border border-white/10 bg-white/[0.05] p-1.5">
        <div className="text-[10px] text-slate-300">{statusMessage}</div>
      </div>

      <section className="mb-1">
        <div className="mb-1 text-[10px] font-medium text-slate-400">Mode</div>
        <div className="grid grid-cols-4 gap-1.5">
          {Object.entries(MODE_CONFIG).map(([modeId, config]) => {
            const Icon = config.icon;
            const isSelected = selectedMode === modeId;
            return (
              <button
                key={modeId}
                type="button"
                onClick={() => setSelectedMode(modeId)}
                className={`rounded-lg border p-1.5 text-center transition ${
                  isSelected
                    ? 'border-violet-400/40 bg-violet-500/20'
                    : 'border-white/10 bg-white/[0.05] hover:bg-white/[0.08]'
                }`}
              >
                <Icon className={`h-4 w-4 mx-auto mb-0.5 ${isSelected ? 'text-violet-300' : 'text-slate-400'}`} />
                <div className={`text-[10px] font-medium ${isSelected ? 'text-white' : 'text-slate-300'}`}>{config.label}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-1 rounded-lg border border-white/10 bg-white/[0.05] p-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-xs font-medium text-white">{mode.label}</div>
          <div className="text-[9px] text-slate-400">{enabledToggleCount}/{mode.toggles.length}</div>
        </div>

        <div className="space-y-1">
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

        {selectedMode === 'stories' && (
          <div className="mt-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1">
            <div className="text-[9px] font-medium uppercase tracking-[0.18em] text-red-300">Live Story Note</div>
            <div className="mt-0.5 text-[9px] leading-3.5 text-red-100">
              If LIVE comes first, open a normal story manually, then start.
            </div>
          </div>
        )}

        {selectedMode === 'search' && (
          <div className="mt-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-1.5">
            <div className="mb-1 flex items-center gap-1.5">
              <Upload className="h-3 w-3 text-emerald-300" />
              <div className="text-[10px] font-medium text-white">Upload</div>
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
              className="block cursor-pointer rounded-md bg-emerald-600 px-2 py-1 text-center text-[10px] font-medium text-white hover:bg-emerald-500"
            >
              {csvFile || 'Choose File'}
            </label>

            <div className="mt-1 flex items-center justify-between text-[9px]">
              <span className="text-slate-300">Loaded</span>
              <span className="font-medium text-emerald-300">{usernames.length}</span>
            </div>

            {followProgress.total > 0 && (
              <div className="mt-1">
                <div className="mb-0.5 flex items-center justify-between text-[9px]">
                  <span className="text-slate-300">Progress</span>
                  <span className="font-medium text-emerald-200">
                    {followProgress.current}/{followProgress.total}
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-emerald-400"
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

      <section className="mb-1">
        <div className="mb-1 text-[10px] font-medium text-slate-400">Stats</div>
        <div className={`grid gap-1.5 ${selectedMode === 'search' ? 'grid-cols-2' : 'grid-cols-4'}`}>
          {statCards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} />
          ))}
        </div>
        {selectedMode !== 'search' && (
          <div className="mt-1 rounded-lg border border-white/10 bg-white/[0.05] p-1.5">
            <div className="space-y-1">
              <LimitBar label="Likes" current={stats.dailyLikes || 0} max={advancedSettings.dailyLikeLimit} />
              <LimitBar label="Follows" current={stats.dailyFollows || 0} max={advancedSettings.dailyFollowLimit} />
            </div>
          </div>
        )}
      </section>

      <div className="mt-auto">
        <section className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={handleExport}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] py-1.5 text-white hover:bg-white/[0.08]"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">Export</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] py-1.5 text-white hover:bg-white/[0.08]"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">Settings</span>
          </button>
          <button
            type="button"
            onClick={handleRefreshReset}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] py-1.5 text-white hover:bg-white/[0.08]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">Reset</span>
          </button>
          <button
            type="button"
            onClick={handleStartStop}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-white ${
              isRunning
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-violet-600 hover:bg-violet-500'
            }`}
          >
            {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span className="text-[10px] font-semibold">{isRunning ? 'Stop' : 'Start'}</span>
          </button>
        </section>

        <div className="mt-1 flex items-center justify-center gap-3 text-[9px]">
          <button
            type="button"
            onClick={() => setActiveLegalDoc('privacy')}
            className="text-slate-400 transition hover:text-violet-200"
          >
            Privacy Policy
          </button>
          <span className="text-slate-600">|</span>
          <button
            type="button"
            onClick={() => setActiveLegalDoc('terms')}
            className="text-slate-400 transition hover:text-violet-200"
          >
            Terms & Conditions
          </button>
        </div>
      </div>

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

      {activeLegalDoc && (
        <LegalModal
          item={LEGAL_DOCUMENTS[activeLegalDoc]}
          onClose={() => setActiveLegalDoc(null)}
        />
      )}
    </div>
  );
}

function ToggleControl({ icon, label, desc, checked, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.04] px-2 py-1">
      <div className="flex items-center gap-1.5">
        <div className="text-xs">{icon}</div>
        <div className="text-[10px] font-medium text-white">{label}</div>
      </div>
      <button
        type="button"
        onClick={onChange}
        aria-pressed={checked}
        aria-label={label}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border transition-colors duration-200 ${
          checked
            ? 'border-violet-300/40 bg-violet-500 shadow-[0_0_0_1px_rgba(139,92,246,0.15)]'
            : 'border-white/10 bg-slate-700'
        }`}
      >
        <span
          className={`pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.45)] transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.05] p-1.5 text-center">
      <div className="text-sm font-semibold text-white">{value}</div>
      <div className="text-[9px] font-medium text-slate-400">{label}</div>
    </div>
  );
}

function LimitBar({ label, current, max }) {
  const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const isNearLimit = percentage >= 80;

  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[9px]">
        <span className="text-slate-300">{label}</span>
        <span className={isNearLimit ? 'font-medium text-red-400' : 'font-medium text-emerald-300'}>
          {current}/{max}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-slate-700">
        <div
          className={`h-full rounded-full ${isNearLimit ? 'bg-red-500' : 'bg-emerald-400'}`}
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
      <div className="max-h-[500px] w-full max-w-sm overflow-y-auto rounded-xl border border-white/10 bg-[#0b1120] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Advanced Settings</h2>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.05] p-3">
            <div className="mb-2 text-xs font-medium text-white">Timing</div>
            <div className="space-y-2">
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

          <div className="rounded-lg border border-white/10 bg-white/[0.05] p-3">
            <div className="mb-2 text-xs font-medium text-white">Safety</div>
            <div className="space-y-2">
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

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/[0.05] py-2 text-xs font-medium text-white hover:bg-white/[0.08]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(localSettings)}
            className="rounded-lg bg-violet-600 py-2 text-xs font-medium text-white hover:bg-violet-500"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function LegalModal({ item, onClose }) {
  if (!item) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[500px] w-full max-w-sm overflow-y-auto rounded-xl border border-white/10 bg-[#0b1120] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">{item.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-slate-200 hover:bg-white/[0.08]"
          >
            Close
          </button>
        </div>

        <div className="space-y-2.5">
          {item.sections.map((section) => (
            <div key={section.heading} className="rounded-lg border border-white/10 bg-white/[0.05] p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200">
                {section.heading}
              </div>
              <div className="text-[11px] leading-5 text-slate-200">{section.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NumberRangeField({ label, min, max, onMinChange, onMaxChange }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] text-slate-300">{label}</label>
      <div className="grid grid-cols-2 gap-1.5">
        <input
          type="number"
          value={min}
          onChange={(event) => onMinChange(event.target.value)}
          className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-violet-400"
          placeholder="Min"
        />
        <input
          type="number"
          value={max}
          onChange={(event) => onMaxChange(event.target.value)}
          className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-violet-400"
          placeholder="Max"
        />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] text-slate-300">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-violet-400"
      />
    </div>
  );
}

export default App;
