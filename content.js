// Content script for Google Scholar OA Status extension

const OPENALEX_BASE = 'https://api.openalex.org/works';
const DOI_CACHE_KEY_PREFIX = 'doi_cache_';
const BATCH_SIZE = 10;

// SVG icons for different OA statuses (open and closed padlocks)
const LOCK_ICONS = {
  // Open padlock for OA content
  open: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>
  </svg>`,
  // Closed padlock for closed access
  closed: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
  </svg>`
};

// OA status display configuration
const OA_CONFIG = {
  gold: {
    label: 'Gold OA',
    description: 'Published open access',
    cssClass: 'oa-badge-gold',
    icon: 'open'
  },
  green: {
    label: 'Green OA',
    description: 'Repository version available',
    cssClass: 'oa-badge-green',
    icon: 'open'
  },
  bronze: {
    label: 'Bronze OA',
    description: 'Free to read (no license)',
    cssClass: 'oa-badge-bronze',
    icon: 'open'
  },
  hybrid: {
    label: 'Hybrid OA',
    description: 'Open access in subscription journal',
    cssClass: 'oa-badge-hybrid',
    icon: 'open'
  },
  closed: {
    label: 'Closed Access',
    description: 'Subscription required',
    cssClass: 'oa-badge-closed',
    icon: 'closed'
  },
  unknown: {
    label: 'Unknown',
    description: 'Not found in Unpaywall',
    cssClass: 'oa-badge-closed',
    icon: 'closed'
  }
};

// Get email from storage
async function getEmail() {
  const result = await chrome.storage.sync.get(['userEmail']);
  return result.userEmail || 'chrome-extension@example.com';
}

// Check if extension is enabled
async function isEnabled() {
  const result = await chrome.storage.sync.get(['enabled']);
  return result.enabled !== false; // Default to enabled
}

// Get which OA types to show
async function getVisibleTypes() {
  const result = await chrome.storage.sync.get(['visibleTypes']);
  return result.visibleTypes || ['gold', 'green', 'bronze', 'hybrid']; // Don't show closed by default
}

// Normalize title for matching
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate similarity between two strings (for fuzzy matching)
function similarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }

  return (longer.length - costs[s2.length]) / longer.length;
}

// Extract DOI from a result element by searching all links
function extractDoiFromElement(element) {
  // DOI regex pattern
  const doiPattern = /10\.\d{4,}\/[^\s"<>?&#]+/;

  // Search in all links within the result
  const links = element.querySelectorAll('a[href]');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const match = href.match(doiPattern);
    if (match) {
      // Clean up the DOI (remove trailing punctuation)
      return match[0].replace(/[.,;:)\]]+$/, '');
    }
  }

  // Also search in the HTML text content for DOI patterns (some pages show DOI as text)
  const textContent = element.textContent || '';
  const textMatch = textContent.match(doiPattern);
  if (textMatch) {
    return textMatch[0].replace(/[.,;:)\]]+$/, '');
  }

  return null;
}

// Extract article data from Google Scholar results
function extractArticles() {
  const articles = [];
  const results = document.querySelectorAll('.gs_r.gs_or.gs_scl');

  for (const result of results) {
    // Skip if already processed
    if (result.dataset.oaProcessed) continue;

    const titleElement = result.querySelector('.gs_rt a');
    if (!titleElement) continue;

    const title = titleElement.textContent.trim();
    const metaElement = result.querySelector('.gs_a');
    const meta = metaElement ? metaElement.textContent : '';

    // Try to extract DOI directly from the result element
    const extractedDoi = extractDoiFromElement(result);

    articles.push({
      element: result,
      titleElement: titleElement,
      title: title,
      normalizedTitle: normalizeTitle(title),
      meta: meta,
      extractedDoi: extractedDoi  // DOI found in page, if any
    });

    result.dataset.oaProcessed = 'true';
  }

  return articles;
}

