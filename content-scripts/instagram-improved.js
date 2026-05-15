console.log('InstagramPro content script loaded on', window.location.href);

class InstagramAutomation {
  constructor() {
    this.isRunning = false;
    this.runToken = 0;
    this.currentMode = 'posts';
    this.settings = {};
    this.advancedSettings = {};
    this.sessionId = null;
    this.targetUsername = null;
    this.searchIndex = 0;
    this.searchTotal = 0;
    this.processedItems = new Set();
    this.currentPostState = null;
    this.currentStoryState = null;
    this.currentReelState = null;
    this.storyTrees = new Map();
    this.stats = {
      scrolls: 0,
      likes: 0,
      follows: 0,
      scraped: 0,
      dailyLikes: 0,
      dailyFollows: 0,
      sessionStartTime: null,
      lastResetDate: new Date().toDateString(),
    };

    chrome.storage.local.get(['stats'], (result) => {
      const stored = result?.stats && typeof result.stats === 'object' ? result.stats : null;
      if (!stored) {
        return;
      }

      this.stats = {
        ...this.stats,
        ...stored,
        scrolls: Number.isFinite(Number(stored.scrolls)) ? Number(stored.scrolls) : this.stats.scrolls,
        likes: Number.isFinite(Number(stored.likes)) ? Number(stored.likes) : this.stats.likes,
        follows: Number.isFinite(Number(stored.follows)) ? Number(stored.follows) : this.stats.follows,
        scraped: Number.isFinite(Number(stored.scraped)) ? Number(stored.scraped) : this.stats.scraped,
        dailyLikes: Number.isFinite(Number(stored.dailyLikes)) ? Number(stored.dailyLikes) : this.stats.dailyLikes,
        dailyFollows: Number.isFinite(Number(stored.dailyFollows)) ? Number(stored.dailyFollows) : this.stats.dailyFollows,
        lastResetDate: stored.lastResetDate || this.stats.lastResetDate,
      };
    });
  }

  randomBetween(min, max) {
    return Math.round(min + Math.random() * (max - min));
  }

