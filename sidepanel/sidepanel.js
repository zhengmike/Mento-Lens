document.addEventListener('DOMContentLoaded', async () => {
  const recordBtn = document.getElementById('recordBtn');
  const btnText = document.getElementById('btnText');
  const statusText = document.getElementById('statusText');
  const storageCountEl = document.getElementById('storageCountLink');
  const visualizerContainer = document.getElementById('visualizer');
  const visualizerBars = document.querySelectorAll('.bar');
  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNumber = document.getElementById('countdownNumber');
  const countdownCancel = document.getElementById('countdownCancel');
  const countdownStartNow = document.getElementById('countdownStartNow');
  const stopDialogOverlay = document.getElementById('stopDialogOverlay');
  const stopDialogView = document.getElementById('stopDialogView');
  const micSelect = document.getElementById('micSelect');
  const systemAudioCheckbox = document.getElementById('systemAudioCheckbox');
  let isRecording = false;
  let countdownInterval = null;
  let countdownValue = 3;
  let selectedDeviceId = null;

  async function openHistoryPage() {
    const historyUrl = chrome.runtime.getURL('history/history.html');
    const tabs = await chrome.tabs.query({ url: historyUrl });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: historyUrl });
    }
  }

  // --- DEVICE ENUMERATION ---
  async function loadAudioDevices() {
    try {
      // Request permission first to get device labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(track => track.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');

      micSelect.innerHTML = '';
      if (audioInputs.length === 0) {
        micSelect.innerHTML = '<option value="">No microphone found</option>';
        return;
      }

      audioInputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        micSelect.appendChild(option);
      });

      // Select first device by default
      selectedDeviceId = audioInputs[0].deviceId;
      micSelect.value = selectedDeviceId;
    } catch (error) {
      console.error('Failed to load audio devices:', error);
      micSelect.innerHTML = '<option value="">Permission denied</option>';
    }
  }

  micSelect.addEventListener('change', (e) => {
    selectedDeviceId = e.target.value;
  });

  // Load devices on startup
  loadAudioDevices();

  // --- LOCAL AUDIO VISUALIZATION ---
  // We create our own audio analysis pipeline directly in the popup
  // This is more reliable than receiving data from offscreen document
  let localAudioContext = null;
  let localAnalyser = null;
  let localDataArray = null;
  let localAnimationId = null;
  let localStream = null;

  let systemAudioRecorder = null;
  let systemAudioChunks = [];
  let systemAudioStream = null;
  let systemMicStream = null;
  let systemMicRecorder = null;
  let systemMicChunks = [];

  async function startLocalVisualization() {
    try {
      const constraints = selectedDeviceId 
        ? { audio: { deviceId: { exact: selectedDeviceId } } }
        : { audio: true };
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (localAudioContext.state === 'suspended') {
        await localAudioContext.resume();
      }
      const source = localAudioContext.createMediaStreamSource(localStream);
      localAnalyser = localAudioContext.createAnalyser();
      localAnalyser.fftSize = 64;
      localAnalyser.smoothingTimeConstant = 0.7;
      source.connect(localAnalyser);

      const bufferLength = localAnalyser.frequencyBinCount;
      localDataArray = new Uint8Array(bufferLength);

      function analyze() {
        if (!isRecording) return;
        localAnalyser.getByteFrequencyData(localDataArray);

        // Map each bar to a frequency band
        const bars = visualizerBars.length;
        const binsPerBar = Math.floor(bufferLength / bars);

        visualizerBars.forEach((bar, index) => {
          const start = index * binsPerBar;
          const end = start + binsPerBar;
          let sum = 0;
          for (let i = start; i < end; i++) {
            sum += localDataArray[i];
          }
          const avg = sum / binsPerBar;
          // Boost sensitivity
          const normalized = Math.min(Math.max((avg * 3.5) / 255, 0), 1);

          const minHeight = 4;
          const maxHeight = 30;
          const height = minHeight + normalized * (maxHeight - minHeight);
          bar.style.height = `${height}px`;
        });

        localAnimationId = requestAnimationFrame(analyze);
      }

      analyze();
    } catch (err) {
      console.error('Local visualization error:', err);
    }
  }

  function stopLocalVisualization() {
    if (localAnimationId) {
      cancelAnimationFrame(localAnimationId);
      localAnimationId = null;
    }
    if (localAudioContext) {
      localAudioContext.close();
      localAudioContext = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    localAnalyser = null;
    localDataArray = null;
    // Reset bars
    visualizerBars.forEach(bar => bar.style.height = '4px');
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read blob'));
    });
  }

  async function startSystemAudioVisualization(stream) {
    try {
      localAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (localAudioContext.state === 'suspended') {
        await localAudioContext.resume();
      }
      const source = localAudioContext.createMediaStreamSource(stream);
      localAnalyser = localAudioContext.createAnalyser();
      localAnalyser.fftSize = 64;
      localAnalyser.smoothingTimeConstant = 0.7;
      source.connect(localAnalyser);

      const bufferLength = localAnalyser.frequencyBinCount;
      localDataArray = new Uint8Array(bufferLength);

      function analyze() {
        if (!isRecording) return;
        localAnalyser.getByteFrequencyData(localDataArray);

        const bars = visualizerBars.length;
        const binsPerBar = Math.floor(bufferLength / bars);

        visualizerBars.forEach((bar, index) => {
          const start = index * binsPerBar;
          const end = start + binsPerBar;
          let sum = 0;
          for (let i = start; i < end; i++) {
            sum += localDataArray[i];
          }
          const avg = sum / binsPerBar;
          const normalized = Math.min(Math.max((avg * 3.5) / 255, 0), 1);

          const minHeight = 4;
          const maxHeight = 30;
          const height = minHeight + normalized * (maxHeight - minHeight);
          bar.style.height = `${height}px`;
        });

        localAnimationId = requestAnimationFrame(analyze);
      }

      analyze();
    } catch (err) {
      console.error('System audio visualization error:', err);
    }
  }

  // Fetch and display initial storage count
  async function refreshStorageCount() {
    try {
      const count = await window.MentoStorage.getRecordCount();
      storageCountEl.textContent = `💾 ${count} recording(s) saved in Local Disk`;
    } catch (err) {
      storageCountEl.textContent = 'Storage error';
      console.error('Error fetching storage count:', err);
    }
  }

  await refreshStorageCount();

  // Auto-refresh storage count every 3 seconds to keep it in sync
  const storageRefreshInterval = setInterval(refreshStorageCount, 3000);

  // Click storage count to open history
  storageCountEl.addEventListener('click', (e) => {
    e.preventDefault();
    openHistoryPage();
  });

  // --- ANTICIPATION 2: STATE SYNC ---
  try {
    const state = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
    if (state && state.isRecording) {
      setUIRecordingState(true);
      // Also start local visualization if already recording
      startLocalVisualization();
    }
  } catch (err) {
    console.warn("Could not fetch initial state", err);
  }

  // Screenshot elements
  const screenshotBtn = document.getElementById('screenshotBtn');
  const screenshotsList = document.getElementById('screenshotsList');
  const screenshotsContainer = document.getElementById('screenshotsContainer');
  const screenshotsCount = document.getElementById('screenshotsCount');
  const undoToast = document.getElementById('undoToast');
  const undoBtn = document.getElementById('undoBtn');
  let currentRecordingId = null;
  let currentScreenshots = [];
  let deletedScreenshot = null;
  let deletedIndex = -1;
  let undoTimeout = null;
  let recordingStartTime = null;

  function setUIRecordingState(recording) {
    isRecording = recording;
    if (recording) {
      recordBtn.classList.add('recording');
      visualizerContainer.classList.add('active');
      btnText.textContent = 'Stop Recording';
      statusText.textContent = 'Recording in progress...';
      // Hide storage count and more options during recording
      storageCountEl.style.display = 'none';
      document.getElementById('moreOptions').style.display = 'none';
      // Show screenshot button and list
      screenshotBtn.style.display = 'flex';
      screenshotsList.style.display = 'block';
      systemAudioCheckbox.disabled = true;
      // Reset screenshots for new recording
      currentRecordingId = Date.now().toString();
      currentScreenshots = [];
      screenshotsContainer.innerHTML = '';
      screenshotsCount.textContent = '0';
      recordingStartTime = Date.now();
    } else {
      recordBtn.classList.remove('recording');
      visualizerContainer.classList.remove('active');
      btnText.textContent = 'Start Recording';
      statusText.textContent = 'Ready to capture context.';
      // Show storage count and more options after recording
      storageCountEl.style.display = '';
      document.getElementById('moreOptions').style.display = '';
      // Hide screenshot button and list
      screenshotBtn.style.display = 'none';
      screenshotsList.style.display = 'none';
      systemAudioCheckbox.disabled = false;
    }
  }

  // Screenshot capture during recording
  screenshotBtn.addEventListener('click', async () => {
    if (!isRecording) return;
    
    // Disable button temporarily to prevent double-clicks
    screenshotBtn.disabled = true;
    
    try {
      console.log('Requesting screenshot capture...');
      const response = await chrome.runtime.sendMessage({ action: 'CAPTURE_SCREENSHOT' });
      console.log('Screenshot response:', response);
      
      if (response && response.success) {
        const timestamp = new Date();
        const screenshotData = {
          id: Date.now().toString(),
          base64: response.screenshotBase64,
          timestamp: timestamp.toISOString(),
          recordingId: currentRecordingId
        };
        
        currentScreenshots.push(screenshotData);
        renderScreenshots();
        screenshotsCount.textContent = currentScreenshots.length;
        console.log('Screenshot added to UI, total:', currentScreenshots.length);
      } else {
        console.warn('Screenshot capture failed:', response?.error);
        statusText.textContent = `Screenshot failed: ${response?.error || 'Unknown error'}`;
      }
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      statusText.textContent = `Screenshot error: ${error.message}`;
    } finally {
      // Re-enable button
      screenshotBtn.disabled = false;
    }
  });

  function renderScreenshots() {
    screenshotsContainer.innerHTML = '';
    // Sort: earliest first (left), latest last (right)
    const sortedScreenshots = [...currentScreenshots].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    sortedScreenshots.forEach((screenshot, index) => {
      const item = document.createElement('div');
      item.className = 'screenshot-item';
      item.dataset.index = index;
      
      // Calculate elapsed seconds since recording started (2 decimal places)
      const elapsedMs = new Date(screenshot.timestamp) - recordingStartTime;
      const elapsedSeconds = (elapsedMs / 1000).toFixed(2);
      const timeStr = `${elapsedSeconds}s`;
      
      item.innerHTML = `
        <img src="${screenshot.base64}" class="screenshot-thumb" alt="Screenshot">
        <div class="screenshot-info">
          <span class="screenshot-time">${timeStr}</span>
        </div>
        <button class="screenshot-delete" data-index="${index}" title="Delete">&times;</button>
      `;
      
      screenshotsContainer.appendChild(item);
    });
    
    // Attach delete handlers
    screenshotsContainer.querySelectorAll('.screenshot-delete').forEach(btn => {
      btn.addEventListener('click', handleDeleteScreenshot);
    });
  }

  function handleDeleteScreenshot(e) {
    e.stopPropagation();
    const index = parseInt(e.target.dataset.index);
    
    deletedScreenshot = currentScreenshots[index];
    deletedIndex = index;
    
    currentScreenshots.splice(index, 1);
    renderScreenshots();
    screenshotsCount.textContent = currentScreenshots.length;
    
    // Show undo toast
    undoToast.classList.add('active');
    
    // Clear previous timeout
    if (undoTimeout) clearTimeout(undoTimeout);
    
    // Auto-hide after 5 seconds
    undoTimeout = setTimeout(() => {
      undoToast.classList.remove('active');
      deletedScreenshot = null;
      deletedIndex = -1;
    }, 5000);
  }

  undoBtn.addEventListener('click', () => {
    if (deletedScreenshot && deletedIndex >= 0) {
      currentScreenshots.splice(deletedIndex, 0, deletedScreenshot);
      renderScreenshots();
      screenshotsCount.textContent = currentScreenshots.length;
      
      deletedScreenshot = null;
      deletedIndex = -1;
    }
    undoToast.classList.remove('active');
    if (undoTimeout) clearTimeout(undoTimeout);
  });

  countdownCancel.addEventListener('click', () => {
    cancelCountdown();
  });

  countdownStartNow.addEventListener('click', async () => {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    countdownOverlay.classList.remove('active');
    recordBtn.disabled = false;
    await startRecordingProcess();
  });

  function startCountdown() {
    countdownValue = 3;
    countdownNumber.textContent = countdownValue;
    countdownOverlay.classList.add('active');
    recordBtn.disabled = true;

    countdownInterval = setInterval(async () => {
      countdownValue--;
      if (countdownValue > 0) {
        countdownNumber.textContent = countdownValue;
      } else {
        clearInterval(countdownInterval);
        countdownInterval = null;
        countdownOverlay.classList.remove('active');
        recordBtn.disabled = false;
        await startRecordingProcess();
      }
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    countdownOverlay.classList.remove('active');
    recordBtn.disabled = false;
    statusText.textContent = 'Ready to capture context.';
  }

  recordBtn.addEventListener('click', async () => {
    if (isRecording) {
      await stopRecordingProcess();
    } else {
      // After first recording, skip countdown and start immediately
      await startRecordingProcess();
    }
  });

  async function requestMicrophonePermission() {
    try {
      const constraints = selectedDeviceId 
        ? { audio: { deviceId: { exact: selectedDeviceId } } }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error) {
      console.error('Microphone permission denied:', error);

      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        statusText.textContent = 'Opening setup page...';
        chrome.tabs.create({ url: chrome.runtime.getURL('setup/setup.html') });
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        statusText.textContent = 'Mic error: Selected device not found. Please check your microphone connection.';
        // Reload devices to update the list
        loadAudioDevices();
      } else {
        statusText.textContent = `Mic error: ${error.message}`;
      }

      statusText.style.color = 'var(--md-sys-color-error)';
      return false;
    }
  }

  async function startRecordingProcess() {
    statusText.textContent = 'Starting engine...';
    statusText.style.color = 'var(--md-sys-color-outline)';

    try {
      if (systemAudioCheckbox.checked) {
        statusText.textContent = 'Select a tab or window to record...';

        systemAudioStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true
        });

        systemAudioStream.getVideoTracks().forEach(t => t.stop());

        const displayAudioTrack = systemAudioStream.getAudioTracks()[0];
        if (!displayAudioTrack) {
          throw new Error('Selected source has no audio. Please select a tab playing sound.');
        }

        const systemOnlyStream = new MediaStream([displayAudioTrack]);

        systemAudioChunks = [];
        systemAudioRecorder = new MediaRecorder(systemOnlyStream, { mimeType: 'audio/webm' });
        systemAudioRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            systemAudioChunks.push(event.data);
          }
        };
        systemAudioRecorder.start();
        console.log('System audio recorder started');

        systemMicStream = null;
        systemMicRecorder = null;
        systemMicChunks = [];
        try {
          const constraints = selectedDeviceId
            ? { audio: { deviceId: { exact: selectedDeviceId } } }
            : { audio: true };
          systemMicStream = await navigator.mediaDevices.getUserMedia(constraints);

          systemMicRecorder = new MediaRecorder(systemMicStream, { mimeType: 'audio/webm' });
          systemMicRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              systemMicChunks.push(event.data);
            }
          };
          systemMicRecorder.start();
          console.log('Microphone recorder started (dual track)');
        } catch (micError) {
          console.warn('Microphone not available, system audio only:', micError.message);
        }

        setUIRecordingState(true);
        startSystemAudioVisualization(systemOnlyStream);
      } else {
        statusText.textContent = 'Requesting permission...';
        const hasPermission = await requestMicrophonePermission();
        if (!hasPermission) return;

        statusText.textContent = 'Starting engine...';
        statusText.style.color = 'var(--md-sys-color-outline)';

        const response = await chrome.runtime.sendMessage({
          action: 'START_RECORDING_COMMAND',
          includeSystemAudio: false,
          tabStreamId: null
        });

        if (response && response.success) {
          setUIRecordingState(true);
          startLocalVisualization();
        } else {
          throw new Error(response?.error || 'Unknown error starting recording');
        }
      }
    } catch (error) {
      console.error('Failed to start:', error);
      if (error.name === 'AbortError') {
        statusText.textContent = 'Ready to capture context.';
        statusText.style.color = 'var(--md-sys-color-outline)';
        return;
      }
      statusText.textContent = `Error: ${error.message}`;
      statusText.style.color = 'var(--md-sys-color-error)';
    }
  }

  async function stopRecordingProcess() {
    statusText.textContent = 'Stopping...';
    recordBtn.disabled = true;

    stopLocalVisualization();

    try {
      let audioBase64 = null;

      if (systemAudioRecorder && systemAudioRecorder.state === 'recording') {
        await new Promise((resolve) => {
          systemAudioRecorder.onstop = resolve;
          systemAudioRecorder.stop();
        });

        const blob = new Blob(systemAudioChunks, { type: 'audio/webm' });
        audioBase64 = await blobToBase64(blob);
        console.log('System audio stopped, size:', audioBase64.length);

        let micAudioBase64 = null;
        if (systemMicRecorder && systemMicRecorder.state === 'recording') {
          await new Promise((resolve) => {
            systemMicRecorder.onstop = resolve;
            systemMicRecorder.stop();
          });

          const micBlob = new Blob(systemMicChunks, { type: 'audio/webm' });
          micAudioBase64 = await blobToBase64(micBlob);
          console.log('Microphone audio stopped, size:', micAudioBase64.length);
        }

        if (systemAudioStream) {
          systemAudioStream.getTracks().forEach(t => t.stop());
          systemAudioStream = null;
        }
        if (systemMicStream) {
          systemMicStream.getTracks().forEach(t => t.stop());
          systemMicStream = null;
        }
        systemAudioRecorder = null;
        systemAudioChunks = [];
        systemMicRecorder = null;
        systemMicChunks = [];

        window._pendingMicAudioBase64 = micAudioBase64;
      } else {
        const response = await chrome.runtime.sendMessage({ action: 'STOP_RECORDING_COMMAND' });

        if (!response || !response.success) {
          throw new Error(response?.error || 'Unknown error stopping recording');
        }

        audioBase64 = response.audioBase64;
        console.log('Received and saved audio data length:', audioBase64.length);
      }

      setUIRecordingState(false);
      statusText.textContent = 'Saving to local storage...';

      let screenshotBase64 = null;
      try {
        const screenshotResponse = await chrome.runtime.sendMessage({ action: 'CAPTURE_SCREENSHOT' });
        if (screenshotResponse && screenshotResponse.success) {
          screenshotBase64 = screenshotResponse.screenshotBase64;
          console.log('Screenshot captured, size:', screenshotBase64.length);
        }
      } catch (screenshotError) {
        console.warn('Screenshot capture failed:', screenshotError);
      }

      const micAudio = window._pendingMicAudioBase64 || null;
      const audioType = micAudio ? 'mixed' : (systemAudioCheckbox.checked ? 'sys' : 'mic');

      await window.MentoStorage.saveRecord({
        id: currentRecordingId,
        timestamp: new Date().toISOString(),
        startTime: new Date(recordingStartTime || Date.now()).toISOString(),
        endTime: new Date().toISOString(),
        audioBase64: audioBase64,
        micAudioBase64: micAudio,
        audioType: audioType,
        screenshotBase64: screenshotBase64,
        screenshots: currentScreenshots
      });

      window._pendingMicAudioBase64 = null;

      statusText.textContent = 'Recording saved successfully!';
      await refreshStorageCount();
      showStopDialog();
    } catch (error) {
      console.error('Failed to stop:', error);
      statusText.textContent = `Error: ${error.message}`;
      statusText.style.color = 'var(--md-sys-color-error)';
    } finally {
      recordBtn.disabled = false;
    }
  }

  function showStopDialog() {
    stopDialogOverlay.classList.add('active');
  }

  function hideStopDialog() {
    stopDialogOverlay.classList.remove('active');
  }

  stopDialogView.addEventListener('click', () => {
    hideStopDialog();
    openHistoryPage();
  });

  stopDialogOverlay.addEventListener('click', (e) => {
    if (e.target === stopDialogOverlay) {
      hideStopDialog();
    }
  });

  // --- MORE OPTIONS ---
  const moreOptionsToggle = document.getElementById('moreOptionsToggle');
  const moreOptionsChevron = document.getElementById('moreOptionsChevron');
  const moreOptionsContent = document.getElementById('moreOptionsContent');
  let isMoreOptionsExpanded = false;

  moreOptionsToggle.addEventListener('click', () => {
    isMoreOptionsExpanded = !isMoreOptionsExpanded;
    moreOptionsContent.classList.toggle('expanded', isMoreOptionsExpanded);
    moreOptionsChevron.classList.toggle('expanded', isMoreOptionsExpanded);
  });

  // --- SHORTCUT DISPLAY ---
  const shortcutValue = document.getElementById('shortcutValue');
  const shortcutBtn = document.getElementById('shortcutBtn');

  async function loadShortcut() {
    try {
      const commands = await chrome.commands.getAll();
      const actionCommand = commands.find(cmd => cmd.name === '_execute_action');
      if (actionCommand && actionCommand.shortcut) {
        shortcutValue.textContent = actionCommand.shortcut;
      } else {
        shortcutValue.textContent = 'Not set';
      }
    } catch (err) {
      console.error('Failed to load shortcut:', err);
      shortcutValue.textContent = 'Unavailable';
    }
  }

  await loadShortcut();

  // Refresh shortcut when side panel becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadShortcut();
    }
  });

  shortcutBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  window.addEventListener('pagehide', () => {
    clearInterval(storageRefreshInterval);
  });

});