// Add loading spinner after title
function addLoadingSpinner(titleElement) {
  const spinner = document.createElement('span');
  spinner.className = 'oa-loading-spinner';
  spinner.dataset.oaSpinner = 'true';
  titleElement.parentNode.insertBefore(spinner, titleElement.nextSibling);
  return spinner;
}

// Remove loading spinner
function removeLoadingSpinner(titleElement) {
  const parent = titleElement.parentNode;
  const spinner = parent.querySelector('[data-oa-spinner="true"]');
  if (spinner) spinner.remove();
}

// Create OA badge element
function createBadge(oaStatus, oaData) {
  const config = OA_CONFIG[oaStatus] || OA_CONFIG.closed;

  const badge = document.createElement('a');
  badge.className = `oa-status-badge ${config.cssClass}`;
  badge.innerHTML = LOCK_ICONS[config.icon];

  // Simple tooltip - detailed info is in the DOI popup
  badge.title = `${config.label} - Click for details`;

  // Link to OA version if available
  if (oaData.best_oa_location && oaData.best_oa_location.url) {
    badge.href = oaData.best_oa_location.url;
    badge.target = '_blank';
    badge.rel = 'noopener noreferrer';
    badge.title = `${config.label} - Click to open`;
  } else {
    badge.style.cursor = 'default';
  }

  return badge;
}

// Add badge to article and update DOI indicator with OA data
function addBadge(titleElement, oaStatus, oaData, visibleTypes) {
  removeLoadingSpinner(titleElement);

  // Always update the DOI indicator with OA data (for popup)
  const doiIndicator = titleElement.parentNode.querySelector('.doi-indicator');
  if (doiIndicator) {
    doiIndicator.dataset.oaData = JSON.stringify(oaData);
  }

  // Never show badge for 'unknown' status - we don't know if it's OA or not
  if (oaStatus === 'unknown') {
    return;
  }

  // Check if this OA type should be shown
  if (!visibleTypes.includes(oaStatus) && oaStatus !== 'closed') {
    return;
  }

  // Don't show closed access badges unless explicitly enabled
  if (oaStatus === 'closed' && !visibleTypes.includes('closed')) {
    return;
  }

  const badge = createBadge(oaStatus, oaData);
  titleElement.parentNode.insertBefore(badge, titleElement.nextSibling);
}

// Global popup management
let activePopup = null;

function closeActivePopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}

// Close popup when clicking outside
document.addEventListener('click', (e) => {
  if (activePopup && !activePopup.contains(e.target) && !e.target.classList.contains('doi-indicator')) {
    closeActivePopup();
  }
});

// Copy to clipboard helper
async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied!';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = 'Copy';
      button.classList.remove('copied');
    }, 1500);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
}

