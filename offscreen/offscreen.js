let mediaRecorder;
let recordedChunks = [];
let audioContext;
let analyser;
let dataArray;
let animationFrameId;
let tabAudioStream = null;

// 1. REGISTER LISTENER FIRST
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  const action = message.action;

  if (action === 'START_RECORDING') {
    console.log('Offscreen received START_RECORDING:', 'includeSystemAudio=', message.includeSystemAudio, 'tabStreamId=', message.tabStreamId);
    startRecording({ includeSystemAudio: message.includeSystemAudio, tabStreamId: message.tabStreamId })
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (action === 'STOP_RECORDING') {
    stopRecording()
      .then((base64data) => sendResponse({ success: true, audioBase64: base64data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async
  }
});

// 2. IMMEDIATELY FIRE "REVERSE HANDSHAKE"
chrome.runtime.sendMessage({ action: "OFFSCREEN_READY" });

// --- Audio Recording Logic ---

async function startRecording(options = {}) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    throw new Error('Already recording');
  }

  const { includeSystemAudio, tabStreamId } = options;

  let recordingStream;

  if (includeSystemAudio && tabStreamId) {
    console.log('Attempting tab-only audio capture with streamId:', tabStreamId);
    tabAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: tabStreamId
        }
      },
      video: false
    });

    console.log('Tab audio stream obtained, tracks:', tabAudioStream.getAudioTracks().length);
    recordingStream = tabAudioStream;
  } else {
    console.log('Capturing microphone only');
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  mediaRecorder = new MediaRecorder(recordingStream, { mimeType: 'audio/webm' });
  recordedChunks = [];

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  const source = audioContext.createMediaStreamSource(recordingStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);

  function analyzeAudio() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    let peak = 0;
    for (let i = 0; i < bufferLength; i++) {
      const sample = (dataArray[i] - 128) / 128;
      sum += sample * sample;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sum / bufferLength);

    const combinedVolume = (rms * 0.7 + peak * 0.3) * 255;

    chrome.storage.local.set({ __audioVolume: combinedVolume }).catch(() => {});

    animationFrameId = requestAnimationFrame(analyzeAudio);
  }

  analyzeAudio();
  mediaRecorder.start();
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
      return reject(new Error('Not recording'));
    }

    mediaRecorder.onstop = () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (audioContext) audioContext.close();

      const blob = new Blob(recordedChunks, { type: 'audio/webm' });

      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        const base64data = reader.result;

        mediaRecorder.stream.getTracks().forEach(track => track.stop());

        if (tabAudioStream) {
          tabAudioStream.getTracks().forEach(track => track.stop());
          tabAudioStream = null;
        }

        resolve(base64data);
      };
      reader.onerror = () => {
        reject(new Error('Failed to read audio blob data'));
      };
    };

    mediaRecorder.stop();
  });
}
