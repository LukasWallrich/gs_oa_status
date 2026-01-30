// Background service worker for Unpaywall API calls (CORS workaround)

const UNPAYWALL_BASE = 'https://api.unpaywall.org/v2/';

// Open options page on first install to prompt for email
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});
const CACHE_TTL_DAYS = 7;
const CACHE_KEY_PREFIX = 'oa_cache_';
const DOI_CACHE_KEY_PREFIX = 'doi_cache_';

// Get email from storage or use default
async function getEmail() {
  const result = await chrome.storage.sync.get(['userEmail']);
  return result.userEmail || 'chrome-extension@example.com';
}

// Check if cached data is still valid
function isCacheValid(cached) {
  if (!cached || !cached.timestamp) return false;
  const age = Date.now() - cached.timestamp;
  const maxAge = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  return age < maxAge;
}

// Fetch OA status from Unpaywall
async function fetchOAStatus(doi, email) {
  // DOI should NOT be URL-encoded - Unpaywall expects the raw DOI with slashes
  const url = `${UNPAYWALL_BASE}${doi}?email=${encodeURIComponent(email)}`;

  console.log('[GS-OA] Fetching Unpaywall:', url);

  const response = await fetch(url);

  console.log('[GS-OA] Response status:', response.status, 'for DOI:', doi);

  if (!response.ok) {
    // Try to get error details from response body
    let errorBody = '';
    try {
      errorBody = await response.text();
      console.log('[GS-OA] Error response body:', errorBody);
    } catch (e) {
      console.log('[GS-OA] Could not read error body');
    }

    if (response.status === 404) {
      return { oa_status: 'unknown', error: 'DOI not found' };
    }
    throw new Error(`Unpaywall API error: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();

  return {
    oa_status: data.oa_status || 'closed',
    is_oa: data.is_oa || false,
    best_oa_location: data.best_oa_location ? {
      url: data.best_oa_location.url,
      url_for_pdf: data.best_oa_location.url_for_pdf,
      host_type: data.best_oa_location.host_type,
      license: data.best_oa_location.license,
      version: data.best_oa_location.version
    } : null,
    journal_is_oa: data.journal_is_oa || false
  };
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getOAStatus') {
    handleOAStatusRequest(request.dois)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }

  if (request.action === 'clearCache') {
    clearCache().then(sendResponse);
    return true;
  }

  if (request.action === 'getCacheStats') {
    getCacheStats().then(sendResponse);
    return true;
  }
});

// Process batch of DOIs
async function handleOAStatusRequest(dois) {
  const email = await getEmail();
  const results = {};

  // Check cache first
  const cacheKeys = dois.map(doi => CACHE_KEY_PREFIX + doi);
  const cached = await chrome.storage.local.get(cacheKeys);

  const uncachedDois = [];

  for (const doi of dois) {
    const cacheKey = CACHE_KEY_PREFIX + doi;
    if (cached[cacheKey] && isCacheValid(cached[cacheKey])) {
      results[doi] = cached[cacheKey].data;
    } else {
      uncachedDois.push(doi);
    }
  }

  // Fetch uncached DOIs
  const fetchPromises = uncachedDois.map(async (doi) => {
    try {
      const data = await fetchOAStatus(doi, email);

      // Cache the result
      const cacheKey = CACHE_KEY_PREFIX + doi;
      await chrome.storage.local.set({
        [cacheKey]: {
          data: data,
          timestamp: Date.now()
        }
      });

      results[doi] = data;
    } catch (error) {
      console.error(`Error fetching OA status for ${doi}:`, error);
      results[doi] = { oa_status: 'error', error: error.message };
    }
  });

  await Promise.all(fetchPromises);

  return results;
}

// Clear all cached data (both OA and DOI caches)
async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter(key =>
    key.startsWith(CACHE_KEY_PREFIX) || key.startsWith(DOI_CACHE_KEY_PREFIX)
  );
  await chrome.storage.local.remove(cacheKeys);
  return { cleared: cacheKeys.length };
}

// Get cache statistics
async function getCacheStats() {
  const all = await chrome.storage.local.get(null);

  // Count OA cache entries (have TTL)
  const oaCacheEntries = Object.entries(all).filter(([key]) => key.startsWith(CACHE_KEY_PREFIX));

  let validCount = 0;
  let expiredCount = 0;

  for (const [, value] of oaCacheEntries) {
    if (isCacheValid(value)) {
      validCount++;
    } else {
      expiredCount++;
    }
  }

  // Count DOI cache entries (no expiration)
  const doiCacheCount = Object.keys(all).filter(key => key.startsWith(DOI_CACHE_KEY_PREFIX)).length;

  return {
    total: oaCacheEntries.length + doiCacheCount,
    valid: validCount + doiCacheCount, // DOI entries never expire
    expired: expiredCount,
    oaEntries: oaCacheEntries.length,
    doiEntries: doiCacheCount
  };
}
