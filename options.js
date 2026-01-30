// Options page script

const enableToggle = document.getElementById('enableToggle');
const userEmail = document.getElementById('userEmail');
const saveEmailBtn = document.getElementById('saveEmail');
const emailWarning = document.getElementById('emailWarning');
const emailStatus = document.getElementById('emailStatus');
const showGold = document.getElementById('showGold');
const showGreen = document.getElementById('showGreen');
const showBronze = document.getElementById('showBronze');
const showHybrid = document.getElementById('showHybrid');
const showClosed = document.getElementById('showClosed');
const refreshStatsBtn = document.getElementById('refreshStats');
const clearCacheBtn = document.getElementById('clearCache');
const messageEl = document.getElementById('message');
const statTotal = document.getElementById('statTotal');
const statValid = document.getElementById('statValid');
const statExpired = document.getElementById('statExpired');

// Update email status display
function updateEmailStatus(email) {
  if (email && email.trim()) {
    emailWarning.style.display = 'none';
    emailStatus.className = 'email-status set';
    emailStatus.textContent = `Configured: ${email}`;
  } else {
    emailWarning.style.display = 'block';
    emailStatus.className = 'email-status not-set';
    emailStatus.textContent = 'Not configured - extension will not work';
  }
}

// Load saved settings
function loadSettings() {
  chrome.storage.sync.get(['enabled', 'userEmail', 'visibleTypes'], (result) => {
    enableToggle.checked = result.enabled !== false;
    userEmail.value = result.userEmail || '';
    updateEmailStatus(result.userEmail);

    const types = result.visibleTypes || ['gold', 'green', 'bronze', 'hybrid'];
    showGold.checked = types.includes('gold');
    showGreen.checked = types.includes('green');
    showBronze.checked = types.includes('bronze');
    showHybrid.checked = types.includes('hybrid');
    showClosed.checked = types.includes('closed');
  });
}

// Save email
function saveEmail() {
  const email = userEmail.value.trim();

  if (!email) {
    showMessage('Please enter an email address', 'error');
    return;
  }

  // Basic email validation
  if (!email.includes('@') || !email.includes('.')) {
    showMessage('Please enter a valid email address', 'error');
    return;
  }

  chrome.storage.sync.set({ userEmail: email }, () => {
    updateEmailStatus(email);
    showMessage('Email saved successfully', 'success');
  });
}

// Save other settings (not email)
function saveSettings() {
  const visibleTypes = [];
  if (showGold.checked) visibleTypes.push('gold');
  if (showGreen.checked) visibleTypes.push('green');
  if (showBronze.checked) visibleTypes.push('bronze');
  if (showHybrid.checked) visibleTypes.push('hybrid');
  if (showClosed.checked) visibleTypes.push('closed');

  chrome.storage.sync.set({
    enabled: enableToggle.checked,
    visibleTypes: visibleTypes
  }, () => {
    showMessage('Settings saved', 'success');
  });
}

// Show message
function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;

  setTimeout(() => {
    messageEl.className = 'message';
  }, 3000);
}

// Load cache stats
function loadCacheStats() {
  chrome.runtime.sendMessage({ action: 'getCacheStats' }, (response) => {
    if (response) {
      statTotal.textContent = response.total || 0;
      statValid.textContent = response.valid || 0;
      statExpired.textContent = response.expired || 0;
    }
  });
}

// Clear cache
function clearCache() {
  chrome.runtime.sendMessage({ action: 'clearCache' }, (response) => {
    if (response && response.cleared !== undefined) {
      showMessage(`Cleared ${response.cleared} cached entries`, 'success');
      loadCacheStats();
    } else {
      showMessage('Failed to clear cache', 'error');
    }
  });
}

// Event listeners
saveEmailBtn.addEventListener('click', saveEmail);
userEmail.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') saveEmail();
});
enableToggle.addEventListener('change', saveSettings);
showGold.addEventListener('change', saveSettings);
showGreen.addEventListener('change', saveSettings);
showBronze.addEventListener('change', saveSettings);
showHybrid.addEventListener('change', saveSettings);
showClosed.addEventListener('change', saveSettings);
refreshStatsBtn.addEventListener('click', loadCacheStats);
clearCacheBtn.addEventListener('click', clearCache);

// Initialize
loadSettings();
loadCacheStats();
