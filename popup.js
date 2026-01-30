// Popup script for quick toggle

const enableToggle = document.getElementById('enableToggle');
const statusEl = document.getElementById('status');
const optionsLink = document.getElementById('optionsLink');

// Load current state
chrome.storage.sync.get(['enabled'], (result) => {
  enableToggle.checked = result.enabled !== false;
  updateStatus(enableToggle.checked);
});

// Handle toggle change
enableToggle.addEventListener('change', () => {
  const enabled = enableToggle.checked;
  chrome.storage.sync.set({ enabled }, () => {
    updateStatus(enabled);

    // Reload active Google Scholar tabs
    chrome.tabs.query({ url: '*://scholar.google.*/*' }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.reload(tab.id);
      }
    });
  });
});

// Update status text
function updateStatus(enabled) {
  statusEl.textContent = enabled ? 'Active on Google Scholar' : 'Disabled';
}

// Open options page
optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