  async wait(min, max = min) {
    const delay = this.randomBetween(min, max);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  getStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  sendMessage(message) {
    try {
      chrome.runtime.sendMessage(message);
    } catch (error) {
      const errorMsg = error?.message || String(error);
      console.warn('Failed to send runtime message:', errorMsg);
      
      // Detect extension context invalidation
      if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('message port closed')) {
        console.error('Extension was reloaded or updated. Stopping automation.');
        this.isRunning = false;
        this.runToken += 1;
        
        // Show user-friendly message on page
        const notification = document.createElement('div');
        notification.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 16px 24px;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          font-weight: 500;
          max-width: 320px;
          animation: slideIn 0.3s ease-out;
        `;
        notification.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-size: 24px;">⚠️</div>
            <div>
              <div style="font-weight: 600; margin-bottom: 4px;">Extension Reloaded</div>
              <div style="font-size: 12px; opacity: 0.9;">Automation stopped. Please restart from the extension popup.</div>
            </div>
          </div>
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
          notification.style.transition = 'opacity 0.3s ease-out';
          notification.style.opacity = '0';
          setTimeout(() => notification.remove(), 300);
        }, 8000);
        
        return false;
      }
    }
    return true;
  }

  sendStatusMessage(message) {
    console.log('[Status]', message);
    const sent = this.sendMessage({
      type: 'STATUS_MESSAGE',
      message,
    });
    
    // If extension context is invalidated, stop automation
    if (!sent && !this.isRunning) {
      return false;
    }
    return true;
  }

  updateStats() {
    try {
      chrome.storage.local.set({ stats: this.stats });
      this.sendMessage({
        type: 'STATS_UPDATE',
        stats: this.stats,
      });
    } catch (error) {
      console.warn('Failed to update stats:', error);
      // If extension context is invalidated, stop automation
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('message port closed')) {
        this.isRunning = false;
        this.runToken += 1;
      }
    }
  }

  resetSessionStats() {
    this.stats.scrolls = 0;
    this.stats.likes = 0;
    this.stats.follows = 0;
    this.stats.scraped = 0;
    this.stats.sessionStartTime = null;
    this.updateStats();
  }

  resetDailyCountersIfNeeded() {
    const today = new Date().toDateString();
    if (this.stats.lastResetDate === today) {
      return;
    }

    this.stats.dailyLikes = 0;
    this.stats.dailyFollows = 0;
    this.stats.lastResetDate = today;
    this.updateStats();
  }

  checkDailyLimit(action) {
    this.resetDailyCountersIfNeeded();

    if (action === 'like') {
      return this.stats.dailyLikes < (this.advancedSettings.dailyLikeLimit || 350);
    }

    if (action === 'follow') {
      return this.stats.dailyFollows < (this.advancedSettings.dailyFollowLimit || 150);
    }

    return true;
  }

  isVisible(element) {
    if (!element) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }

  getVisibleArea(element) {
    if (!element) {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return visibleWidth * visibleHeight;
  }

  getElementCenter(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }

    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  getReelElementRoot(element) {
    if (!element) {
      return document;
    }

    let current = element.nodeType === Node.ELEMENT_NODE ? element : element.parentElement;
    let bestMatch = null;
    let bestScore = -1;

    while (current && current !== document.body) {
      if (current.nodeType !== Node.ELEMENT_NODE) {
        current = current.parentElement;
        continue;
      }

      const hasVideo = Boolean(current.querySelector?.('video'));
      const hasVideoPlayer = Boolean(current.querySelector?.('[aria-label="Video player"][role="group"]'));
      const hasLikeButton = Boolean(current.querySelector?.('svg[aria-label="Like"], title'));
      const hasReelLink = Boolean(current.querySelector?.('a[href*="/reel/"], a[href*="/reels/"]'));
      const hasSidebarActions = Boolean(
        current.querySelector?.(
          'svg[aria-label="Like"], svg[aria-label="Comment"], svg[aria-label="Repost"], svg[aria-label="Share"], title'
        )
      );

      const score =
        (hasVideo ? 2 : 0) +
        (hasVideoPlayer ? 4 : 0) +
        (hasLikeButton ? 2 : 0) +
        (hasReelLink ? 2 : 0) +
        (hasSidebarActions ? 2 : 0);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = current;
      }

      current = current.parentElement;
    }

    return (
      bestMatch ||
      element?.closest?.('article, main, section, div[role="presentation"]') ||
      element?.closest?.('div') ||
      document
    );
  }

  getStableMediaSrc(media) {
    const src = media?.currentSrc || media?.src || media?.getAttribute?.('src') || '';
    if (!src || src.startsWith('blob:')) {
      return null;
    }
    return src;
  }

  getActiveReelVideo(root = document) {
    const scope = root?.querySelectorAll ? root : document;
    const videos = [...scope.querySelectorAll('video')].filter((video) => this.getVisibleArea(video) > 0);

    if (!videos.length && scope !== document) {
      return this.getActiveReelVideo(document);
    }

    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;

    return videos.sort((left, right) => {
      const leftCenter = this.getElementCenter(left);
      const rightCenter = this.getElementCenter(right);
      const leftDistance = Math.hypot(leftCenter.x - viewportCenterX, leftCenter.y - viewportCenterY);
      const rightDistance = Math.hypot(rightCenter.x - viewportCenterX, rightCenter.y - viewportCenterY);
      const leftScore =
        this.getVisibleArea(left) +
        (!left.paused ? 1000000 : 0) +
        (left.readyState >= 2 ? 500000 : 0) +
        ((left.currentTime || 0) > 0 ? 250000 : 0) -
        leftDistance;
      const rightScore =
        this.getVisibleArea(right) +
        (!right.paused ? 1000000 : 0) +
        (right.readyState >= 2 ? 500000 : 0) +
        ((right.currentTime || 0) > 0 ? 250000 : 0) -
        rightDistance;
      return rightScore - leftScore;
    })[0] || null;
  }

  getItemId(container, fallbackPrefix) {
    const activeVideo = this.getActiveReelVideo(container) || this.getActiveReelVideo(document);
    const username = this.extractUsername(container || document);
    const caption = this.extractCaption(container || document) || '';
    const stableMediaSrc = this.getStableMediaSrc(activeVideo) || this.getStableMediaSrc(container?.querySelector?.('video'));
    return (
      container?.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]')?.href ||
      stableMediaSrc ||
      [window.location.pathname, username, caption.slice(0, 80)].filter(Boolean).join('|') ||
      `${fallbackPrefix}:${window.location.pathname}:${container?.textContent?.slice(0, 40) || Math.random()}`
    );
  }

  parseProfileFromHref(href) {
    if (!href?.startsWith('/')) {
      return null;
    }

    const segment = href.split('/').filter(Boolean)[0];
    if (!segment) {
      return null;
    }

    const reserved = new Set([
      'accounts',
      'direct',
      'explore',
      'p',
      'reel',
      'reels',
      'stories',
      'about',
      'developer',
      'legal',
      'challenge',
    ]);

    if (reserved.has(segment.toLowerCase())) {
      return null;
    }

    return /^[a-zA-Z0-9._]{1,30}$/.test(segment) ? segment : null;
  }

  extractUsername(root = document) {
    const prioritySelectors = [
      'header a[href^="/"]',
      'article header a[href^="/"]',
      'a[href*="/reel/"]',
      'a[href*="/reels/"]',
      'a[href^="/"]',
    ];

    for (const selector of prioritySelectors) {
      const candidates = root.querySelectorAll(selector);
      for (const candidate of candidates) {
        const username = this.parseProfileFromHref(candidate.getAttribute('href'));
        if (username) {
          return username;
        }
      }
    }

    const textCandidates = root.querySelectorAll('span, a');
    for (const candidate of textCandidates) {
      const text = candidate.textContent?.trim();
      if (text && /^[a-zA-Z0-9._]{1,30}$/.test(text)) {
        return text;
      }
    }

    return 'unknown_user';
  }

  extractAudioName(root = document) {
    const link = root.querySelector('a[href*="/audio/"], a[href*="/music/"]');
    if (link?.textContent?.trim()) {
      return link.textContent.trim();
    }

    const textNodes = [...root.querySelectorAll('span, a')];
    const originalAudio = textNodes.find((node) => /original audio|audio/i.test(node.textContent || ''));
    return originalAudio?.textContent?.trim() || null;
  }

  extractCaption(root = document) {
    const candidates = [...root.querySelectorAll('h1, h2, span[dir="auto"], div[role="button"] span')];
    const captions = candidates
      .map((node) => node.textContent?.trim())
      .filter((text) => text && text.length > 8 && text.length < 500);

    return captions.sort((a, b) => b.length - a.length)[0] || null;
  }

  normalizeInstagramUrl(rawUrl) {
    if (!rawUrl) {
      return null;
    }

    try {
      const url = new URL(rawUrl, window.location.origin);
      return `${url.origin}${url.pathname}`;
    } catch (error) {
      return null;
    }
  }

  extractCanonicalPostUrl(root = document, contentType = this.currentMode === 'reels' ? 'reel' : 'post') {
    const container = root || document;
    const rawCandidates = [...container.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]')]
      .map((link) => link.getAttribute('href'))
      .filter(Boolean);

    const allowedPrefixes = contentType === 'reel' ? ['/reel/', '/reels/'] : ['/p/', '/reel/', '/reels/'];
    const filtered = rawCandidates.filter((href) => allowedPrefixes.some((prefix) => href.includes(prefix)));

    filtered.sort((left, right) => {
      const leftRank = allowedPrefixes.findIndex((prefix) => left.includes(prefix));
      const rightRank = allowedPrefixes.findIndex((prefix) => right.includes(prefix));
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.length - right.length;
    });

    return this.normalizeInstagramUrl(filtered[0]) || null;
  }

  extractPostData(root = document, contentType = this.currentMode === 'reels' ? 'reel' : 'post', options = {}) {
    const normalizedOptions =
      typeof options === 'string' ? { canonicalUrl: options } : options && typeof options === 'object' ? options : {};
    const canonicalUrl = this.normalizeInstagramUrl(normalizedOptions.canonicalUrl);
    const automation = normalizedOptions.automation && typeof normalizedOptions.automation === 'object' ? normalizedOptions.automation : null;
    const username = this.extractUsername(root);
    const channelName = username;
    const caption = this.extractCaption(root);
    const video = root.querySelector('video');
    const image = root.querySelector('img[src]');
    const postUrl =
      canonicalUrl || this.extractCanonicalPostUrl(root, contentType) || this.normalizeInstagramUrl(window.location.href) || window.location.href;

    const payload = {
      platform: 'instagram',
      contentType,
      timestamp: new Date().toISOString(),
      username,
      channelName,
      audioName: this.extractAudioName(root),
      caption,
      postUrl,
      imageUrl: this.getStableMediaSrc(image) || image?.src || null,
      videoUrl: this.getStableMediaSrc(video),
      isVideo: Boolean(video),
      hashtags: caption ? caption.match(/#\w+/g) || [] : [],
      mentions: caption ? caption.match(/@\w+/g) || [] : [],
    };

    if (automation) {
      Object.assign(payload, automation);
    }

    return payload;
  }

  getElementText(element) {
    return element?.textContent?.trim().toLowerCase() || '';
  }

  getAccessibleLabel(element) {
    return (
      element?.getAttribute?.('aria-label') ||
      element?.getAttribute?.('title') ||
      element?.querySelector?.('svg')?.getAttribute?.('aria-label') ||
      element?.querySelector?.('title')?.textContent ||
      ''
    )
      .trim()
      .toLowerCase();
  }

  getDelayRange(key, fallback) {
    const configured = this.advancedSettings?.[key];
    const min = Number(configured?.min);
    const max = Number(configured?.max);

    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
      return { min, max };
    }

    return fallback;
  }

  getCurrentItemLabel() {
    if (this.currentMode === 'stories') {
      return 'story';
    }

    if (this.currentMode === 'posts') {
      return 'post';
    }

    if (this.currentMode === 'reels') {
      return 'reel';
    }

    return 'item';
  }

  async saveScrapedData(data) {
    if (!data?.username || data.username === 'unknown_user') {
      return false;
    }

    try {
      const existing = await chrome.storage.local.get(['scrapedData']);
      const scrapedData = Array.isArray(existing.scrapedData) ? existing.scrapedData : [];
      const entryId = [
        data.contentType || '',
        data.username || '',
        data.postUrl || data.storyUrl || '',
        data.videoUrl || data.imageUrl || '',
        data.audioName || '',
        data.storyTreePath || data.storyItemId || data.uniqueKey || '',
      ].join('|');

      const alreadySaved = scrapedData.some((item) => {
        const itemId = [
          item?.contentType || '',
          item?.username || '',
          item?.postUrl || item?.storyUrl || '',
          item?.videoUrl || item?.imageUrl || '',
          item?.audioName || '',
          item?.storyTreePath || item?.storyItemId || item?.uniqueKey || '',
        ].join('|');
        return itemId === entryId;
      });

      if (alreadySaved) {
        return true;
      }

      scrapedData.unshift({
        ...data,
        savedAt: new Date().toISOString(),
      });

      await chrome.storage.local.set({
        scrapedData: scrapedData.slice(0, 1000),
      });

      this.stats.scraped += 1;
      this.updateStats();
      return true;
    } catch (error) {
      this.sendStatusMessage(`Could not save scraped data locally: ${error?.message || 'unknown error'}`);
      return false;
    }
  }

  isSponsoredReel(root = document) {
    const container = root || document;
    const text = [container.textContent || '', ...[...container.querySelectorAll('a, button, span, div')].slice(0, 40).map((node) => this.getNodeIntentText(node))]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return /\b(sponsored|promoted|paid partnership)\b/i.test(text);
  }

  shouldCountCompletedReel(reelState = this.currentReelState) {
    if (!reelState || reelState.sponsored) {
      return false;
    }

    if (!this.settings.autoLike) {
      return true;
    }

    return Boolean(reelState.liked);
  }

  getNodeIntentText(node) {
    if (!node) {
      return '';
    }

    const descendantText = [...(node.querySelectorAll?.('svg, title, span, div') || [])]
      .slice(0, 8)
      .flatMap((child) => [child.getAttribute?.('aria-label'), child.getAttribute?.('title'), child.textContent]);

    return [node.getAttribute?.('aria-label'), node.getAttribute?.('title'), node.textContent, ...descendantText]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  isUnavailablePage() {
    const pageText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!pageText) {
      return false;
    }

    return (
      pageText.includes("sorry, this page isn't available") ||
      pageText.includes('the link you followed may be broken, or the page may have been removed')
    );
  }

  getFollowButtonState() {
    const candidates = [
      ...document.querySelectorAll('header button, header div[role="button"], header span[role="button"]'),
      ...document.querySelectorAll('main button, main div[role="button"], main span[role="button"]'),
      ...document.querySelectorAll('button, div[role="button"], span[role="button"]'),
    ];
    const seen = new Set();
    const matches = [];

    for (const candidate of candidates) {
      const button = candidate.closest?.('button, div[role="button"], span[role="button"]') || candidate;
      if (!button || seen.has(button) || this.getVisibleArea(button) <= 0) {
        continue;
      }
      seen.add(button);

      const text = this.getNodeIntentText(button).replace(/\s+/g, ' ').trim();
      if (!text) {
        continue;
      }

      if (/\brequested\b/.test(text)) {
        return { status: 'requested', button };
      }

      if (/\bfollowing\b/.test(text)) {
        return { status: 'following', button };
      }

      if (/\bfollow back\b/.test(text)) {
        const rect = button.getBoundingClientRect?.();
        const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
        matches.push({
          status: 'follow',
          button,
          score: 2000000 + this.getVisibleArea(button) - Math.abs(centerY - window.innerHeight * 0.2) * 200,
        });
        continue;
      }

      if (/(^|\s)follow(\s|$)/.test(text)) {
        const rect = button.getBoundingClientRect?.();
        const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
        const insideHeader = Boolean(button.closest('header, main header, section'));
        matches.push({
          status: 'follow',
          button,
          score:
            (insideHeader ? 1000000 : 0) +
            this.getVisibleArea(button) -
            Math.abs(centerY - window.innerHeight * 0.2) * 160,
        });
      }
    }

    if (matches.length) {
      matches.sort((left, right) => right.score - left.score);
      return { status: 'follow', button: matches[0].button };
    }

    return { status: 'button-not-found', button: null };
  }

  async waitForFollowConfirmation(timeoutMs = 9000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const state = this.getFollowButtonState();
      if (['following', 'requested'].includes(state.status)) {
        return state;
      }

      await this.wait(500, 900);
    }

    return this.getFollowButtonState();
  }

  async clickFollowButton(button) {
    if (!button) {
      return false;
    }

    const targets = [
      button,
      button.querySelector?.('div'),
      button.querySelector?.('span'),
      button.firstElementChild,
      button.querySelector?.('svg'),
    ].filter(Boolean);

    for (const target of targets) {
      target.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
      await this.wait(180, 320);

      const clicked = await this.clickElementReliably(target);
      if (clicked) {
        await this.wait(900, 1400);
        const state = this.getFollowButtonState();
        if (['following', 'requested'].includes(state.status)) {
          return true;
        }
      }

      await this.wait(250, 450);
    }

    return false;
  }

  extractSearchProfileData(targetUsername, result = {}) {
    const profileUrl = this.normalizeInstagramUrl(window.location.href) || window.location.href;
    const pageText = document.body?.innerText || '';
    const nameCandidate =
      [...document.querySelectorAll('header h1, header h2, main h1, main h2')]
        .map((node) => node.textContent?.trim())
        .find((text) => text && text.length <= 120) || null;
    const bioCandidate =
      [...document.querySelectorAll('header section span, header div span[dir="auto"], main section span, main div span[dir="auto"]')]
        .map((node) => node.textContent?.trim())
        .filter((text) => text && text.length > 1 && text.length <= 300)
        .sort((left, right) => right.length - left.length)[0] || null;

    return {
      platform: 'instagram',
      contentType: 'search_profile',
      timestamp: new Date().toISOString(),
      username: targetUsername,
      channelName: targetUsername,
      profileUrl,
      profileName: nameCandidate,
      caption: bioCandidate,
      followSuccess: Boolean(result.success),
      followResult: result.reason || 'unknown',
      pageUnavailable: Boolean(this.isUnavailablePage()),
      uniqueKey: `search:${targetUsername}`,
      pageTextPreview: pageText.replace(/\s+/g, ' ').trim().slice(0, 200) || null,
    };
  }

  getSearchProfileRoot() {
    return document.querySelector('main header') || document.querySelector('header') || document.querySelector('main') || document.body;
  }

  async humanizeSearchProfileVisit(stage = 'browse', button = null, token = this.runToken) {
    if (token !== this.runToken) {
      return false;
    }

    const root = button || this.getSearchProfileRoot();
    const ranges = {
      browse: { min: 3200, max: 6200 },
      preClick: { min: 900, max: 1800 },
      postAction: { min: 5000, max: 9000 },
      skipAction: { min: 2600, max: 4600 },
    };
    const delay = ranges[stage] || ranges.browse;

    root?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
    await this.wait(500, 1100);
    if (token !== this.runToken) {
      return false;
    }

    const scrollOffset = Math.round((Math.random() - 0.5) * 180);
    window.scrollBy({ top: scrollOffset, left: 0, behavior: 'smooth' });
    await this.wait(450, 900);
    if (token !== this.runToken) {
      return false;
    }

    await this.mimicHumanPresence(root);
    await this.wait(delay.min, delay.max);
    return token === this.runToken;
  }

  hasUnlikeIntent(node) {
    const directText = [
      node?.getAttribute?.('aria-label'),
      node?.getAttribute?.('title'),
      node?.querySelector?.('svg')?.getAttribute?.('aria-label'),
      node?.querySelector?.('title')?.textContent,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (/(^|\s)(unlike|remove like|liked)(\s|$)/i.test(directText)) {
      return true;
    }

    const intentText = this.getNodeIntentText(node);
    return /(^|\s)(unlike|remove like)(\s|$)/i.test(intentText);
  }

  hasLikeIntent(node) {
    const directText = [
      node?.getAttribute?.('aria-label'),
      node?.getAttribute?.('title'),
      node?.querySelector?.('svg')?.getAttribute?.('aria-label'),
      node?.querySelector?.('title')?.textContent,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (/(^|\s)like(\s|$)/i.test(directText)) {
      return !this.hasUnlikeIntent(node);
    }

    const intentText = this.getNodeIntentText(node);
    return /(^|\s)like(\s|$)/i.test(intentText) && !this.hasUnlikeIntent(node);
  }

  findLikeButton(root = document) {
    const activeVideo = this.getActiveReelVideo(root) || this.getActiveReelVideo(document);
    const referencePoint = this.getElementCenter(activeVideo || root);
    const sidebarFirst = [
      ...root.querySelectorAll(
        '[role="button"] svg[aria-label="Like"], [role="button"] title, div[role="button"] svg[aria-label="Like"]'
      ),
    ];

    for (const node of sidebarFirst) {
      if (node.tagName?.toLowerCase() === 'title' && this.getElementText(node) !== 'like') {
        continue;
      }
      const button = node.closest?.('[role="button"], button');
      if (!button || this.hasUnlikeIntent(button) || this.getVisibleArea(button) <= 0) {
        continue;
      }
      return button;
    }

    const exactSelectors = [
      'svg[aria-label="Like"]',
      'svg[aria-label="Like"] title',
      'title',
    ];

    for (const selector of exactSelectors) {
      const nodes = [...root.querySelectorAll(selector)];
      for (const node of nodes) {
        if (selector === 'title' && this.getElementText(node) !== 'like') {
          continue;
        }

        const button = node.closest?.('[role="button"], button') || node.parentElement?.closest?.('[role="button"], button');
        if (!button || this.hasUnlikeIntent(button) || this.getVisibleArea(button) <= 0) {
          continue;
        }
        if (this.hasLikeIntent(button) || this.hasLikeIntent(node) || selector !== 'title') {
          return button;
        }
      }
    }

    const directCandidates = [
      ...root.querySelectorAll('button, div[role="button"], span[role="button"], svg[aria-label], title'),
      ...document.querySelectorAll('button, div[role="button"], span[role="button"], svg[aria-label], title'),
    ];
    const seen = new Set();
    const matches = [];

    for (const candidate of directCandidates) {
      const button = candidate.closest?.('button, div[role="button"], span[role="button"]') || candidate;
      if (!button || seen.has(button)) {
        continue;
      }
      seen.add(button);

      if (this.hasUnlikeIntent(button) || this.getVisibleArea(button) <= 0) {
        continue;
      }

      if (this.hasLikeIntent(button) || this.hasLikeIntent(candidate)) {
        const center = this.getElementCenter(button);
        const distance = Math.hypot(center.x - referencePoint.x, center.y - referencePoint.y);
        matches.push({ button, distance, label: this.getNodeIntentText(button) });
      }
    }

    matches.sort((left, right) => {
      const leftExact = left.label === 'like' ? -1000 : 0;
      const rightExact = right.label === 'like' ? -1000 : 0;
      return left.distance + leftExact - (right.distance + rightExact);
    });

    return matches[0]?.button || null;
  }

  findUnlikeButton(root = document) {
    const activeVideo = this.getActiveReelVideo(root) || this.getActiveReelVideo(document);
    const referencePoint = this.getElementCenter(activeVideo || root);
    const candidateScopes = [root, document].filter(Boolean);
    const seen = new Set();
    const matches = [];

    for (const scope of candidateScopes) {
      const nodes = [...scope.querySelectorAll('button, div[role="button"], span[role="button"], svg[aria-label], title')];
      for (const node of nodes) {
        const button = node.closest?.('button, div[role="button"], span[role="button"]') || node;
        if (!button || seen.has(button)) {
          continue;
        }
        seen.add(button);

        if (this.getVisibleArea(button) <= 0) {
          continue;
        }

        if (!this.hasUnlikeIntent(button) && !this.hasUnlikeIntent(node)) {
          continue;
        }

        const center = this.getElementCenter(button);
        const distance = Math.hypot(center.x - referencePoint.x, center.y - referencePoint.y);
        if (distance > Math.max(window.innerWidth, window.innerHeight) * 0.9) {
          continue;
        }

        const label = this.getNodeIntentText(button);
        const exactBoost = /\bunlike\b/i.test(label) || /\bremove like\b/i.test(label) ? -1200 : 0;
        matches.push({ button, distance: distance + exactBoost });
      }
    }

    matches.sort((left, right) => left.distance - right.distance);
    return matches[0]?.button || null;
  }

  isAlreadyLiked(root = document) {
    const scope = root?.querySelectorAll ? root : document;
    return Boolean(this.findUnlikeButton(scope) || (scope !== document ? this.findUnlikeButton(document) : null));
  }

  safeClick(element) {
    if (!element) {
      return false;
    }

    try {
      element.focus?.();
      element.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
      if (typeof PointerEvent === 'function') {
        element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      }
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      if (typeof PointerEvent === 'function') {
        element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
      }
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      element.click();
      return true;
    } catch (error) {
      console.error('Click failed:', error);
      return false;
    }
  }

  async clickElementReliably(element) {
    if (!element) {
      return false;
    }

    const targets = [
      element,
      element.querySelector?.('svg'),
      element.querySelector?.('span'),
      element.firstElementChild,
      element.parentElement,
    ].filter(Boolean);

    for (const target of targets) {
      if (this.safeClick(target)) {
        return true;
      }
      await this.wait(120, 220);
    }

    return false;
  }

  dispatchNavigationKey(key, code, keyCode) {
    const targets = [document.activeElement, document.body, document.documentElement, document].filter(Boolean);
    const dispatched = new Set();

    for (const target of targets) {
      if (dispatched.has(target)) {
        continue;
      }
      dispatched.add(target);

      for (const eventName of ['keydown', 'keyup']) {
        target.dispatchEvent(
          new KeyboardEvent(eventName, {
            key,
            code,
            keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true,
          })
        );
      }
    }
  }

  async doubleClickMedia(root = document) {
    const media = this.getActiveReelVideo(root) || root.querySelector('video, img') || document.querySelector('video, img');
    if (!media) {
      return false;
    }

    try {
      const rect = media.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      media.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, clientX, clientY }));
      media.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX, clientY, button: 0 }));
      media.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX, clientY, button: 0 }));
      media.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY, detail: 1, button: 0 }));
      media.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX, clientY, button: 0 }));
      media.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX, clientY, button: 0 }));
      media.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY, detail: 2, button: 0 }));
      media.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX, clientY }));

      return true;
    } catch (error) {
      console.error('Double click failed:', error);
      return false;
    }
  }

  getReelIdentity(root = this.getReelContainer()) {
    const media = this.getActiveReelVideo(root) || root?.querySelector?.('video, img');
    const username = this.extractUsername(root);
    const mediaSrc = this.getStableMediaSrc(media) || '';
    const caption = this.extractCaption(root) || '';
    const pathname = window.location.pathname || '';

    return [pathname, username, mediaSrc, caption.slice(0, 80)].filter(Boolean).join('|');
  }

  getCurrentReelSnapshot(root = this.getReelContainer()) {
    const video = this.getActiveReelVideo(root) || this.getActiveReelVideo(document);
    const container = this.getReelElementRoot(video || root);
    const reelLink =
      container?.querySelector?.('a[href*="/reel/"]')?.href ||
      container?.querySelector?.('a[href*="/reels/"]')?.href ||
      document.querySelector('a[href*="/reel/"]')?.href ||
      window.location.href;
    const username = this.extractUsername(container);
    const caption = this.extractCaption(container) || '';
    const mediaSrc = this.getStableMediaSrc(video) || this.getStableMediaSrc(container?.querySelector?.('video')) || '';
    const identity = [reelLink, username, mediaSrc, caption.slice(0, 80)].filter(Boolean).join('|');

    return {
      id: identity || this.getItemId(container, 'reel'),
      container,
      video,
      reelLink,
      username,
    };
  }

  async likeCurrentItem(root = document) {
    if (!this.settings.autoLike || !this.checkDailyLimit('like')) {
      return false;
    }

    if (this.isAlreadyLiked(root)) {
      return false;
    }

    const likeDelay = this.getDelayRange('likeDelay', { min: 1500, max: 3200 });

    if (this.currentMode === 'reels') {
      await this.wait(likeDelay.min, likeDelay.max);
      const mediaLiked = await this.doubleClickMedia(root);
      if (mediaLiked) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await this.wait(500, 900);
          if (this.isAlreadyLiked(root)) {
            this.stats.likes += 1;
            this.stats.dailyLikes += 1;
            this.updateStats();
            this.sendStatusMessage('Liked reel.');
            return true;
          }
        }
      }
    }

    const button = this.findLikeButton(root) || this.findLikeButton(document);
    if (button) {
      await this.wait(Math.max(300, likeDelay.min / 2), Math.max(700, likeDelay.max / 2));
      const clicked = await this.clickElementReliably(button);
      if (!clicked) {
        return false;
      }
    } else {
      const fallbackLiked = await this.doubleClickMedia(root);
      if (!fallbackLiked) {
        this.sendStatusMessage('Like action was not found on this reel.');
        return false;
      }
    }

    let confirmedLike = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await this.wait(500, 900);
      confirmedLike = this.isAlreadyLiked(root);
      if (confirmedLike) {
        break;
      }

      if (attempt === 1) {
        const fallbackLiked = await this.doubleClickMedia(root);
        if (fallbackLiked) {
          await this.wait(600, 1000);
        }
      }
    }

    if (!confirmedLike) {
      this.sendStatusMessage('Instagram did not confirm the like on this reel.');
      return false;
    }

    this.stats.likes += 1;
    this.stats.dailyLikes += 1;
    this.updateStats();
    this.sendStatusMessage(`Liked ${this.getCurrentItemLabel()}.`);
    return true;
  }

  async waitForVideoPlayback(video, timeoutMs = 12000) {
    if (!video) {
      return false;
    }

    const startedAt = Date.now();
    let previousTime = video.currentTime || 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        await this.wait(500, 800);
        const currentTime = video.currentTime || 0;
        if (currentTime > previousTime + 0.05 || (!video.paused && video.readyState >= 3)) {
          return true;
        }
        previousTime = currentTime;
      }

      await this.wait(400, 700);
    }

    return video.readyState >= 2 && video.videoWidth > 0;
  }

  async waitForCurrentReelReady(root = this.getReelContainer()) {
    const startedAt = Date.now();
    const timeoutMs = 15000;

    while (Date.now() - startedAt < timeoutMs) {
      const fallbackContainer = root || this.getReelContainer();
      const video = this.getActiveReelVideo(fallbackContainer) || this.getActiveReelVideo(document);
      const container = this.getReelElementRoot(video || fallbackContainer);
      const image = container?.querySelector?.('img');

      if (video) {
        const ready = await this.waitForVideoPlayback(video, 3500);
        if (ready) {
          return { ready: true, container, mediaType: 'video' };
        }
      } else if (image?.complete && image.naturalWidth > 0) {
        return { ready: true, container, mediaType: 'image' };
      }

      await this.wait(600, 900);
    }

    return { ready: false, container: root || this.getReelContainer(), mediaType: 'unknown' };
  }

  async mimicHumanPresence(root = this.getReelContainer()) {
    const container = root || this.getReelContainer();
    const rect = container?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const pointX = Math.round(rect.left + rect.width * (0.35 + Math.random() * 0.3));
    const pointY = Math.round(rect.top + rect.height * (0.3 + Math.random() * 0.4));

    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: pointX,
        clientY: pointY,
      })
    );
  }

  isVideoFinished(video) {
    if (!video) {
      return false;
    }

    const duration = Number(video.duration);
    if (video.ended) {
      return true;
    }

    if (Number.isFinite(duration) && duration > 0) {
      return video.currentTime >= Math.max(duration - 0.25, duration * 0.98);
    }

    return false;
  }

  isVideoNearEnd(video, thresholdSeconds = 1.2) {
    if (!video) {
      return false;
    }

    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return false;
    }

    return video.currentTime >= Math.max(duration - thresholdSeconds, duration * 0.92);
  }

  async waitForReelToFinish(root = this.getReelContainer(), token = this.runToken) {
    const initialSnapshot = this.getCurrentReelSnapshot(root);
    let lockedContainer = initialSnapshot.container || root || this.getReelContainer();
    let lockedVideo = this.getActiveReelVideo(lockedContainer);
    let lastTime = 0;
    let maxObservedTime = 0;
    let pausedMessageSent = false;
    let lastPresenceAt = 0;
    let waitingForVideoMessageSent = false;
    let stagnantLoops = 0;

    while (this.isRunning && token === this.runToken) {
      let activeVideo = lockedVideo && document.contains(lockedVideo) ? lockedVideo : this.getActiveReelVideo(lockedContainer);
      if (!activeVideo && document.contains(lockedContainer)) {
        activeVideo = lockedContainer.querySelector('video');
      }
      if (!activeVideo) {
        const refreshedSnapshot = this.getCurrentReelSnapshot(lockedContainer);
        lockedContainer = refreshedSnapshot.container || lockedContainer;
        activeVideo = refreshedSnapshot.video;
      }

      if (!activeVideo) {
        if (!waitingForVideoMessageSent) {
          this.sendStatusMessage('Waiting for the current reel video...');
          waitingForVideoMessageSent = true;
        }
        await this.wait(700, 1100);
        continue;
      }

      waitingForVideoMessageSent = false;
      lockedVideo = activeVideo;
      lockedContainer = this.getReelElementRoot(activeVideo) || lockedContainer;
      const container = lockedContainer;

      if (this.isVideoFinished(activeVideo)) {
        this.sendStatusMessage('Reel finished. Moving to the next reel...');
        return true;
      }

      if (activeVideo.paused) {
        if (!pausedMessageSent) {
          this.sendStatusMessage('Reel paused. Waiting for playback to resume...');
          pausedMessageSent = true;
        }
        await this.wait(700, 1100);
        continue;
      }

      if (pausedMessageSent) {
        this.sendStatusMessage('Playback resumed. Waiting for reel to finish...');
        pausedMessageSent = false;
      }

      const currentTime = activeVideo.currentTime || 0;
      const duration = Number(activeVideo.duration);
      const watchedToEnd =
        Number.isFinite(duration) && duration > 0
          ? maxObservedTime >= Math.max(duration - 1.5, duration * 0.85)
          : maxObservedTime > 8;
      if (currentTime < lastTime - 1.5 && this.isVideoNearEnd(activeVideo, 1.5) === false && watchedToEnd) {
        this.sendStatusMessage('Reel restarted after finishing. Moving to the next reel...');
        return true;
      }

      if (currentTime > lastTime + 0.2) {
        lastTime = currentTime;
        maxObservedTime = Math.max(maxObservedTime, currentTime);
        stagnantLoops = 0;
      } else {
        maxObservedTime = Math.max(maxObservedTime, currentTime);
        stagnantLoops += 1;
      }

      if (stagnantLoops >= 4 && this.isVideoNearEnd(activeVideo)) {
        this.sendStatusMessage('Reel reached the end. Moving to the next reel...');
        return true;
      }

      if (stagnantLoops >= 8 && !activeVideo.paused) {
        this.sendStatusMessage('Reel playback looks stuck. Waiting for it to continue...');
      }

      if (Date.now() - lastPresenceAt > this.randomBetween(2200, 3600)) {
        await this.mimicHumanPresence(container);
        lastPresenceAt = Date.now();
      }

      await this.wait(500, 900);
    }

    return false;
  }

  async smoothScrollFeed() {
    if (!this.settings.autoScroll) {
      return;
    }

    window.scrollBy({
      top: Math.round(window.innerHeight * 0.75),
      behavior: 'smooth',
    });

    this.stats.scrolls += 1;
    this.updateStats();

    const delay = this.advancedSettings.scrollDelay || { min: 2000, max: 5000 };
    await this.wait(delay.min, delay.max);
  }

  async advanceReel(countScroll = true) {
    if (!this.settings.autoScroll) {
      return false;
    }

    const beforeIdentity = this.getReelIdentity();
    let moved = false;

    const nextButton = document.querySelector(
      'button[aria-label*="Next" i], div[role="button"][aria-label*="Next" i], a[aria-label*="Next" i]'
    );
    if (nextButton) {
      await this.wait(250, 650);
      await this.clickElementReliably(nextButton);
      moved = await this.waitForReelChange(beforeIdentity, 8);
    }

    if (!moved) {
      const activeReel = this.getReelContainer();
      const activeVideo = this.getActiveReelVideo(activeReel) || this.getActiveReelVideo(document);
      activeVideo?.focus?.();
      activeReel?.focus?.();

      this.dispatchNavigationKey('ArrowDown', 'ArrowDown', 40);
      await this.wait(180, 320);
      this.dispatchNavigationKey('PageDown', 'PageDown', 34);
      moved = await this.waitForReelChange(beforeIdentity, 8);
    }

    if (!moved) {
      const wheelSteps = Math.random() < 0.3 ? [0.16, -0.04, 0.34, 0.46, 0.58] : [0.22, 0.37, 0.49, 0.62];
      for (const multiplier of wheelSteps) {
        window.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: window.innerHeight * multiplier,
            bubbles: true,
            cancelable: true,
          })
        );
        await this.wait(140, 320);
      }
      moved = await this.waitForReelChange(beforeIdentity, 8);
    }

    if (!moved) {
      const scrollOffsets = [0.45, 0.72, 0.95];
      for (const offset of scrollOffsets) {
        window.scrollBy({
          top: Math.round(window.innerHeight * offset),
          behavior: 'smooth',
        });
        await this.wait(260, 520);
      }
      moved = await this.waitForReelChange(beforeIdentity, 10);
    }

    if (!moved) {
      this.sendStatusMessage('Could not move to the next reel.');
      return false;
    }

    if (countScroll) {
      this.stats.scrolls += 1;
      this.updateStats();
    }
    return true;
  }

  async waitForReelChange(previousIdentity, attempts = 10) {
    for (let index = 0; index < attempts; index += 1) {
      await this.wait(500, 700);
      const currentIdentity = this.getReelIdentity();
      if (currentIdentity && currentIdentity !== previousIdentity) {
        return true;
      }
    }
    return false;
  }

  async takeHumanPause() {
    const baseDelay = this.advancedSettings.scrollDelay || { min: 3500, max: 6500 };
    await this.wait(
      Math.max(baseDelay.min, 3500),
      Math.max(baseDelay.max, Math.max(baseDelay.min, 6500))
    );

    if (Math.random() < 0.22) {
      await this.wait(5000, 10000);
    }
  }

  isStoryPageLocation() {
    return window.location.pathname.startsWith('/stories/');
  }

  getStoryTrayItemContainer(element) {
    const anchor = element?.closest?.('a[href^="/stories/"]') || element;
    if (!anchor) {
      return null;
    }

    let current = anchor;
    let bestMatch = anchor;
    let depth = 0;

    while (current && current !== document.body && depth < 8) {
      const rect = current.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        current = current.parentElement;
        depth += 1;
        continue;
      }

      const storyLinkCount =
        (current.matches?.('a[href^="/stories/"]') ? 1 : 0) + current.querySelectorAll?.('a[href^="/stories/"]').length;
      if (depth > 0 && storyLinkCount > 1) {
        break;
      }

      const nearTop = rect.top < Math.max(window.innerHeight * 0.35, 260);
      const reasonableSize = rect.width >= 36 && rect.height >= 36 && rect.width <= 220 && rect.height <= 220;
      const hasStoryMedia = Boolean(current.querySelector?.('img, canvas'));
      if (nearTop && reasonableSize && hasStoryMedia) {
        bestMatch = current;
      }

      current = current.parentElement;
      depth += 1;
    }

    return bestMatch;
  }

  getStoryTrayCandidates() {
    const links = [...document.querySelectorAll('a[href^="/stories/"]')];
    const seen = new Set();
    const matches = [];

    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('/stories/')) {
        continue;
      }

      const container = this.getStoryTrayItemContainer(link) || link;
      const rect = container.getBoundingClientRect?.() || link.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const visibleArea = this.getVisibleArea(container);
      const nearTop = rect.top < Math.max(window.innerHeight * 0.35, 260);
      const reasonableSize = rect.width >= 36 && rect.height >= 36 && rect.width <= 220 && rect.height <= 220;
      if (visibleArea <= 0 || !nearTop || !reasonableSize) {
        continue;
      }

      const dedupeKey = `${href}|${Math.round(rect.left)}|${Math.round(rect.top)}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      matches.push({
        link,
        container,
        href,
        top: rect.top,
        left: rect.left,
      });
    }

    matches.sort((left, right) => {
      const rowDelta = Math.abs(left.top - right.top);
      if (rowDelta > 18) {
        return left.top - right.top;
      }
      return left.left - right.left;
    });

    return matches;
  }

  getTopStoryTrayLink(skipLive = false) {
    const candidates = this.getStoryTrayCandidates().filter(
      (candidate) => !skipLive || !this.isLiveStoryInTray(candidate.container)
    );
    return candidates[0]?.link || null;
  }

  getStoryTrayTarget(skipLive = false) {
    const primaryCandidate = this.getStoryTrayCandidates().find(
      (candidate) => !skipLive || !this.isLiveStoryInTray(candidate.container)
    );
    if (primaryCandidate?.container) {
      return primaryCandidate.container;
    }

    const rawCandidates = [
      ...document.querySelectorAll('a[href^="/stories/"]'),
      ...document.querySelectorAll('div[role="button"] a[href^="/stories/"]'),
      ...document.querySelectorAll('button img, a img, div[role="button"] img'),
      ...document.querySelectorAll('canvas[style*="cursor: pointer"], header canvas, section canvas'),
      ...document.querySelectorAll('button[aria-label*="story" i], div[role="button"][aria-label*="story" i]'),
    ];

    const seen = new Set();
    const matches = [];
    for (const candidate of rawCandidates) {
      const clickable =
        candidate?.closest?.('a[href^="/stories/"], button, div[role="button"], li, article') ||
        candidate;
      if (!clickable || seen.has(clickable)) {
        continue;
      }
      seen.add(clickable);

      const rect = clickable.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const visibleArea = this.getVisibleArea(clickable);
      if (visibleArea <= 0) {
        continue;
      }

      const storyContainer = this.getStoryTrayItemContainer(clickable) || clickable;
      if (skipLive && this.isLiveStoryInTray(storyContainer)) {
        continue;
      }

      const href = clickable.getAttribute?.('href') || clickable.querySelector?.('a[href^="/stories/"]')?.getAttribute?.('href') || '';
      const nearTop = rect.top < Math.max(window.innerHeight * 0.35, 260);
      const nearLeft = rect.left < window.innerWidth * 0.65;
      const hasStoryHref = href.startsWith('/stories/');
      const hasStoryMedia = Boolean(candidate.tagName === 'CANVAS' || clickable.querySelector?.('canvas, img'));
      const reasonableSize = rect.width >= 36 && rect.height >= 36 && rect.width <= 220 && rect.height <= 220;
      if (!nearTop || !reasonableSize) {
        continue;
      }
      const score =
        (hasStoryHref ? 1000000 : 0) +
        (nearTop ? 300000 : 0) +
        (nearLeft ? 80000 : 0) +
        (hasStoryMedia ? 30000 : 0) +
        visibleArea -
        rect.left * 10 -
        Math.abs(rect.top) * 8;

      matches.push({ clickable, score });
    }

    matches.sort((left, right) => right.score - left.score);
    return matches[0]?.clickable || null;
  }

  getStoryNavigationButton(direction = 'next') {
    const wantPrevious = direction === 'previous';
    const viewerRoot = this.getStoryViewerRoot();
    const viewportMidX = window.innerWidth / 2;
    const candidates = [
      ...document.querySelectorAll('button, div[role="button"], svg[aria-label], title'),
    ];
    const seen = new Set();
    const matches = [];

    for (const candidate of candidates) {
      const button = candidate.closest?.('button, div[role="button"]') || candidate.parentElement?.closest?.('button, div[role="button"]');
      if (!button || seen.has(button) || this.getVisibleArea(button) <= 0) {
        continue;
      }
      seen.add(button);

      const rect = button.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0 || rect.top >= window.innerHeight * 0.95) {
        continue;
      }

      const intentText = [this.getNodeIntentText(button), this.getNodeIntentText(candidate)].join(' ').trim();
      const matchesDirection = wantPrevious
        ? /\b(previous|prev|back|left chevron)\b/i.test(intentText)
        : /\b(next|forward|right chevron)\b/i.test(intentText);
      if (!matchesDirection) {
        continue;
      }

      const center = this.getElementCenter(button);
      const insideViewer = Boolean(viewerRoot && viewerRoot !== document && viewerRoot.contains(button));
      const horizontalBias = wantPrevious ? Math.max(0, viewportMidX - center.x) : Math.max(0, center.x - viewportMidX);
      const edgeBias = wantPrevious ? Math.max(0, window.innerWidth * 0.45 - center.x) : Math.max(0, center.x - window.innerWidth * 0.55);
      const score =
        (insideViewer ? 1000000 : 0) +
        this.getVisibleArea(button) +
        horizontalBias * 200 -
        edgeBias * 25 -
        Math.abs(center.y - window.innerHeight * 0.45) * 10;

      matches.push({ button, score });
    }

    matches.sort((left, right) => right.score - left.score);
    return matches[0]?.button || null;
  }

