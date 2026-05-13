console.log('InstagramPro background service worker loaded');

let currentSession = null;

function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getInstagramUrlForMode(mode) {
  switch (mode) {
    case 'reels':
      return 'https://www.instagram.com/reels/';
    case 'search':
      return 'https://www.instagram.com/explore/search/';
    case 'posts':
    case 'stories':
    default:
      return 'https://www.instagram.com/';
  }
}

function getSearchProfileUrl(username) {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

async function findOrCreateInstagramTab(url) {
  const tabs = await chrome.tabs.query({});
  const instagramTab = tabs.find((tab) => tab.url && tab.url.includes('instagram.com'));

  if (instagramTab?.id) {
    await chrome.tabs.update(instagramTab.id, { url, active: true });
    return instagramTab.id;
  }

  const created = await chrome.tabs.create({ url, active: true });
  return created.id;
}

async function waitForTabComplete(tabId, timeoutMs = 45000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      return tab;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Timed out waiting for the Instagram tab to finish loading.');
}

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return;
  } catch (error) {
    console.log('Injecting content script after failed ping:', error?.message || error);
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-scripts/instagram-improved.js'],
  });
}

function createAutomationPayload(session = currentSession) {
  if (!session) {
    return null;
  }

  const searchTotal = session.usernames.length;
  const targetUsername =
    session.mode === 'search'
      ? session.usernames[session.searchIndex] || null
      : null;

  return {
    type: 'START_AUTOMATION',
    sessionId: session.sessionId,
    mode: session.mode,
    settings: session.settings,
    advancedSettings: session.advancedSettings,
    usernames: session.usernames,
    targetUsername,
    searchIndex: session.searchIndex,
    searchTotal,
  };
}

async function dispatchSessionToTab(tabId, force = false) {
  if (!currentSession || currentSession.tabId !== tabId) {
    return;
  }

  const session = currentSession;

  const tab = await waitForTabComplete(tabId);
  if (currentSession !== session || !tab.url || !tab.url.includes('instagram.com')) {
    return;
  }

  if (!force && session.lastDispatchedUrl === tab.url) {
    return;
  }

  const payload = createAutomationPayload(session);
  if (!payload) {
    return;
  }

  await ensureContentScriptInjected(tabId);
  if (currentSession !== session) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (currentSession !== session) {
    return;
  }
  await chrome.tabs.sendMessage(tabId, payload);

  if (currentSession !== session) {
    return;
  }

  session.lastDispatchedUrl = tab.url;
  chrome.storage.local.set({
    statusMessage:
      session.mode === 'search' && payload.targetUsername
        ? `Opening profile for ${payload.targetUsername}...`
        : `Running ${session.mode} automation...`,
  });
}

async function stopCurrentSession() {
  if (currentSession?.tabId) {
    try {
      await chrome.tabs.sendMessage(currentSession.tabId, { type: 'STOP_AUTOMATION' });
    } catch (error) {
      console.warn('Could not send STOP_AUTOMATION:', error?.message || error);
    }
  }

  currentSession = null;
  await chrome.storage.local.set({
    statusMessage: 'Automation stopped.',
  });
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    isRunning: false,
  }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!currentSession || currentSession.tabId !== tabId) {
    return;
  }

  if (changeInfo.status === 'complete' && tab.url?.includes('instagram.com')) {
    dispatchSessionToTab(tabId).catch((error) => {
      console.error('Failed to resume automation after tab update:', error);
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentSession?.tabId === tabId) {
    currentSession = null;
    chrome.storage.local.set({ statusMessage: 'Instagram tab closed. Session ended.' });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_SESSION') {
    (async () => {
      const usernames = Array.isArray(message.usernames) ? message.usernames.filter(Boolean) : [];
      const launchUrl = getInstagramUrlForMode(message.mode);
      const tabId = await findOrCreateInstagramTab(launchUrl);

      const session = {
        sessionId: generateSessionId(),
        tabId,
        mode: message.mode,
        settings: message.settings || {},
        advancedSettings: message.advancedSettings || {},
        usernames,
        searchIndex: 0,
        lastDispatchedUrl: null,
      };
      currentSession = session;
      const { sessionId } = session;

      await chrome.storage.local.set({
        statusMessage: `Opening Instagram for ${message.mode}...`,
      });

      chrome.runtime.sendMessage({
        type: 'STATUS_UPDATE',
        isRunning: true,
      }).catch(() => {});

      if (message.mode === 'search') {
        chrome.runtime.sendMessage({
          type: 'FOLLOW_PROGRESS',
          progress: { current: 0, total: usernames.length },
        }).catch(() => {});
      }

      await dispatchSessionToTab(tabId, true);
      sendResponse({ success: true, tabId, sessionId });
    })().catch((error) => {
      console.error('START_SESSION failed:', error);
      sendResponse({ success: false, error: error?.message || String(error) });
    });

    return true;
  }

  if (message.type === 'STOP_SESSION') {
    stopCurrentSession()
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('STOP_SESSION failed:', error);
        sendResponse({ success: false, error: error?.message || String(error) });
      });

    return true;
  }

  if (message.type === 'STATUS_MESSAGE') {
    chrome.storage.local.set({ statusMessage: message.message || 'Working...' });
    chrome.runtime.sendMessage(message).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SEARCH_STEP_RESULT') {
    (async () => {
      const session = currentSession;
      if (!session || session.mode !== 'search') {
        sendResponse({ success: false, error: 'No active search session.' });
        return;
      }

      if (message.sessionId !== session.sessionId) {
        sendResponse({ success: false, error: 'Search session ID mismatch.' });
        return;
      }

      const currentProgress = session.searchIndex + 1;
      chrome.runtime.sendMessage({
        type: 'FOLLOW_PROGRESS',
        progress: {
          current: currentProgress,
          total: session.usernames.length,
        },
      }).catch(() => {});

      if (currentProgress >= session.usernames.length) {
        const completedLabel = message.username ? `Finished processing ${message.username}.` : 'Search completed.';
        await chrome.storage.local.set({ statusMessage: completedLabel });
        if (currentSession === session) {
          currentSession = null;
        }
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          isRunning: false,
        }).catch(() => {});
        sendResponse({ success: true, done: true });
        return;
      }

      if (currentSession !== session) {
        sendResponse({ success: false, error: 'Search session changed before next profile dispatch.' });
        return;
      }

      session.searchIndex += 1;
      session.lastDispatchedUrl = null;
      const nextUsername = session.usernames[session.searchIndex];
      await chrome.storage.local.set({
        statusMessage: `Opening profile for ${nextUsername}...`,
      });
      await chrome.tabs.update(session.tabId, {
        url: getSearchProfileUrl(nextUsername),
        active: true,
      });

      sendResponse({ success: true, done: false, nextUsername });
    })().catch((error) => {
      console.error('SEARCH_STEP_RESULT failed:', error);
      sendResponse({ success: false, error: error?.message || String(error) });
    });

    return true;
  }
});

chrome.storage.local.get(['stats', 'scrapedData'], (result) => {
  const updates = {};

  if (!result.stats) {
    updates.stats = { scrolls: 0, likes: 0, follows: 0, scraped: 0, dailyLikes: 0, dailyFollows: 0 };
  }

  if (!Array.isArray(result.scrapedData)) {
    updates.scrapedData = [];
  }

  if (Object.keys(updates).length > 0) {
    chrome.storage.local.set(updates);
  }
});
