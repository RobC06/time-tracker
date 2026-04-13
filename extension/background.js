// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Allow side panel to be opened on all sites
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
