console.log('InstagramPro background service worker loaded');

let currentSession = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function waitForTabComplete(tabId, timeoutMs = 90000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        // Wait a bit more to ensure content is rendered
        await sleep(1500);
        return tab;
      }
    } catch (error) {
      console.warn('Error checking tab status:', error);
      // Tab might have been closed
      throw new Error('Instagram tab was closed or became unavailable.');
    }
    await sleep(500);
  }

  // Even if not complete, try to proceed if tab exists
  try {
    const tab = await chrome.tabs.get(tabId);
    console.warn('Tab did not complete loading within timeout, proceeding anyway...');
    await sleep(2000);
    return tab;
  } catch (error) {
    throw new Error('Instagram page is taking too long to load. Please check your internet connection and try again.');
  }
}

async function ensureContentScriptInjected(tabId) {
  try {
    console.log('Pinging content script...');
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    console.log('Content script already injected, ping response:', response);
    return;
  } catch (error) {
    console.log('Content script not found, injecting now...', error?.message || error);
  }

  try {
    console.log('Injecting content script into tab:', tabId);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/instagram-improved.js'],
    });
    console.log('Content script injected successfully');
  } catch (error) {
    console.error('Failed to inject content script:', error);
    throw new Error(`Failed to inject content script: ${error?.message || error}`);
  }

  // Wait for content script to initialize
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(500 + attempt * 150);
    try {
      console.log(`Verifying content script (attempt ${attempt + 1}/10)...`);
      const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      console.log('Content script verified, ping response:', response);
      return;
    } catch (error) {
      if (attempt === 9) {
        console.error('Content script failed to respond after injection');
        throw new Error('Content script failed to initialize. Please refresh the Instagram page and try again.');
      }
    }
  }
}

async function sendMessageToInstagramTab(tabId, payload, attempts = 5) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      console.log(`Attempt ${attempt + 1}/${attempts} to send message to tab ${tabId}`);
      await ensureContentScriptInjected(tabId);
      await sleep(700 + attempt * 250);
      console.log('Sending payload:', payload.type);
      const response = await chrome.tabs.sendMessage(tabId, payload);
      console.log('Message sent successfully, response:', response);
      return response;
    } catch (error) {
      lastError = error;
      console.warn(`Retrying tab message (${attempt + 1}/${attempts}):`, error?.message || error);
      await sleep(900 + attempt * 300);
    }
  }

  console.error('Failed to send message after all attempts:', lastError);
  throw lastError || new Error('Could not deliver message to Instagram tab.');
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
    console.log('No current session or tab ID mismatch');
    return;
  }

  const session = currentSession;

  try {
    console.log('Waiting for tab to complete loading...');
    const tab = await waitForTabComplete(tabId);
    console.log('Tab loaded:', tab.url, 'Status:', tab.status);
    
    if (currentSession !== session) {
      console.log('Session changed during wait');
      return;
    }
    
    if (!tab.url || !tab.url.includes('instagram.com')) {
      console.log('Tab URL is not Instagram:', tab.url);
      chrome.storage.local.set({
        statusMessage: 'Please navigate to Instagram.com',
        isRunning: false,
      });
      chrome.runtime.sendMessage({
        type: 'STATUS_UPDATE',
        isRunning: false,
      }).catch(() => {});
      return;
    }

    if (!force && session.lastDispatchedUrl === tab.url) {
      console.log('Already dispatched to this URL, skipping');
      return;
    }

    const payload = createAutomationPayload(session);
    if (!payload) {
      console.log('No payload created');
      return;
    }

    console.log('Sending START_AUTOMATION message to content script...');
    await sendMessageToInstagramTab(tabId, payload);
    console.log('START_AUTOMATION message sent successfully');

    if (currentSession !== session) {
      return;
    }

    session.lastDispatchedUrl = tab.url;
    const statusMsg = session.mode === 'search' && payload.targetUsername
      ? `Opening profile for ${payload.targetUsername}...`
      : `Running ${session.mode} automation...`;
    
    console.log('Setting status:', statusMsg);
    chrome.storage.local.set({ statusMessage: statusMsg });
    chrome.runtime.sendMessage({
      type: 'STATUS_MESSAGE',
      message: statusMsg,
    }).catch(() => {});
    
  } catch (error) {
    console.error('Error dispatching session to tab:', error);
    const errorMsg = error?.message || String(error);
    chrome.storage.local.set({
      statusMessage: `Error: ${errorMsg}`,
      isRunning: false,
    });
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      isRunning: false,
    }).catch(() => {});
    chrome.runtime.sendMessage({
      type: 'STATUS_MESSAGE',
      message: `Failed to start: ${errorMsg}`,
    }).catch(() => {});
  }
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
    isRunning: false,
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
    chrome.storage.local.set({ 
      statusMessage: 'Instagram tab closed. Session ended.',
      isRunning: false,
    });
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      isRunning: false,
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_SESSION') {
    (async () => {
      try {
        const usernames = Array.isArray(message.usernames) ? message.usernames.filter(Boolean) : [];
        const launchUrl = getInstagramUrlForMode(message.mode);
        
        await chrome.storage.local.set({
          statusMessage: `Opening Instagram for ${message.mode}...`,
          isRunning: true,
        });
        
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

        // Dispatch session with better error handling
        try {
          await dispatchSessionToTab(tabId, true);
        } catch (dispatchError) {
          console.warn('Initial dispatch failed, will retry on tab update:', dispatchError);
          // Don't fail the entire session, let tab update listener retry
        }
        
        sendResponse({ success: true, tabId, sessionId });
      } catch (error) {
        console.error('START_SESSION failed:', error);
        currentSession = null;
        await chrome.storage.local.set({
          statusMessage: `Failed to start: ${error?.message || 'Unknown error'}`,
          isRunning: false,
        });
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    })();

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
        const completedLabel = message.username ? `Finished processing ${message.username}. All usernames completed!` : 'Search completed. All usernames processed!';
        console.log('Search automation completed, setting isRunning to false');
        await chrome.storage.local.set({ 
          statusMessage: completedLabel,
          isRunning: false,
        });
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

chrome.storage.local.get(['stats', 'scrapedData', 'isRunning'], (result) => {
  const updates = {};

  if (!result.stats) {
    updates.stats = { scrolls: 0, likes: 0, follows: 0, scraped: 0, dailyLikes: 0, dailyFollows: 0 };
  }

  if (!Array.isArray(result.scrapedData)) {
    updates.scrapedData = [];
  }

  if (typeof result.isRunning !== 'boolean') {
    updates.isRunning = false;
  }

  if (Object.keys(updates).length > 0) {
    chrome.storage.local.set(updates);
  }
});