  isStoryViewerOpen() {
    if (this.isStoryPageLocation()) {
      const hasStoryMedia = Boolean(this.getCurrentStoryMedia(document).media);
      const hasStoryNav = Boolean(
        this.getStoryNavigationButton('next') ||
          this.getStoryNavigationButton('previous') ||
          document.querySelector('div[role="progressbar"], [role="slider"][aria-label*="volume" i], a[href^="/stories/"]')
      );
      if (hasStoryMedia || hasStoryNav) {
        return true;
      }
    }

    return Boolean(document.querySelector('div[role="dialog"] button[aria-label="Close"], button[aria-label="Close"]'));
  }

  async openStoryViewer() {
    if (this.isStoryViewerOpen()) {
      return true;
    }

    // Try to find a non-live story first
    const topStoryLink = this.getTopStoryTrayLink(true);
    if (topStoryLink) {
      const href = topStoryLink.getAttribute?.('href') || '';
      if (href.startsWith('/stories/')) {
        this.sendStatusMessage('Opening story from Instagram story tray...');
        window.location.assign(this.normalizeInstagramUrl(href) || `https://www.instagram.com${href}`);
        return false;
      }
    }

    // If no non-live story found, check if all stories are live
    const anyStoryLink = this.getTopStoryTrayLink(false);
    if (anyStoryLink && !topStoryLink) {
      this.sendStatusMessage('All visible stories are LIVE. Waiting for non-live stories...');
      await this.wait(3000, 5000);
      return false;
    }

    const clickable = this.getStoryTrayTarget(true);

    if (!clickable && !topStoryLink) {
      return false;
    }

    if (clickable) {
      // Check if it's a live story before clicking
      const storyContainer = clickable.closest('div, li, article') || clickable;
      if (this.isLiveStoryInTray(storyContainer)) {
        this.sendStatusMessage('Story is LIVE, looking for non-live stories...');
        await this.wait(2000, 3000);
        return false;
      }
      
      await this.clickElementReliably(clickable);
      await this.wait(2200, 3400);
      if (this.isStoryViewerOpen()) {
        return true;
      }
    }

    const href =
      clickable?.getAttribute?.('href') ||
      clickable?.querySelector?.('a[href^="/stories/"]')?.getAttribute?.('href') ||
      '';
    if (href.startsWith('/stories/')) {
      this.sendStatusMessage('Opening story from story tray...');
      window.location.assign(this.normalizeInstagramUrl(href) || `https://www.instagram.com${href}`);
      return false;
    }

    await this.wait(2200, 3400);
    return this.isStoryViewerOpen();
  }