// Create popup element
function createPopup(doiInfo, oaData) {
  const popup = document.createElement('div');
  popup.className = 'gs-oa-popup';

  // OA Status (if available)
  if (oaData && oaData.oa_status) {
    const isOpen = oaData.is_oa || ['gold', 'green', 'bronze', 'hybrid'].includes(oaData.oa_status);
    const statusDiv = document.createElement('div');
    statusDiv.className = `gs-oa-popup-status ${isOpen ? 'oa-open' : 'oa-closed'}`;

    const dot = document.createElement('span');
    dot.className = 'gs-oa-popup-status-dot';
    statusDiv.appendChild(dot);

    const config = OA_CONFIG[oaData.oa_status] || OA_CONFIG.closed;
    const statusText = document.createElement('span');
    statusText.textContent = config.label;
    statusDiv.appendChild(statusText);

    popup.appendChild(statusDiv);
  }

  // DOI row (if found)
  if (doiInfo.found && doiInfo.doi) {
    const doiRow = document.createElement('div');
    doiRow.className = 'gs-oa-popup-row';

    const doiLabel = document.createElement('span');
    doiLabel.className = 'gs-oa-popup-label';
    doiLabel.textContent = 'DOI';
    doiRow.appendChild(doiLabel);

    const doiValue = document.createElement('span');
    doiValue.className = 'gs-oa-popup-value';
    const doiLink = document.createElement('a');
    doiLink.href = `https://doi.org/${doiInfo.doi}`;
    doiLink.target = '_blank';
    doiLink.rel = 'noopener noreferrer';
    doiLink.textContent = doiInfo.doi;
    doiValue.appendChild(doiLink);
    doiRow.appendChild(doiValue);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'gs-oa-popup-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(doiInfo.doi, copyBtn);
    });
    doiRow.appendChild(copyBtn);

    popup.appendChild(doiRow);
  }

  // OA Link row (if available)
  if (oaData && oaData.best_oa_location && oaData.best_oa_location.url) {
    const oaRow = document.createElement('div');
    oaRow.className = 'gs-oa-popup-row';

    const oaLabel = document.createElement('span');
    oaLabel.className = 'gs-oa-popup-label';
    oaLabel.textContent = 'OA Link';
    oaRow.appendChild(oaLabel);

    const oaValue = document.createElement('span');
    oaValue.className = 'gs-oa-popup-value';
    const oaLink = document.createElement('a');
    oaLink.href = oaData.best_oa_location.url;
    oaLink.target = '_blank';
    oaLink.rel = 'noopener noreferrer';
    // Truncate long URLs for display
    const displayUrl = oaData.best_oa_location.url.length > 40
      ? oaData.best_oa_location.url.substring(0, 40) + '...'
      : oaData.best_oa_location.url;
    oaLink.textContent = displayUrl;
    oaValue.appendChild(oaLink);
    oaRow.appendChild(oaValue);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'gs-oa-popup-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(oaData.best_oa_location.url, copyBtn);
    });
    oaRow.appendChild(copyBtn);

    popup.appendChild(oaRow);
  }

  // Not found message
  if (!doiInfo.found) {
    const notFound = document.createElement('div');
    notFound.className = 'gs-oa-popup-notfound';
    notFound.textContent = 'No DOI found for this article';
    popup.appendChild(notFound);
  }

  return popup;
}

// Show popup near indicator
function showPopup(indicator, doiInfo, oaData) {
  closeActivePopup();

  const popup = createPopup(doiInfo, oaData);
  document.body.appendChild(popup);
  activePopup = popup;

  // Position popup
  const rect = indicator.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();

  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 5;

  // Keep popup within viewport
  if (left + popupRect.width > window.innerWidth) {
    left = window.innerWidth - popupRect.width - 10;
  }
  if (top + popupRect.height > window.innerHeight + window.scrollY) {
    top = rect.top + window.scrollY - popupRect.height - 5;
  }

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

// Create DOI indicator element
function createDoiIndicator(doiInfo) {
  const indicator = document.createElement('span');
  indicator.className = `doi-indicator ${doiInfo.found ? 'doi-found' : 'doi-not-found'}`;
  indicator.textContent = '●';

  // Store data for popup
  indicator.dataset.doiInfo = JSON.stringify(doiInfo);

  // Click handler to show popup
  indicator.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const storedDoiInfo = JSON.parse(indicator.dataset.doiInfo);
    const storedOaData = indicator.dataset.oaData ? JSON.parse(indicator.dataset.oaData) : null;
    showPopup(indicator, storedDoiInfo, storedOaData);
  });

  return indicator;
}

// Add DOI indicator after title
function addDoiIndicator(titleElement, doiInfo) {
  const indicator = createDoiIndicator(doiInfo);
  titleElement.parentNode.insertBefore(indicator, titleElement.nextSibling);
}

