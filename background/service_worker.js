const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';

let creating = null;
let offscreenReady = null;
let offscreenReadyResolver = null;
let isRecordingState = false;

chrome.sidePanel.setOptions({
  path: 'sidepanel/sidepanel.html',
  enabled: true
});

async function setupOffscreenDocument(path) {
  // Check if an offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(path)]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create offscreen document with Promise Lock
  if (creating) {
    await creating;
  } else {
    // 1. Initialize the Reverse Handshake Promise BEFORE creating the document
    offscreenReady = new Promise((resolve) => {
      offscreenReadyResolver = resolve;
    });

    // 2. Start document creation
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['USER_MEDIA'],
      justification: 'Recording audio for Mento Lens context capture'
    });
    
    await creating;
    creating = null;
  }

  // 3. Await the Reverse Handshake signal
  // This guarantees the offscreen document's JS has fully parsed and registered its listener
  if (offscreenReady) {
    await offscreenReady;
    offscreenReady = null; // Reset state after it's ready
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message.action;

  // --- ANTICIPATION 2: STATE SYNC ---
  // Allow the sidepanel to ask if we are currently recording so it doesn't reset its UI when closed
  if (action === 'GET_STATE') {
    sendResponse({ isRecording: isRecordingState });
    return false;
  }

  // 1. Handle Reverse Handshake from offscreen document
  if (action === 'OFFSCREEN_READY') {
    if (offscreenReadyResolver) {
      offscreenReadyResolver();
      offscreenReadyResolver = null;
    }
    return false; // Synchronous message, no async response needed
  }

  // 2. Handle commands from the user (e.g. sidepanel or content script)
  if (action === 'START_RECORDING_COMMAND' || action === 'STOP_RECORDING_COMMAND') {
    handleRecordingCommand(message, action, sendResponse);
    return true; // Keep the message channel open for async response
  }

  // 3. Handle screenshot capture request
  if (action === 'CAPTURE_SCREENSHOT') {
    handleScreenshotCapture(sendResponse);
    return true;
  }
});

// --- OPEN SIDEPANEL ON ACTION CLICK ---
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

async function handleRecordingCommand(message, action, sendResponse) {
  try {
    console.log('handleRecordingCommand:', action, 'includeSystemAudio:', message.includeSystemAudio, 'tabStreamId:', message.tabStreamId);

    await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

    const internalAction = action === 'START_RECORDING_COMMAND' ? 'START_RECORDING' : 'STOP_RECORDING';

    const forwardMessage = {
      ...message,
      target: 'offscreen',
      action: internalAction
    };
    console.log('Forwarding to offscreen:', forwardMessage.action, 'tabStreamId:', forwardMessage.tabStreamId);

    const response = await chrome.runtime.sendMessage(forwardMessage);
    
    if (response && response.success) {
      isRecordingState = (action === 'START_RECORDING_COMMAND');
      
      // --- ANTICIPATION 3: OFFSCREEN RESOURCE LEAK ---
      // Offscreen documents are meant to be temporary. If we leave it open,
      // Chrome might terminate the extension or leak resources.
      if (!isRecordingState) {
        await closeOffscreenDocument();
      }
    }
    
    sendResponse(response);
  } catch (error) {
    console.error('Error handling recording command:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length === 0) {
    return;
  }

  const maxRetries = 3;
  const retryDelayMs = 500;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await chrome.offscreen.closeDocument();
      return;
    } catch (err) {
      if (attempt < maxRetries) {
        console.warn(`Failed to close offscreen document (attempt ${attempt}/${maxRetries}), retrying...`, err);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      } else {
        console.warn('Failed to close offscreen document after all retries:', err);
      }
    }
  }
}

// --- SCREENSHOT CAPTURE ---
async function handleScreenshotCapture(sendResponse) {
  try {
    // Get the current active tab to check its URL
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    // Check if we have a valid active tab
    if (!activeTab) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    // Avoid capturing chrome:// pages (extensions page, settings, etc.)
    if (activeTab.url && activeTab.url.startsWith('chrome://')) {
      sendResponse({ success: false, error: 'Cannot capture chrome:// pages' });
      return;
    }

    // Avoid capturing edge:// pages (Edge browser internal pages)
    if (activeTab.url && activeTab.url.startsWith('edge://')) {
      sendResponse({ success: false, error: 'Cannot capture edge:// pages' });
      return;
    }

    // Check if the tab has a valid URL (not about:blank, etc.)
    if (!activeTab.url || activeTab.url.startsWith('about:') || activeTab.url.startsWith('data:')) {
      sendResponse({ success: false, error: 'Cannot capture this page type' });
      return;
    }

    // Use the active tab's windowId for capture to ensure we have permission
    // Note: activeTab permission only grants access to the tab when user interacts with extension
    // If this fails, we may need to use chrome.scripting.executeScript to get user gesture context
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'png' });
      sendResponse({ success: true, screenshotBase64: dataUrl });
    } catch (captureError) {
      // If capture fails due to permission, try without windowId as fallback
      if (captureError.message && captureError.message.includes('permission')) {
        console.warn('Window-specific capture failed, trying generic capture...');
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        sendResponse({ success: true, screenshotBase64: dataUrl });
      } else {
        throw captureError;
      }
    }
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ==========================================
// 🛠️ DEBUGGING & TESTING HELPERS
// ==========================================
// If you are testing in the Service Worker Console, you MUST use these functions.
// DO NOT use `chrome.runtime.sendMessage` directly in the SW console.
self.TEST_START_RECORDING = () => {
  console.log("Simulating START_RECORDING_COMMAND from popup...");
  handleRecordingCommand({ action: 'START_RECORDING_COMMAND' }, 'START_RECORDING_COMMAND', console.log);
};

self.TEST_STOP_RECORDING = () => {
  console.log("Simulating STOP_RECORDING_COMMAND from popup...");
  handleRecordingCommand({ action: 'STOP_RECORDING_COMMAND' }, 'STOP_RECORDING_COMMAND', console.log);
};