  async advanceStory() {
    if (!this.settings.autoScroll) {
      return false;
    }

    const previousIdentity = this.getCurrentStorySnapshot().id;
    let moved = false;
    const nextButton = this.getStoryNavigationButton('next');
    if (nextButton) {
      await this.clickElementReliably(nextButton);
      moved = await this.waitForStoryChange(previousIdentity, 10);
    }

    if (!moved) {
      const titleNode = [...document.querySelectorAll('title')].find((node) => this.getElementText(node) === 'next');
      const titleButton = titleNode?.closest?.('button, div[role="button"]') || titleNode?.parentElement?.closest?.('button, div[role="button"]');
      if (titleButton && this.getVisibleArea(titleButton) > 0) {
        const clicked = await this.clickElementReliably(titleButton);
        if (clicked) {
          moved = await this.waitForStoryChange(previousIdentity, 10);
        }
      }
    }

    if (!moved) {
      const viewer = this.getStoryViewerRoot();
      const rect = viewer?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) {
        const clickX = Math.round(rect.left + rect.width * 0.88);
        const clickY = Math.round(rect.top + rect.height * 0.5);
        const target = document.elementFromPoint(clickX, clickY);
        const clicked = await this.clickElementReliably(target?.closest?.('button, a, div[role="button"]') || target);
        if (clicked) {
          moved = await this.waitForStoryChange(previousIdentity, 10);
        }
      }
    }