// Query OpenAlex for DOIs - returns objects with DOI and match metadata
async function queryOpenAlex(titles, email) {
  // Check cache first
  const cacheKeys = titles.map(t => DOI_CACHE_KEY_PREFIX + normalizeTitle(t));
  const cached = await chrome.storage.local.get(cacheKeys);

  const results = {};
  const uncachedTitles = [];

  for (const title of titles) {
    const cacheKey = DOI_CACHE_KEY_PREFIX + normalizeTitle(title);
    if (cached[cacheKey]) {
      // Cached results - reconstruct info object
      const cachedData = cached[cacheKey];
      if (typeof cachedData === 'string') {
        // Old cache format (just DOI string)
        results[normalizeTitle(title)] = {
          found: true,
          doi: cachedData,
          matchedTitle: '(cached)',
          matchScore: 1.0,
          searchedTitle: title
        };
      } else {
        results[normalizeTitle(title)] = cachedData;
      }
    } else {
      uncachedTitles.push(title);
    }
  }

  if (uncachedTitles.length === 0) {
    return results;
  }

  // Build batch query - strip problematic characters for OpenAlex filter syntax
  // OpenAlex title.search uses : for filter syntax, so we remove punctuation
  // The | character is the OR operator and must NOT be encoded
  const cleanTitle = (t) => t
    .replace(/[:\(\)\[\]&|\\,;'"]/g, ' ')  // Remove punctuation that breaks filters
    .replace(/\s+/g, ' ')                   // Collapse whitespace
    .trim();

  const searchTerms = uncachedTitles
    .map(t => encodeURIComponent(cleanTitle(t)))
    .join('|');  // | must stay unencoded for OR operation

  const url = `${OPENALEX_BASE}?filter=title.search:${searchTerms}&select=id,doi,title&per_page=50&mailto=${encodeURIComponent(email)}`;

  console.log('[GS-OA] OpenAlex query URL:', url);

  // Track which titles we've matched
  const matchedTitles = new Set();

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error('OpenAlex API error:', response.status);
      // Mark all as not found
      for (const title of uncachedTitles) {
        results[normalizeTitle(title)] = {
          found: false,
          searchedTitle: title,
          error: `API error: ${response.status}`
        };
      }
      return results;
    }

    const data = await response.json();

    console.log('[GS-OA] OpenAlex returned', data.results?.length || 0, 'results for', uncachedTitles.length, 'titles');

    // Match results to original titles
    for (const work of (data.results || [])) {
      if (!work.doi || !work.title) continue;

      const workNormalized = normalizeTitle(work.title);

      // Find best matching title
      let bestMatch = null;
      let bestMatchOriginal = null;
      let bestScore = 0;

      for (const title of uncachedTitles) {
        if (matchedTitles.has(title)) continue; // Skip already matched

        const titleNormalized = normalizeTitle(title);
        const score = similarity(workNormalized, titleNormalized);

        if (score > bestScore && score > 0.8) {
          bestScore = score;
          bestMatch = titleNormalized;
          bestMatchOriginal = title;
        }
      }

      if (bestMatch && bestMatchOriginal) {
        matchedTitles.add(bestMatchOriginal);

        // Extract DOI from URL format if needed
        let doi = work.doi;
        if (doi.startsWith('https://doi.org/')) {
          doi = doi.replace('https://doi.org/', '');
        }

        const doiInfo = {
          found: true,
          doi: doi,
          matchedTitle: work.title,
          matchScore: bestScore,
          searchedTitle: bestMatchOriginal,
          source: 'openalex'
        };

        results[bestMatch] = doiInfo;

        // Cache the result
        const cacheKey = DOI_CACHE_KEY_PREFIX + bestMatch;
        chrome.storage.local.set({ [cacheKey]: doiInfo });
      }
    }

    // Mark unmatched titles as not found
    for (const title of uncachedTitles) {
      const normalized = normalizeTitle(title);
      if (!results[normalized]) {
        results[normalized] = {
          found: false,
          searchedTitle: title,
          source: 'openalex'
        };
        // Cache negative result too (to avoid repeated lookups)
        const cacheKey = DOI_CACHE_KEY_PREFIX + normalized;
        chrome.storage.local.set({ [cacheKey]: results[normalized] });
      }
    }
  } catch (error) {
    console.error('Error querying OpenAlex:', error);
    // Mark all as not found with error
    for (const title of uncachedTitles) {
      results[normalizeTitle(title)] = {
        found: false,
        searchedTitle: title,
        error: error.message
      };
    }
  }

  return results;
}