    if (!moved) {
      this.dispatchNavigationKey('ArrowRight', 'ArrowRight', 39);
      moved = await this.waitForStoryChange(previousIdentity, 10);
    }

    if (!moved) {
      this.sendStatusMessage('Could not move to the next story yet.');
      return false;
    }

    this.stats.scrolls += 1;
    this.updateStats();
    await this.wait(1200, 2200);
    return true;
  }

  getStoryViewerRoot() {
    const dialog = document.querySelector('div[role="dialog"]');
    if (dialog && this.getVisibleArea(dialog) > 0) {
      return dialog;
    }

    const visibleMedia = this.getCurrentStoryMedia(document).media;
    if (!visibleMedia) {
      return document;
    }

    let current = visibleMedia.parentElement;
    let bestMatch = visibleMedia.parentElement || document;
    let bestScore = -1;

    while (current && current !== document.body) {
      const rect = current.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        current = current.parentElement;
        continue;
      }

      const area = this.getVisibleArea(current);
      if (area <= 0) {
        current = current.parentElement;
        continue;
      }

      const hasStoryLink = Boolean(current.querySelector?.('a[href^="/stories/"]'));
      const hasNavButton = Boolean(
        [...current.querySelectorAll('button, div[role="button"], svg[aria-label], title')].some((node) =>
          /\b(next|previous|prev|forward|back)\b/i.test(this.getNodeIntentText(node))
        )
      );
      const hasProgress = Boolean(current.querySelector?.('div[role="progressbar"], [role="slider"][aria-label*="volume" i]'));
      const score =
        (hasStoryLink ? 450000 : 0) +
        (hasNavButton ? 350000 : 0) +
        (hasProgress ? 250000 : 0) +
        area -
        Math.abs(rect.width - window.innerWidth * 0.35) * 60 -
        Math.abs(rect.height - window.innerHeight * 0.7) * 40;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = current;
      }

      current = current.parentElement;
    }

    return bestMatch || document;
  }

  extractStoryUsername(root = this.getStoryViewerRoot()) {
    const container = root || document;
    const storyLink = container.querySelector('a[href^="/stories/"]')?.getAttribute('href');
    if (storyLink) {
      const parts = storyLink.split('/').filter(Boolean);
      if (parts[0]?.toLowerCase() === 'stories' && parts[1]) {
        return parts[1];
      }
    }

    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts[0]?.toLowerCase() === 'stories' && pathParts[1]) {
      return pathParts[1];
    }

    return this.extractUsername(container);
  }

  extractCanonicalStoryUrl(root = this.getStoryViewerRoot()) {
    const container = root || document;
    const storyLinks = [...container.querySelectorAll('a[href^="/stories/"]')]
      .map((link) => link.getAttribute('href'))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);

    return this.normalizeInstagramUrl(storyLinks[0]) || this.normalizeInstagramUrl(window.location.href);
  }

  getCurrentStoryMedia(root = this.getStoryViewerRoot()) {
    const container = root || document;
    const videos = [...container.querySelectorAll('video')].filter((video) => this.getVisibleArea(video) > 0);
    if (videos.length) {
      return { media: videos[0], mediaType: 'video' };
    }

    const images = [...container.querySelectorAll('img[src]')].filter((image) => this.getVisibleArea(image) > 0);
    if (images.length) {
      return { media: images[0], mediaType: 'image' };
    }

    return { media: null, mediaType: 'unknown' };
  }

  getCurrentStorySnapshot(root = this.getStoryViewerRoot()) {
    const container = root || this.getStoryViewerRoot();
    const username = this.extractStoryUsername(container);
    const storyUrl = this.extractCanonicalStoryUrl(container);
    const { media, mediaType } = this.getCurrentStoryMedia(container);
    const mediaSrc = this.getStableMediaSrc(media) || media?.getAttribute?.('src') || null;
    const caption = this.extractCaption(container) || null;
    const isLive = this.isLiveStory(container);
    const id =
      [storyUrl, username, mediaSrc, caption?.slice(0, 80) || ''].filter(Boolean).join('|') ||
      this.getItemId(container, 'story');

    return {
      id,
      root: container,
      username,
      storyUrl,
      media,
      mediaType,
      mediaSrc,
      caption,
      video: mediaType === 'video' ? media : null,
      image: mediaType === 'image' ? media : null,
      isLive,
    };
  }

  isLiveStory(root = this.getStoryViewerRoot()) {
    const container = root || this.getStoryViewerRoot() || document;
    
    // Check for LIVE badge with the exact Instagram structure
    const liveBadges = container.querySelectorAll('span.x972fbf, span[class*="x972fbf"]');
    for (const badge of liveBadges) {
      const text = badge.textContent?.trim();
      if (text === 'LIVE' || text === 'Live') {
        return true;
      }
    }
    
    // Check for any span with LIVE text
    const allSpans = container.querySelectorAll('span');
    for (const span of allSpans) {
      const text = span.textContent?.trim();
      if (text === 'LIVE') {
        // Verify it's styled like a badge (has padding and border-radius)
        const style = window.getComputedStyle(span);
        if (style.padding !== '0px' || style.borderRadius !== '0px') {
          return true;
        }
      }
    }
    
    // Check for live indicator in story tray (before opening)
    const storyRings = document.querySelectorAll('canvas[style*="linear-gradient"]');
    for (const ring of storyRings) {
      const parent = ring.closest('div');
      if (parent && parent.textContent?.includes('LIVE')) {
        return true;
      }
    }
    
    // Check URL for live story indicators
    const url = window.location.href;
    const hasLiveUrl = url.includes('/live/') || url.includes('live_broadcast');
    
    return hasLiveUrl;
  }

  isLiveStoryInTray(storyElement) {
    if (!storyElement) {
      return false;
    }
    
    let current = storyElement;
    let depth = 0;

    while (current && current !== document.body && depth < 4) {
      const storyLinkCount =
        (current.matches?.('a[href^="/stories/"]') ? 1 : 0) + current.querySelectorAll?.('a[href^="/stories/"]').length;
      if (depth > 0 && storyLinkCount > 1) {
        break;
      }

      const badgeNodes = current.querySelectorAll?.('span, div');
      for (const badge of badgeNodes || []) {
        const text = badge.textContent?.replace(/\s+/g, ' ').trim();
        const label = badge.getAttribute?.('aria-label')?.replace(/\s+/g, ' ').trim();
        if (text === 'LIVE' || text === 'Live' || label === 'LIVE' || label === 'Live') {
          return true;
        }
      }

      const containerText = current.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (/\blive\b/i.test(containerText) && current.querySelector?.('img, canvas')) {
        return true;
      }

      current = current.parentElement;
      depth += 1;
    }

    return false;
  }

  async waitForCurrentStoryReady(root = this.getStoryViewerRoot()) {
    const startedAt = Date.now();
    const timeoutMs = 15000;
    let lastRoot = root || null;

    while (Date.now() - startedAt < timeoutMs) {
      const container = this.getStoryViewerRoot() || lastRoot;
      if (container) {
        lastRoot = container;
        const snapshot = this.getCurrentStorySnapshot(container);
        if (snapshot.mediaType === 'video' && snapshot.video) {
          const ready = await this.waitForVideoPlayback(snapshot.video, 3500);
          if (ready) {
            return { ready: true, ...snapshot };
          }
        } else if (snapshot.mediaType === 'image' && snapshot.image?.complete && snapshot.image.naturalWidth > 0) {
          return { ready: true, ...snapshot };
        }
      }

      await this.wait(500, 900);
    }

    return {
      ready: false,
      ...this.getCurrentStorySnapshot(lastRoot),
    };
  }

  async waitForStoryChange(previousIdentity, attempts = 12) {
    for (let index = 0; index < attempts; index += 1) {
      await this.wait(400, 700);
      if (!this.isStoryViewerOpen()) {
        return true;
      }

      const currentIdentity = this.getCurrentStorySnapshot().id;
      if (currentIdentity && currentIdentity !== previousIdentity) {
        return true;
      }
    }

    return false;
  }

  registerStoryTree(snapshot) {
    const username = snapshot?.username || 'unknown_user';
    let tree = this.storyTrees.get(username);
    if (!tree) {
      tree = {
        storyGroupId: `${username}|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`,
        count: 0,
      };
      this.storyTrees.set(username, tree);
    }

    tree.count += 1;
    return {
      storyGroupId: tree.storyGroupId,
      storyGroupUser: username,
      storyGroupIndex: tree.count,
      storyTreePath: `${username}/${tree.count}`,
      storyTreeDepth: 1,
      storyGroupSeenCount: tree.count,
    };
  }

  async pauseBeforeStoryInteraction(snapshot, token) {
    if (!snapshot?.root || token !== this.runToken) {
      return false;
    }

    if (snapshot.video) {
      await this.waitForVideoPlayback(snapshot.video, 2500);
    }

    await this.mimicHumanPresence(snapshot.root);
    await this.wait(900, 1700);
    return true;
  }

  async finishStoryView(snapshot, token) {
    if (!snapshot?.root || token !== this.runToken) {
      return false;
    }

    if (snapshot.video) {
      const startedAt = Date.now();
      const maxWaitMs = Math.min(
        Math.max(Number.isFinite(snapshot.video.duration) && snapshot.video.duration > 0 ? snapshot.video.duration * 1000 : 6000, 3500),
        15000
      );

      while (token === this.runToken && Date.now() - startedAt < maxWaitMs) {
        if (this.isVideoFinished(snapshot.video)) {
          return true;
        }

        await this.mimicHumanPresence(snapshot.root);
        await this.wait(700, 1100);
      }

      return true;
    }

    await this.mimicHumanPresence(snapshot.root);
    await this.wait(1800, 3200);
    return true;
  }

  getVisiblePostArticle() {
    const articles = [...document.querySelectorAll('article')];
    if (!articles.length) {
      return null;
    }

    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;
    let best = null;
    let bestScore = -1;

    for (const article of articles) {
      const area = this.getVisibleArea(article);
      if (area <= 0) {
        continue;
      }

      const rect = article.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(centerX - viewportCenterX, centerY - viewportCenterY);
      const hasMedia = Boolean(article.querySelector('img[src], video'));
      const hasActions = Boolean(this.findLikeButton(article) || article.querySelector('[role="button"], button'));

      const score = area + (hasMedia ? 150000 : 0) + (hasActions ? 50000 : 0) - distance * 120;
      if (score > bestScore) {
        bestScore = score;
        best = article;
      }
    }

    return best || articles[0] || null;
  }

  getCurrentPostSnapshot(root = this.getVisiblePostArticle()) {
    const article = root || this.getVisiblePostArticle();
    if (!article) {
      return {
        id: null,
        article: null,
        canonicalUrl: null,
        video: null,
        image: null,
        mediaType: 'unknown',
      };
    }

    const video = article.querySelector('video');
    const image = article.querySelector('img[src]');
    return {
      id: this.extractCanonicalPostUrl(article, 'post') || this.getItemId(article, 'post'),
      article,
      canonicalUrl: this.extractCanonicalPostUrl(article, 'post'),
      video,
      image,
      mediaType: video ? 'video' : image ? 'image' : 'unknown',
    };
  }

  isPostReady(article) {
    if (!article || this.getVisibleArea(article) <= 0) {
      return false;
    }

    const video = article.querySelector('video');
    if (video) {
      const videoReady = video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
      const hasActions = Boolean(this.findLikeButton(article) || this.isAlreadyLiked(article));
      return videoReady && hasActions;
    }

    const images = [...article.querySelectorAll('img[src]')];
    if (images.length) {
      const visibleImage = images.find((img) => this.getVisibleArea(img) > 0) || images[0];
      const imageReady = Boolean(visibleImage?.complete && visibleImage.naturalWidth > 0);
      const hasActions = Boolean(this.findLikeButton(article) || this.isAlreadyLiked(article));
      return imageReady && hasActions;
    }

    return false;
  }

  async waitForVisiblePostReady(root = this.getVisiblePostArticle()) {
    const startedAt = Date.now();
    const timeoutMs = 15000;
    let lastArticle = root || null;

    while (Date.now() - startedAt < timeoutMs) {
      const article = this.getVisiblePostArticle() || lastArticle;
      if (article) {
        lastArticle = article;
        article.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
        if (this.isPostReady(article)) {
          return {
            ready: true,
            ...this.getCurrentPostSnapshot(article),
          };
        }
      }

      await this.wait(500, 900);
    }

    return {
      ready: false,
      ...this.getCurrentPostSnapshot(lastArticle),
    };
  }

  async watchCurrentPostMedia(postState, token) {
    const article = postState?.article;
    if (!article || token !== this.runToken) {
      return false;
    }

    const video = article.querySelector('video');
    if (video) {
      this.sendStatusMessage('Waiting for post video to finish...');
      await this.waitForVideoPlayback(video, 5000);

      const maxWatchMs = Math.min(
        Math.max(Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 + 1500 : 7000, 4500),
        20000
      );
      const startedAt = Date.now();
      let lastPresenceAt = 0;
      let lastProgressAt = Date.now();
      let previousTime = video.currentTime || 0;

      while (token === this.runToken && Date.now() - startedAt < maxWatchMs) {
        if (this.isVideoFinished(video)) {
          return true;
        }

        const currentTime = video.currentTime || 0;
        if (currentTime > previousTime + 0.05) {
          previousTime = currentTime;
          lastProgressAt = Date.now();
        }

        if (Date.now() - lastPresenceAt > this.randomBetween(2200, 3600)) {
          await this.mimicHumanPresence(article);
          lastPresenceAt = Date.now();
        }

        if (Date.now() - lastProgressAt > 4500) {
          break;
        }

        await this.wait(500, 900);
      }

      return true;
    }

    this.sendStatusMessage('Waiting for post to fully render...');
    await this.mimicHumanPresence(article);
    await this.wait(2200, 4200);
    return true;
  }

  getReelContainer() {
    const activeVideo = this.getActiveReelVideo(document);
    if (activeVideo) {
      return this.getReelElementRoot(activeVideo);
    }

    const candidates = [...document.querySelectorAll('article, main, div[role="presentation"]')];
    return candidates.find((candidate) => this.isVisible(candidate) && candidate.querySelector('video')) || document;
  }

  async ensureModeContext() {
    if (this.currentMode === 'reels') {
      if (!window.location.pathname.startsWith('/reels') && !window.location.pathname.startsWith('/reel/')) {
        this.sendStatusMessage('Opening Instagram Reels...');
        window.location.assign('https://www.instagram.com/reels/');
        return false;
      }
      return true;
    }

    if (this.currentMode === 'posts') {
      if (window.location.pathname !== '/') {
        this.sendStatusMessage('Opening the Instagram home feed...');
        window.location.assign('https://www.instagram.com/');
        return false;
      }
      return true;
    }

    if (this.currentMode === 'stories') {
      if (window.location.pathname === '/' || this.isStoryPageLocation()) {
        return true;
      }

      if (!window.location.pathname.startsWith('/stories/')) {
        this.sendStatusMessage('Opening the Instagram home feed for stories...');
        window.location.assign('https://www.instagram.com/');
        return false;
      }
    }

    if (this.currentMode === 'search') {
      if (!this.targetUsername) {
        this.sendStatusMessage('No username available for search.');
        return false;
      }

      const currentUsername = window.location.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
      if (currentUsername !== this.targetUsername.toLowerCase()) {
        this.sendStatusMessage(`Opening profile for ${this.targetUsername}...`);
        window.location.assign(`https://www.instagram.com/${encodeURIComponent(this.targetUsername)}/`);
        return false;
      }
      return true;
    }

    return true;
  }

  async processPosts(token) {
    const readyState = await this.waitForVisiblePostReady();
    const article = readyState.article;
    if (!article || !readyState.ready) {
      this.sendStatusMessage('Waiting for posts to load...');
      await this.wait(2000, 3000);
      return;
    }

    const canonicalUrl = readyState.canonicalUrl;
    const itemId = readyState.id || this.getItemId(article, 'post');

    if (!this.currentPostState || this.currentPostState.id !== itemId) {
      this.currentPostState = {
        id: itemId,
        mediaType: readyState.mediaType,
        viewed: false,
      };
    }

    if (!this.processedItems.has(itemId)) {
      this.sendStatusMessage(
        this.currentPostState.mediaType === 'video' ? 'Processing visible video post...' : 'Processing visible post...'
      );

      if (token !== this.runToken) {
        return;
      }

      if (!this.currentPostState.viewed) {
        await this.watchCurrentPostMedia(readyState, token);
        this.currentPostState.viewed = true;
      }

      if (token !== this.runToken) {
        return;
      }

      const alreadyLikedAtStart = this.isAlreadyLiked(article);
      const likedNow = alreadyLikedAtStart ? false : await this.likeCurrentItem(article);

      if (this.settings.dataScrape) {
        await this.saveScrapedData(
          this.extractPostData(article, 'post', {
            canonicalUrl,
            automation: {
              autoLiked: Boolean(likedNow),
              autoAlreadyLiked: Boolean(alreadyLikedAtStart),
            },
          })
        );
      }

      this.processedItems.add(itemId);
    }

    if (token === this.runToken) {
      await this.smoothScrollFeed();
      this.currentPostState = null;
    }
  }

  async processReels(token) {
    const initialContainer = this.getReelContainer();
    const readyState = await this.waitForCurrentReelReady(initialContainer);
    const snapshot = this.getCurrentReelSnapshot(readyState.container || initialContainer);
    const itemId = snapshot.id || this.getItemId(snapshot.container, 'reel');
    const isSponsored = this.isSponsoredReel(snapshot.container);

    if (!this.currentReelState || this.currentReelState.id !== itemId) {
      this.currentReelState = {
        id: itemId,
        scraped: false,
        liked: false,
        alreadyLiked: false,
        sponsored: isSponsored,
      };
    }

    if (isSponsored) {
      this.currentReelState.scraped = true;
      this.currentReelState.liked = true;
      this.sendStatusMessage('Sponsored reel detected. Skipping ad...');
      const moved = await this.advanceReel(false);
      if (!moved) {
        await this.wait(1200, 2200);
      }
      return;
    }

    this.sendStatusMessage(
      readyState.ready
        ? 'Current reel loaded. Waiting until video ends before scroll...'
        : 'Waiting for current reel video to load...'
    );

    if (token !== this.runToken) {
      return;
    }

    const alreadyLikedAtStart = this.isAlreadyLiked(snapshot.container);
    this.currentReelState.alreadyLiked = alreadyLikedAtStart;
    if (!this.currentReelState.liked && !alreadyLikedAtStart) {
      this.currentReelState.liked = await this.likeCurrentItem(snapshot.container);
    }

    this.sendStatusMessage('Waiting for current reel video to end...');
    const finished = await this.waitForReelToFinish(snapshot.container, token);
    if (!finished || token !== this.runToken) {
      return;
    }

    const alreadyLikedAfterFinish = this.isAlreadyLiked(snapshot.container);
    this.currentReelState.alreadyLiked = this.currentReelState.alreadyLiked || alreadyLikedAfterFinish;
    if (!this.currentReelState.liked && !alreadyLikedAfterFinish) {
      let liked = await this.likeCurrentItem(snapshot.container);
      if (!liked && this.settings.autoLike) {
        await this.wait(700, 1200);
        liked = await this.likeCurrentItem(snapshot.container);
      }
      this.currentReelState.liked = liked;
    }

    if (!this.processedItems.has(itemId)) {
      this.processedItems.add(itemId);
    }

    if (token === this.runToken) {
      const moved = await this.advanceReel(true);
      if (this.settings.dataScrape && !this.currentReelState.scraped) {
        const scrapedPayload = this.extractPostData(snapshot.container, 'reel', {
          canonicalUrl: snapshot.reelLink,
          automation: {
            autoLiked: Boolean(this.currentReelState.liked),
            autoAlreadyLiked: Boolean(this.currentReelState.alreadyLiked),
            autoSponsored: Boolean(this.currentReelState.sponsored),
            autoScrollCounted: true,
            autoAdvanced: Boolean(moved),
          },
        });
        const scraped = await this.saveScrapedData(scrapedPayload);
        this.currentReelState.scraped = Boolean(scraped);
      }
      if (!moved) {
        await this.wait(2500, 4000);
      }
    }
  }

  async processStories(token) {
    const viewerReady = await this.openStoryViewer();
    if (!viewerReady) {
      this.sendStatusMessage(
        window.location.pathname === '/' ? 'Opening top story from Instagram story tray...' : 'Waiting for story page...'
      );
      await this.wait(2000, 3000);
      return;
    }

    const readyState = await this.waitForCurrentStoryReady();
    const snapshot = this.getCurrentStorySnapshot(readyState.root || this.getStoryViewerRoot());
    
    // Skip live stories immediately
    if (snapshot.isLive) {
      this.sendStatusMessage(`Skipping LIVE story from ${snapshot.username}...`);
      await this.wait(800, 1200);
      if (token === this.runToken) {
        const moved = await this.advanceStory();
        if (moved) {
          this.currentStoryState = null;
        }
      }
      return;
    }
    
    if (!readyState.ready && snapshot.mediaType === 'unknown') {
      this.sendStatusMessage('Waiting for current story to render...');
      await this.wait(1500, 2500);
      return;
    }

    const itemId = snapshot.id || this.getItemId(snapshot.root, 'story');
    if (!itemId) {
      this.sendStatusMessage('Waiting for current story to render...');
      await this.wait(1500, 2500);
      return;
    }

    if (!this.currentStoryState || this.currentStoryState.id !== itemId) {
      this.currentStoryState = {
        id: itemId,
        username: snapshot.username,
        mediaType: snapshot.mediaType,
        viewed: false,
        liked: false,
        alreadyLiked: false,
        scraped: false,
        tree: null,
      };
    }
    const storyState = this.currentStoryState;

    this.sendStatusMessage(
      readyState.ready
        ? `Processing ${snapshot.mediaType === 'video' ? 'video' : 'image'} story from ${snapshot.username}...`
        : `Waiting for ${snapshot.username}'s story to load...`
    );

    if (token !== this.runToken) {
      return;
    }

    if (!storyState.viewed) {
      await this.pauseBeforeStoryInteraction(snapshot, token);
      if (token !== this.runToken || this.currentStoryState !== storyState) {
        return;
      }
      storyState.viewed = true;
    }

    if (!this.processedItems.has(itemId)) {
      storyState.tree = this.registerStoryTree(snapshot);
      storyState.alreadyLiked = this.isAlreadyLiked(snapshot.root);

      if (!storyState.alreadyLiked && this.settings.autoLike) {
        const liked = await this.likeCurrentItem(snapshot.root);
        if (token !== this.runToken || this.currentStoryState !== storyState) {
          return;
        }
        storyState.liked = liked;
      }

      if (this.settings.dataScrape && !storyState.scraped) {
        const storyData = {
          platform: 'instagram',
          contentType: 'story',
          timestamp: new Date().toISOString(),
          username: snapshot.username,
          channelName: snapshot.username,
          caption: snapshot.caption,
          storyUrl: snapshot.storyUrl,
          imageUrl: snapshot.mediaType === 'image' ? snapshot.mediaSrc : null,
          videoUrl: snapshot.mediaType === 'video' ? snapshot.mediaSrc : null,
          isVideo: snapshot.mediaType === 'video',
          hashtags: snapshot.caption ? snapshot.caption.match(/#\w+/g) || [] : [],
          mentions: snapshot.caption ? snapshot.caption.match(/@\w+/g) || [] : [],
          storyItemId: itemId,
          storyMediaType: snapshot.mediaType,
          uniqueKey: itemId,
          autoLiked: Boolean(storyState.liked),
          autoAlreadyLiked: Boolean(storyState.alreadyLiked),
          autoAdvanced: Boolean(this.settings.autoScroll),
          ...storyState.tree,
        };
        const scraped = await this.saveScrapedData(storyData);
        if (token !== this.runToken || this.currentStoryState !== storyState) {
          return;
        }
        storyState.scraped = Boolean(scraped);
      }

      this.processedItems.add(itemId);
    }

    await this.finishStoryView(snapshot, token);
    if (token === this.runToken && this.currentStoryState === storyState) {
      const moved = await this.advanceStory();
      if (token === this.runToken && this.currentStoryState === storyState && moved) {
        this.currentStoryState = null;
      }
    }
  }

  async followCurrentProfile(token = this.runToken) {
    if (!this.settings.autoFollow || !this.checkDailyLimit('follow')) {
      return { success: false, reason: 'follow-disabled-or-limit' };
    }

    await this.wait(1800, 3200);
    if (token !== this.runToken) {
      return { success: false, reason: 'cancelled' };
    }

    if (this.isUnavailablePage()) {
      return { success: false, reason: 'profile-unavailable' };
    }

    let initialState = this.getFollowButtonState();
    if (['following', 'requested'].includes(initialState.status)) {
      return { success: false, reason: initialState.status };
    }

    if (initialState.status !== 'follow' || !initialState.button) {
      this.getSearchProfileRoot()?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      await this.wait(700, 1200);
      initialState = this.getFollowButtonState();
    }

    if (initialState.status !== 'follow' || !initialState.button) {
      return { success: false, reason: initialState.status };
    }

    this.sendStatusMessage(`Reviewing ${this.targetUsername} before follow request...`);
    await this.humanizeSearchProfileVisit('preClick', initialState.button, token);
    if (token !== this.runToken) {
      return { success: false, reason: 'cancelled' };
    }

    let clicked = await this.clickFollowButton(initialState.button);
    if (!clicked) {
      await this.wait(500, 900);
      const retryState = this.getFollowButtonState();
      if (retryState.status === 'follow' && retryState.button) {
        clicked = await this.clickFollowButton(retryState.button);
      }
    }
    if (!clicked) {
      return { success: false, reason: 'follow-click-failed' };
    }

    const confirmedState = await this.waitForFollowConfirmation();
    if (!['following', 'requested'].includes(confirmedState.status)) {
      return { success: false, reason: confirmedState.status === 'follow' ? 'follow-not-confirmed' : confirmedState.status };
    }

    this.stats.follows += 1;
    this.stats.dailyFollows += 1;
    this.updateStats();
    return { success: true, reason: confirmedState.status };
  }

  async processSearch(token) {
    if (token !== this.runToken || !this.targetUsername) {
      return;
    }

    this.sendStatusMessage(
      `Processing ${this.targetUsername} (${this.searchIndex + 1}/${this.searchTotal || 1})...`
    );

    this.sendStatusMessage(`Waiting on ${this.targetUsername}'s page before any action...`);
    await this.humanizeSearchProfileVisit('browse', null, token);
    if (token !== this.runToken) {
      return;
    }

    const result = await this.followCurrentProfile(token);
    if (token !== this.runToken) {
      return;
    }

    await this.saveScrapedData(this.extractSearchProfileData(this.targetUsername, result));
    if (token !== this.runToken) {
      return;
    }

    this.sendStatusMessage(
      result.success
        ? `Follow request recorded for ${this.targetUsername}. Waiting before next username...`
        : `No follow action for ${this.targetUsername} (${result.reason}). Waiting before next username...`
    );
    await this.humanizeSearchProfileVisit(result.success ? 'postAction' : 'skipAction', null, token);
    if (token !== this.runToken) {
      return;
    }

    this.sendMessage({
      type: 'SEARCH_STEP_RESULT',
      sessionId: this.sessionId,
      username: this.targetUsername,
      success: result.success,
      reason: result.reason,
    });

    this.isRunning = false;
  }

  async run(token) {
    this.stats.sessionStartTime = Date.now();

    if (!(await this.ensureModeContext())) {
      return;
    }

    // Add human behavior delay at start - wait for page to fully render
    this.sendStatusMessage('Waiting for page to fully load...');
    await this.wait(3000, 5000);
    
    if (token !== this.runToken) {
      return;
    }

    if (this.currentMode === 'search') {
      await this.processSearch(token);
      return;
    }

    while (this.isRunning && token === this.runToken) {
      try {
        // Check if extension context is still valid
        if (!this.isRunning) {
          this.sendStatusMessage('Automation stopped due to extension reload.');
          break;
        }
        
        if (this.currentMode === 'posts') {
          await this.processPosts(token);
        } else if (this.currentMode === 'reels') {
          await this.processReels(token);
        } else if (this.currentMode === 'stories') {
          await this.processStories(token);
        }

        await this.wait(1500, 2500);
      } catch (error) {
        console.error('Automation loop error:', error);
        const errorMsg = error?.message || String(error);
        
        // Stop if extension context is invalidated
        if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('message port closed')) {
          this.isRunning = false;
          this.sendStatusMessage('Extension was reloaded. Please restart automation.');
          break;
        }
        
        this.sendStatusMessage('Encountered a page error, retrying...');
        await this.wait(3000, 5000);
      }
    }
  }

  async start(payload) {
    const incomingSessionId = payload.sessionId || null;
    const stored = await this.getStorage(['activeSessionId', 'stats']);
    const isResume = Boolean(incomingSessionId && stored.activeSessionId === incomingSessionId);

    this.runToken += 1;
    this.isRunning = true;
    this.currentMode = payload.mode;
    this.settings = payload.settings || {};
    this.advancedSettings = payload.advancedSettings || {};
    this.sessionId = incomingSessionId;
    this.targetUsername = payload.targetUsername || null;
    this.searchIndex = payload.searchIndex || 0;
    this.searchTotal = payload.searchTotal || 0;

    if (!isResume) {
      this.currentPostState = null;
      this.currentStoryState = null;
      this.currentReelState = null;
      this.storyTrees.clear();
      this.processedItems.clear();
      this.resetSessionStats();
    } else {
      const storedStats = stored?.stats && typeof stored.stats === 'object' ? stored.stats : null;
      if (storedStats) {
        this.stats = {
          ...this.stats,
          ...storedStats,
        };
        this.updateStats();
      }
    }

    chrome.storage.local.set({ activeSessionId: incomingSessionId });

    this.sendMessage({
      type: 'STATUS_UPDATE',
      isRunning: true,
    });

    this.sendStatusMessage(`Preparing ${this.currentMode} automation...`);

    const token = this.runToken;
    try {
      await this.run(token);
    } catch (error) {
      console.error('Failed to start automation:', error);
      this.sendStatusMessage('Failed to start automation on this page.');
    }
  }

  stop({ notify = true } = {}) {
    this.isRunning = false;
    this.runToken += 1;
    this.currentPostState = null;
    this.currentStoryState = null;
    this.currentReelState = null;
    this.storyTrees.clear();
    chrome.storage.local.set({ activeSessionId: null });

    if (notify) {
      this.sendMessage({
        type: 'STATUS_UPDATE',
        isRunning: false,
      });
      this.sendStatusMessage('Automation stopped.');
    }
  }
}

const bot = new InstagramAutomation();
window.instagramBot = bot;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ success: true, ready: true });
    return true;
  }

  if (message.type === 'START_AUTOMATION') {
    bot.start(message);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'STOP_AUTOMATION') {
    bot.stop();
    sendResponse({ success: true });
    return true;
  }

  return false;
});