// Main processing function
async function processArticles() {
  // Check if enabled
  if (!await isEnabled()) return;

  const email = await getEmail();
  const visibleTypes = await getVisibleTypes();
  const articles = extractArticles();

  if (articles.length === 0) return;

  // Add loading spinners
  for (const article of articles) {
    addLoadingSpinner(article.titleElement);
  }

  // Process in batches
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);

    // Separate articles with extracted DOIs from those needing OpenAlex lookup
    const articlesWithDoi = [];
    const articlesNeedingLookup = [];

    for (const article of batch) {
      if (article.extractedDoi) {
        articlesWithDoi.push(article);
      } else {
        articlesNeedingLookup.push(article);
      }
    }

    console.log(`[GS-OA] Batch: ${articlesWithDoi.length} with DOI from page, ${articlesNeedingLookup.length} need OpenAlex lookup`);

    // Get DOIs from OpenAlex for articles that don't have them
    let doiMap = {};
    if (articlesNeedingLookup.length > 0) {
      const titles = articlesNeedingLookup.map(a => a.title);
      doiMap = await queryOpenAlex(titles, email);
    }

    // Collect all DOIs for Unpaywall query
    const doisToQuery = [];
    const articleDoiInfo = new Map();

    // Process articles with DOIs extracted from page
    for (const article of articlesWithDoi) {
      const doiInfo = {
        found: true,
        doi: article.extractedDoi,
        matchedTitle: '(from page)',
        matchScore: 1.0,
        searchedTitle: article.title,
        source: 'page'
      };

      removeLoadingSpinner(article.titleElement);
      addDoiIndicator(article.titleElement, doiInfo);

      doisToQuery.push(article.extractedDoi);
      articleDoiInfo.set(article.normalizedTitle, doiInfo);
    }

    // Process articles that needed OpenAlex lookup
    for (const article of articlesNeedingLookup) {
      const doiInfo = doiMap[article.normalizedTitle];

      removeLoadingSpinner(article.titleElement);
      addDoiIndicator(article.titleElement, doiInfo || { found: false, searchedTitle: article.title, source: 'openalex' });

      if (doiInfo && doiInfo.found && doiInfo.doi) {
        doisToQuery.push(doiInfo.doi);
        articleDoiInfo.set(article.normalizedTitle, doiInfo);
      }
    }

    if (doisToQuery.length === 0) continue;

    // Get OA status from Unpaywall via background script
    const oaResults = await chrome.runtime.sendMessage({
      action: 'getOAStatus',
      dois: doisToQuery
    });

    if (oaResults.error) {
      console.error('Error getting OA status:', oaResults.error);
      continue;
    }

    // Add OA badges
    for (const article of batch) {
      const doiInfo = articleDoiInfo.get(article.normalizedTitle);
      if (doiInfo && doiInfo.doi && oaResults[doiInfo.doi]) {
        const oaData = oaResults[doiInfo.doi];
        addBadge(article.titleElement, oaData.oa_status, oaData, visibleTypes);
      }
    }
  }
}

// Set up MutationObserver for dynamic content
function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    let hasNewResults = false;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.('.gs_r.gs_or.gs_scl') ||
                node.querySelector?.('.gs_r.gs_or.gs_scl')) {
              hasNewResults = true;
              break;
            }
          }
        }
      }
      if (hasNewResults) break;
    }

    if (hasNewResults) {
      // Debounce processing
      clearTimeout(window.oaProcessTimeout);
      window.oaProcessTimeout = setTimeout(processArticles, 300);
    }
  });

  const container = document.querySelector('#gs_res_ccl_mid');
  if (container) {
    observer.observe(container, { childList: true, subtree: true });
  }
}

// Initialize
async function init() {
  if (!await isEnabled()) {
    console.log('GS OA Status: Extension is disabled');
    return;
  }

  // Process existing articles
  await processArticles();

  // Watch for new articles
  setupObserver();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
