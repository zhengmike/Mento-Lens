document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('recordsContainer');
  const emptyState = document.getElementById('emptyState');
  const snackbar = document.getElementById('snackbar');
  const snackbarUndo = document.getElementById('snackbarUndo');
  const snackbarMessage = document.getElementById('snackbarMessage');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxImgWrapper = document.getElementById('lightboxImgWrapper');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');
  const lightboxCounter = document.getElementById('lightboxCounter');
  const lightboxZoomIn = document.getElementById('lightboxZoomIn');
  const lightboxZoomOut = document.getElementById('lightboxZoomOut');
  const lightboxZoomReset = document.getElementById('lightboxZoomReset');
  const lightboxZoomLevel = document.getElementById('lightboxZoomLevel');

  // Track the currently playing audio element and its card
  let currentAudio = null;
  let currentCard = null;
  let currentProgressFill = null;
  let currentPlayBtn = null;
  let progressInterval = null;

  // Undo state
  let undoTimeout = null;
  let pendingDelete = null;
  let pendingScreenshotDelete = null;
  let finalizingDeleteCount = 0;

  // Store current records for diff comparison
  let currentRecords = [];

  // Lightbox navigation state
  let lightboxScreenshots = [];
  let lightboxCurrentIndex = 0;

  // Lightbox zoom state
  let lightboxScale = 1;
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 4;
  const ZOOM_STEP = 0.25;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let imgTranslateX = 0;
  let imgTranslateY = 0;

  function applyLightboxTransform(smooth = false) {
    lightboxImg.classList.toggle('smooth', smooth);
    lightboxImg.style.transform = `translate(${imgTranslateX}px, ${imgTranslateY}px) scale(${lightboxScale})`;
    lightboxZoomLevel.textContent = `${Math.round(lightboxScale * 100)}%`;
  }

  function resetLightboxZoom() {
    lightboxScale = 1;
    imgTranslateX = 0;
    imgTranslateY = 0;
    applyLightboxTransform(true);
  }

  function zoomLightbox(delta) {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, lightboxScale + delta));
    if (newScale !== lightboxScale) {
      lightboxScale = newScale;
      if (lightboxScale === 1) {
        imgTranslateX = 0;
        imgTranslateY = 0;
      }
      applyLightboxTransform(true);
    }
  }

  function updateLightboxImage() {
    if (lightboxScreenshots.length === 0) return;
    lightboxImg.src = lightboxScreenshots[lightboxCurrentIndex].base64;
    lightboxCounter.textContent = `${lightboxCurrentIndex + 1} / ${lightboxScreenshots.length}`;
    lightboxPrev.classList.toggle('hidden', lightboxCurrentIndex === 0);
    lightboxNext.classList.toggle('hidden', lightboxCurrentIndex === lightboxScreenshots.length - 1);
    resetLightboxZoom();
  }

  function showPrevImage() {
    if (lightboxCurrentIndex > 0) {
      lightboxCurrentIndex--;
      updateLightboxImage();
    }
  }

  function showNextImage() {
    if (lightboxCurrentIndex < lightboxScreenshots.length - 1) {
      lightboxCurrentIndex++;
      updateLightboxImage();
    }
  }

  // Lightbox handlers
  lightboxClose.addEventListener('click', () => {
    lightbox.classList.remove('active');
  });

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target.closest('.lightbox-overlay') === lightbox) {
      const content = lightbox.querySelector('.lightbox-content');
      const imgWrapper = lightbox.querySelector('.lightbox-img-wrapper');
      // Only close if clicking on the overlay background itself,
      // not on the content area
      if (content && !content.contains(e.target)) {
        lightbox.classList.remove('active');
      }
    }
  });

  lightboxPrev.addEventListener('click', (e) => {
    e.stopPropagation();
    showPrevImage();
  });

  lightboxNext.addEventListener('click', (e) => {
    e.stopPropagation();
    showNextImage();
  });

  lightboxZoomIn.addEventListener('click', (e) => {
    e.stopPropagation();
    zoomLightbox(ZOOM_STEP);
  });

  lightboxZoomOut.addEventListener('click', (e) => {
    e.stopPropagation();
    zoomLightbox(-ZOOM_STEP);
  });

  lightboxZoomReset.addEventListener('click', (e) => {
    e.stopPropagation();
    resetLightboxZoom();
  });

  lightboxImgWrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    zoomLightbox(delta);
  }, { passive: false });

  lightboxImgWrapper.addEventListener('mousedown', (e) => {
    if (lightboxScale <= 1) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    lightboxImgWrapper.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = (e.clientX - dragStartX) / lightboxScale;
    const dy = (e.clientY - dragStartY) / lightboxScale;
    imgTranslateX += dx;
    imgTranslateY += dy;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    applyLightboxTransform(false);
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    lightboxImgWrapper.style.cursor = 'grab';
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'ArrowLeft') showPrevImage();
    if (e.key === 'ArrowRight') showNextImage();
    if (e.key === 'Escape') lightbox.classList.remove('active');
    if (e.key === '+' || e.key === '=') zoomLightbox(ZOOM_STEP);
    if (e.key === '-') zoomLightbox(-ZOOM_STEP);
    if (e.key === '0') resetLightboxZoom();
  });

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async function finalizeDelete(pending) {
    if (!pending) return;
    finalizingDeleteCount++;
    try {
      if (pending.type === 'screenshot') {
        const scrollY = window.scrollY;
        const grid = pending.card.querySelector('.screenshots-grid');
        const wasExpanded = grid && grid.classList.contains('expanded');

        await window.MentoStorage.updateRecord(pending.recordId, {
          screenshots: pending.remainingScreenshots
        });
        pending.wrapper.remove();
        const countBadge = pending.card.querySelector('.screenshots-count');
        if (countBadge) {
          countBadge.textContent = pending.remainingScreenshots.length;
        }
        if (pending.remainingScreenshots.length === 0) {
          const section = pending.card.querySelector('.screenshots-section');
          if (section) section.remove();
        } else if (wasExpanded && grid) {
          grid.classList.add('expanded');
          requestAnimationFrame(() => {
            grid.classList.add('expanded');
          });
        }

        window.scrollTo(0, scrollY);
      } else {
        await window.MentoStorage.deleteRecord(pending.id);
        const row = pending.card.closest('.timeline-row');
        if (row) {
          const group = row.closest('.timeline-date-group');
          row.remove();
          if (group && group.querySelectorAll('.timeline-row').length === 1) {
            group.remove();
          }
        } else {
          pending.card.remove();
        }
        const remaining = await window.MentoStorage.getRecordCount();
        if (remaining === 0) {
          emptyState.style.display = 'block';
        }
      }
    } catch (err) {
      console.error('Failed to finalize delete:', err);
    } finally {
      finalizingDeleteCount--;
    }
  }

  async function undoDelete() {
    // Clear the auto-delete timeout
    if (undoTimeout) {
      clearTimeout(undoTimeout);
      undoTimeout = null;
    }

    if (pendingScreenshotDelete) {
      // Restore screenshot wrapper
      pendingScreenshotDelete.wrapper.style.display = '';
      // Restore count badge
      const countBadge = pendingScreenshotDelete.card.querySelector('.screenshots-count');
      if (countBadge) {
        countBadge.textContent = pendingScreenshotDelete.remainingScreenshots.length + 1;
      }
      pendingScreenshotDelete = null;
      snackbar.classList.remove('show');
      return;
    }

    if (!pendingDelete) return;

    // Restore the row by removing the deleting class
    const row = pendingDelete.card.closest('.timeline-row');
    if (row) {
      row.classList.remove('deleting');
    } else {
      pendingDelete.card.classList.remove('deleting');
    }

    // Hide snackbar
    snackbar.classList.remove('show');

    // Clear pending state
    pendingDelete = null;
  }

  // Snackbar Undo button handler
  snackbarUndo.addEventListener('click', undoDelete);

  function stopAllOthers(exceptAudios) {
    const exceptSet = new Set(Array.isArray(exceptAudios) ? exceptAudios : [exceptAudios]);
    document.querySelectorAll('audio').forEach(audio => {
      if (!exceptSet.has(audio)) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    document.querySelectorAll('.record-card').forEach(c => {
      const cardAudios = c.querySelectorAll('audio');
      const hasExcepted = [...cardAudios].some(a => exceptSet.has(a));
      if (!hasExcepted) {
        c.classList.remove('playing');
        c.querySelectorAll('.progress-fill').forEach(f => f.style.width = '0%');
        c.querySelectorAll('.play-btn').forEach(b => { b.innerHTML = playIcon; b.classList.remove('playing'); });
        c.querySelectorAll('.current-time').forEach(t => t.textContent = '0:00');
      }
    });
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  function updateProgress() {
    if (!currentAudio || !currentProgressFill) return;
    const pct = (currentAudio.currentTime / currentAudio.duration) * 100;
    currentProgressFill.style.width = `${pct}%`;
    const curTimeEl = currentProgressFill.closest('.progress-container').querySelector('.current-time');
    if (curTimeEl) curTimeEl.textContent = formatTime(currentAudio.currentTime);

    if (currentCard) {
      const allAudio = currentCard.querySelectorAll('audio');
      if (allAudio.length === 2) {
        const sibling = allAudio[0] === currentAudio ? allAudio[1] : allAudio[0];
        if (!sibling.paused) {
          const siblingFill = currentCard.querySelector(`.progress-bar[data-audio="${sibling.id}"] .progress-fill`);
          if (siblingFill) siblingFill.style.width = `${pct}%`;
          const siblingTime = currentCard.querySelector(`.progress-bar[data-audio="${sibling.id}"]`).closest('.progress-container').querySelector('.current-time');
          if (siblingTime) siblingTime.textContent = formatTime(currentAudio.currentTime);
        }
      }
    }
  }

  const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  const pauseIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

  function createCard(record, index, totalRecords) {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.dataset.id = record.id;

    const date = new Date(record.timestamp);
    const dateString = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    const audioId = `audio-${record.id}`;
    const micAudioId = `micaudio-${record.id}`;
    const displayTitle = record.title || `Recording #${totalRecords - index}`;
    const hasMic = !!record.micAudioBase64;

    const volControl = (aid) => `
      <div class="volume-control" data-audio="${aid}">
        <button class="vol-btn vol-up" data-audio="${aid}">+</button>
        <span class="vol-value">100</span>
        <button class="vol-btn vol-down" data-audio="${aid}">-</button>
      </div>`;

    const audioPlayersHTML = hasMic ? `
      <div class="audio-players dual">
        <div class="dual-row">
          <span class="audio-label">Sys</span>
          <div class="audio-player">
            <button class="play-btn" data-audio="${audioId}">${playIcon}</button>
            <div class="progress-container">
              <div class="progress-bar" data-audio="${audioId}">
                <div class="progress-fill"></div>
              </div>
              <div class="time-labels">
                <span class="current-time">0:00</span>
                <span class="duration">--:--</span>
                <button class="speed-btn" data-audio="${audioId}"><span>1x</span></button>
              </div>
            </div>
          </div>
          ${volControl(audioId)}
        </div>
        <div class="dual-row">
          <span class="audio-label">Mic</span>
          <div class="audio-player">
            <button class="play-btn" data-audio="${micAudioId}">${playIcon}</button>
            <div class="progress-container">
              <div class="progress-bar" data-audio="${micAudioId}">
                <div class="progress-fill"></div>
              </div>
              <div class="time-labels">
                <span class="current-time">0:00</span>
                <span class="duration">--:--</span>
                <button class="speed-btn" data-audio="${micAudioId}"><span>1x</span></button>
              </div>
            </div>
          </div>
          ${volControl(micAudioId)}
        </div>
      </div>
    ` : `
      <div class="audio-row">
        <span class="audio-label">${record.audioType === 'sys' ? 'Sys' : 'Mic'}</span>
        <div class="audio-player">
          <button class="play-btn" data-audio="${audioId}">${playIcon}</button>
          <div class="progress-container">
            <div class="progress-bar" data-audio="${audioId}">
              <div class="progress-fill"></div>
            </div>
            <div class="time-labels">
              <span class="current-time">0:00</span>
              <span class="duration">--:--</span>
              <button class="speed-btn" data-audio="${audioId}"><span>1x</span></button>
            </div>
          </div>
        </div>
        ${volControl(audioId)}
      </div>
    `;

    card.innerHTML = `
      <div class="record-header">
        <input type="text" class="record-title" value="${displayTitle}" data-id="${record.id}" spellcheck="false">
        <span class="record-time">${dateString}</span>
      </div>
      <audio id="${audioId}" src="${record.audioBase64}" preload="metadata"></audio>
      ${hasMic ? `<audio id="${micAudioId}" src="${record.micAudioBase64}" preload="metadata"></audio>` : ''}
      ${audioPlayersHTML}
      <div class="card-actions">
        ${hasMic ? `
        <button class="md3-text-btn play-both-btn" data-playboth="${audioId},${micAudioId}">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span>Play Both</span>
        </button>
        ` : ''}
        <button class="md3-text-btn icon-only download-btn" data-id="${record.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        <button class="md3-text-btn icon-only delete-btn" data-id="${record.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    function setupAudioPlayer(audioEl, playBtnEl, progressBarEl, progressFillEl, durationEl, siblingAudios = []) {
      audioEl.addEventListener('loadedmetadata', () => {
        if (audioEl.duration && !isNaN(audioEl.duration)) {
          durationEl.textContent = formatTime(audioEl.duration);
        }
      });

      playBtnEl.addEventListener('click', () => {
        if (audioEl.paused) {
          stopAllOthers([audioEl, ...siblingAudios]);
          audioEl.play();
          currentAudio = audioEl;
          currentCard = card;
          currentProgressFill = progressFillEl;
          currentPlayBtn = playBtnEl;
          card.classList.add('playing');
          playBtnEl.classList.add('playing');
          playBtnEl.innerHTML = pauseIcon;
          progressInterval = setInterval(updateProgress, 100);
        } else {
          audioEl.pause();
          playBtnEl.innerHTML = playIcon;
          playBtnEl.classList.remove('playing');
          card.classList.remove('playing');
          if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
          }
        }
      });

      progressBarEl.addEventListener('click', (e) => {
        const rect = progressBarEl.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        if (audioEl.duration && !isNaN(audioEl.duration)) {
          audioEl.currentTime = pct * audioEl.duration;
          if (audioEl.paused) {
            progressFillEl.style.width = `${pct * 100}%`;
            const curTimeEl = progressBarEl.closest('.progress-container').querySelector('.current-time');
            if (curTimeEl) curTimeEl.textContent = formatTime(audioEl.currentTime);
          }
        }
      });

      audioEl.addEventListener('ended', () => {
        playBtnEl.innerHTML = playIcon;
        playBtnEl.classList.remove('playing');
        card.classList.remove('playing');
        progressFillEl.style.width = '0%';
        const curTimeEl = progressBarEl.closest('.progress-container').querySelector('.current-time');
        if (curTimeEl) curTimeEl.textContent = '0:00';
        if (currentAudio === audioEl) {
          currentAudio = null;
          currentCard = null;
          currentProgressFill = null;
          currentPlayBtn = null;
        }
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
      });

      const speedBtn = progressBarEl.closest('.progress-container').querySelector('.speed-btn');
      if (speedBtn) {
        const speeds = [1, 1.5, 2, 3];
        let speedIndex = 0;
        speedBtn.addEventListener('click', () => {
          speedIndex = (speedIndex + 1) % speeds.length;
          const newSpeed = speeds[speedIndex];
          audioEl.playbackRate = newSpeed;
          speedBtn.querySelector('span').textContent = `${newSpeed}x`;
        });
      }

      const volControl = card.querySelector(`.volume-control[data-audio="${audioEl.id}"]`);
      if (volControl) {
        const volValue = volControl.querySelector('.vol-value');
        const volUp = volControl.querySelector('.vol-up');
        const volDown = volControl.querySelector('.vol-down');

        function updateVolDisplay() {
          const pct = Math.round(audioEl.volume * 100);
          volValue.textContent = pct;
        }

        volUp.addEventListener('click', () => {
          audioEl.volume = Math.min(1, audioEl.volume + 0.1);
          updateVolDisplay();
        });

        volDown.addEventListener('click', () => {
          audioEl.volume = Math.max(0, audioEl.volume - 0.1);
          updateVolDisplay();
        });
      }
    }

    const audio = card.querySelector(`#${audioId}`);
    const playBtn = card.querySelector(`.play-btn[data-audio="${audioId}"]`);
    const progressBar = card.querySelector(`.progress-bar[data-audio="${audioId}"]`);
    const progressFill = progressBar.querySelector('.progress-fill');
    const durationEl = card.querySelector(`.progress-bar[data-audio="${audioId}"]`).closest('.progress-container').querySelector('.duration');

    let micAudio = null;
    if (hasMic) {
      micAudio = card.querySelector(`#${micAudioId}`);
    }
    setupAudioPlayer(audio, playBtn, progressBar, progressFill, durationEl, micAudio ? [micAudio] : []);

    if (hasMic) {
      const micPlayBtn = card.querySelector(`.play-btn[data-audio="${micAudioId}"]`);
      const micProgressBar = card.querySelector(`.progress-bar[data-audio="${micAudioId}"]`);
      const micProgressFill = micProgressBar.querySelector('.progress-fill');
      const micDurationEl = micProgressBar.closest('.progress-container').querySelector('.duration');
      setupAudioPlayer(micAudio, micPlayBtn, micProgressBar, micProgressFill, micDurationEl, [audio]);

      const playBothBtn = card.querySelector('.play-both-btn');

      playBothBtn.addEventListener('click', () => {
        const bothPlaying = !audio.paused && !micAudio.paused;

        if (bothPlaying) {
          audio.pause();
          micAudio.pause();
          playBothBtn.querySelector('span').textContent = 'Play Both';
          card.classList.remove('playing');
          if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
          }
        } else {
          stopAllOthers([]);
          const syncTime = Math.max(audio.currentTime, micAudio.currentTime);
          audio.currentTime = syncTime;
          micAudio.currentTime = syncTime;
          audio.play();
          micAudio.play();
          currentAudio = audio;
          currentCard = card;
          currentProgressFill = card.querySelector(`.progress-bar[data-audio="${audioId}"] .progress-fill`);
          currentPlayBtn = playBothBtn;
          playBothBtn.querySelector('span').textContent = 'Pause Both';
          card.classList.add('playing');
          progressInterval = setInterval(updateProgress, 100);
        }
      });

      audio.addEventListener('play', () => {
        if (!micAudio.paused) {
          playBothBtn.querySelector('span').textContent = 'Pause Both';
        }
      });

      audio.addEventListener('pause', () => {
        if (micAudio.paused) {
          playBothBtn.querySelector('span').textContent = 'Play Both';
        }
      });

      micAudio.addEventListener('play', () => {
        if (!audio.paused) {
          playBothBtn.querySelector('span').textContent = 'Pause Both';
        }
      });

      micAudio.addEventListener('pause', () => {
        if (audio.paused) {
          playBothBtn.querySelector('span').textContent = 'Play Both';
        }
      });
    }

    // --- RENAME HANDLER ---
    const titleInput = card.querySelector('.record-title');
    titleInput.addEventListener('blur', async () => {
      const newTitle = titleInput.value.trim();
      if (!newTitle || newTitle === (record.title || `Recording #${totalRecords - index}`)) return;

      try {
        await window.MentoStorage.updateRecord(record.id, { title: newTitle });
        titleInput.classList.add('saved');
        setTimeout(() => titleInput.classList.remove('saved'), 600);
      } catch (err) {
        console.error('Failed to rename:', err);
        titleInput.value = record.title || `Recording #${totalRecords - index}`;
      }
    });

    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        titleInput.blur();
      }
    });

    // --- DOWNLOAD HANDLER ---
    const downloadBtn = card.querySelector('.download-btn');
    downloadBtn.addEventListener('click', () => {
      try {
        const baseName = (record.title || `Recording-${record.id}`).replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');

        function triggerDownload(href, fileName) {
          const link = document.createElement('a');
          link.href = href;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }

        triggerDownload(record.audioBase64, `${baseName}_system.webm`);

        if (record.micAudioBase64) {
          setTimeout(() => {
            triggerDownload(record.micAudioBase64, `${baseName}_microphone.webm`);
          }, 300);
        }
      } catch (err) {
        console.error('Failed to download:', err);
        alert('Failed to download recording.');
      }
    });

    // --- SCREENSHOTS SECTION ---
    const screenshots = record.screenshots || [];
    if (screenshots.length > 0) {
      const screenshotsSection = document.createElement('div');
      screenshotsSection.className = 'screenshots-section';
      
      const screenshotsHeader = document.createElement('div');
      screenshotsHeader.className = 'screenshots-header';
      screenshotsHeader.innerHTML = `
        <svg class="screenshots-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="M21 15l-5-5L5 21"/>
        </svg>
        <span class="screenshots-title">Screenshots</span>
        <span class="screenshots-count">${screenshots.length}</span>
      `;
      
      const screenshotsGrid = document.createElement('div');
      screenshotsGrid.className = 'screenshots-grid';
      
      // Sort screenshots by timestamp (earliest first)
      const sortedScreenshots = [...screenshots].sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );
      
      // Calculate recording start time
      // New recordings have startTime field; old recordings fall back to timestamp
      let recordingStartTime;
      if (record.startTime) {
        recordingStartTime = new Date(record.startTime).getTime();
      } else {
        recordingStartTime = new Date(record.timestamp).getTime();
        if (sortedScreenshots.length > 0) {
          const firstScreenshotTime = new Date(sortedScreenshots[0].timestamp).getTime();
          if (recordingStartTime > firstScreenshotTime) {
            recordingStartTime = firstScreenshotTime;
          }
        }
      }
      
      // Track current screenshots for this card (to handle multiple deletes)
      let currentScreenshots = [...sortedScreenshots];

      sortedScreenshots.forEach((screenshot, screenshotIndex) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'screenshot-thumb-wrapper';
        wrapper.dataset.timestamp = screenshot.timestamp;

        // Calculate elapsed seconds since recording started (2 decimal places)
        const elapsedMs = new Date(screenshot.timestamp).getTime() - recordingStartTime;
        const elapsedSeconds = (elapsedMs / 1000).toFixed(2);
        const timeStr = `${elapsedSeconds}s`;

        wrapper.innerHTML = `
          <img src="${screenshot.base64}" alt="Screenshot at ${timeStr}">
          <span class="screenshot-thumb-time">${timeStr}</span>
          <button class="screenshot-delete-btn" data-timestamp="${screenshot.timestamp}" title="Delete screenshot">&times;</button>
        `;

        const deleteScreenshotBtn = wrapper.querySelector('.screenshot-delete-btn');
        deleteScreenshotBtn.addEventListener('click', (e) => {
          e.stopPropagation();

          // Clear any existing pending delete
          if (undoTimeout) {
            clearTimeout(undoTimeout);
            undoTimeout = null;
          }
          if (pendingScreenshotDelete) {
            // Finalize previous screenshot delete first and update currentScreenshots
            currentScreenshots = pendingScreenshotDelete.remainingScreenshots;
            finalizeDelete(pendingScreenshotDelete);
            pendingScreenshotDelete = null;
          }
          if (pendingDelete) {
            finalizeDelete(pendingDelete);
            pendingDelete = null;
            snackbar.classList.remove('show');
          }

          // Compute remaining screenshots from current state
          const remainingScreenshots = currentScreenshots.filter(
            s => s.timestamp !== screenshot.timestamp
          );

          pendingScreenshotDelete = {
            type: 'screenshot',
            recordId: record.id,
            wrapper: wrapper,
            card: card,
            remainingScreenshots: remainingScreenshots
          };

          // Hide the wrapper immediately (visually remove)
          wrapper.style.display = 'none';

          // Update count badge immediately for better UX
          const countBadge = card.querySelector('.screenshots-count');
          if (countBadge) {
            countBadge.textContent = remainingScreenshots.length;
          }

          snackbarMessage.textContent = 'Screenshot deleted';
          snackbar.classList.add('show');

          undoTimeout = setTimeout(async () => {
            await finalizeDelete(pendingScreenshotDelete);
            currentScreenshots = remainingScreenshots;
            pendingScreenshotDelete = null;
            snackbar.classList.remove('show');
          }, 5000);
        });

        wrapper.addEventListener('click', () => {
          lightboxScreenshots = currentScreenshots;
          lightboxCurrentIndex = screenshotIndex;
          updateLightboxImage();
          lightbox.classList.add('active');
        });

        screenshotsGrid.appendChild(wrapper);
      });
      
      // Toggle expand/collapse
      let isExpanded = false;
      screenshotsHeader.addEventListener('click', () => {
        isExpanded = !isExpanded;
        screenshotsGrid.classList.toggle('expanded', isExpanded);
      });
      
      screenshotsSection.appendChild(screenshotsHeader);
      screenshotsSection.appendChild(screenshotsGrid);
      card.appendChild(screenshotsSection);
    }

    // --- DELETE HANDLER ---
    const deleteBtn = card.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', async () => {
      if (undoTimeout) {
        clearTimeout(undoTimeout);
        undoTimeout = null;
      }
      if (pendingScreenshotDelete) {
        await finalizeDelete(pendingScreenshotDelete);
        pendingScreenshotDelete = null;
      }
      if (pendingDelete) {
        await finalizeDelete(pendingDelete);
      }

      try {
        if (currentAudio === audio) {
          stopAllOthers([]);
        }

        const recordData = { ...record };
        pendingDelete = { id: record.id, data: recordData, card: card };
        const row = card.closest('.timeline-row');
        if (row) {
          row.classList.add('deleting');
        } else {
          card.classList.add('deleting');
        }
        snackbarMessage.textContent = 'Recording deleted';
        snackbar.classList.add('show');

        undoTimeout = setTimeout(async () => {
          await finalizeDelete(pendingDelete);
          pendingDelete = null;
          snackbar.classList.remove('show');
        }, 5000);
      } catch (err) {
        console.error('Failed to delete record:', err);
        alert('Failed to delete recording.');
      }
    });

    return card;
  }

  function formatDateLabel(date) {
    const now = new Date();
    const d = new Date(date);
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';

    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  function groupRecordsByDate(records) {
    const groups = {};
    records.forEach(record => {
      const dateKey = new Date(record.timestamp).toDateString();
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(record);
    });
    // Sort each group's records by timestamp (newest first)
    Object.values(groups).forEach(group => {
      group.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    });
    // Return sorted date keys (newest first)
    const sortedKeys = Object.keys(groups).sort((a, b) => new Date(b) - new Date(a));
    return sortedKeys.map(key => ({
      dateLabel: formatDateLabel(key),
      dateKey: key,
      records: groups[key]
    }));
  }

  function renderTimeline(records) {
  container.innerHTML = '';

  const timeline = document.createElement('div');
  timeline.className = 'timeline';

  const dateGroups = groupRecordsByDate(records);

  dateGroups.forEach((group, groupIndex) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'timeline-date-group';
    groupEl.dataset.dateKey = group.dateKey;

    // Date row
    const dateRow = document.createElement('div');
    dateRow.className = 'timeline-row';
    const dateDot = document.createElement('div');
    dateDot.className = 'timeline-dot date';
    dateRow.appendChild(dateDot);
    const dateLabel = document.createElement('div');
    dateLabel.className = 'timeline-date-label';
    dateLabel.innerHTML = `
      <span class="timeline-date-text">${group.dateLabel}</span>
      <span class="timeline-date-count">${group.records.length}</span>
    `;
    dateRow.appendChild(dateLabel);
    groupEl.appendChild(dateRow);

    // Card rows
    group.records.forEach((record, index) => {
      const cardRow = document.createElement('div');
      cardRow.className = 'timeline-row';
      const cardDot = document.createElement('div');
      cardDot.className = 'timeline-dot card';
      cardRow.appendChild(cardDot);
      const cardWrapper = document.createElement('div');
      cardWrapper.className = 'timeline-card-wrapper';
      cardWrapper.dataset.id = record.id;
      cardWrapper.appendChild(createCard(record, index, records.length));
      cardRow.appendChild(cardWrapper);
      groupEl.appendChild(cardRow);
    });

    timeline.appendChild(groupEl);
  });

  container.appendChild(timeline);
}

  async function loadRecords() {
    try {
      const records = await window.MentoStorage.getAllRecords();

      if (!records || records.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        currentRecords = [];
        return;
      }

      emptyState.style.display = 'none';

      // Sort by newest first
      records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Check if data actually changed by comparing IDs
      const newIds = records.map(r => r.id).join(',');
      const currentIds = currentRecords.map(r => r.id).join(',');

      if (newIds === currentIds) {
        // No new records added, only screenshot counts changed
        // Update currentRecords but don't re-render to preserve UI state
        currentRecords = records;
        return;
      }

      // Save current playing state
      const currentPlayingId = currentAudio?.id;
      const currentTime = currentAudio?.currentTime;
      const wasPlaying = currentAudio && !currentAudio.paused;

      // Only add new cards instead of full re-render
      const existingIds = new Set(currentRecords.map(r => r.id));
      const newRecords = records.filter(r => !existingIds.has(r.id));

      if (newRecords.length > 0 && currentRecords.length > 0) {
        // Incremental update: insert new records into existing timeline
        newRecords.forEach((record) => {
          const dateKey = new Date(record.timestamp).toDateString();
          const dateLabel = formatDateLabel(record.timestamp);

          let groupEl = container.querySelector(`.timeline-date-group[data-date-key="${dateKey}"]`);

          if (groupEl) {
            const cardRow = document.createElement('div');
            cardRow.className = 'timeline-row';
            const cardDot = document.createElement('div');
            cardDot.className = 'timeline-dot card';
            cardRow.appendChild(cardDot);
            const cardWrapper = document.createElement('div');
            cardWrapper.className = 'timeline-card-wrapper new-card';
            cardWrapper.dataset.id = record.id;
            cardWrapper.appendChild(createCard(record, 0, records.length));
            cardRow.appendChild(cardWrapper);
            groupEl.insertBefore(cardRow, groupEl.children[1]);

            const countEl = groupEl.querySelector('.timeline-date-count');
            if (countEl) {
              countEl.textContent = parseInt(countEl.textContent) + 1;
            }
          } else {
            groupEl = document.createElement('div');
            groupEl.className = 'timeline-date-group';
            groupEl.dataset.dateKey = dateKey;

            const dateRow = document.createElement('div');
            dateRow.className = 'timeline-row';
            const dateDot = document.createElement('div');
            dateDot.className = 'timeline-dot date';
            dateRow.appendChild(dateDot);
            const dateLabelEl = document.createElement('div');
            dateLabelEl.className = 'timeline-date-label';
            dateLabelEl.innerHTML = `
              <span class="timeline-date-text">${dateLabel}</span>
              <span class="timeline-date-count">1</span>
            `;
            dateRow.appendChild(dateLabelEl);
            groupEl.appendChild(dateRow);

            const cardRow = document.createElement('div');
            cardRow.className = 'timeline-row';
            const cardDot = document.createElement('div');
            cardDot.className = 'timeline-dot card';
            cardRow.appendChild(cardDot);
            const cardWrapper = document.createElement('div');
            cardWrapper.className = 'timeline-card-wrapper new-card';
            cardWrapper.dataset.id = record.id;
            cardWrapper.appendChild(createCard(record, 0, records.length));
            cardRow.appendChild(cardWrapper);
            groupEl.appendChild(cardRow);

            const timeline = container.querySelector('.timeline');
            timeline.insertBefore(groupEl, timeline.firstChild);
          }
        });
      } else {
        // Save expanded grid states before full render
        const expandedRecordIds = new Set();
        document.querySelectorAll('.screenshots-grid.expanded').forEach(grid => {
          const card = grid.closest('.timeline-card-wrapper');
          if (card && card.dataset.id) {
            expandedRecordIds.add(card.dataset.id);
          }
        });

        // Full render for initial load or major changes
        renderTimeline(records);

        // Restore expanded grid states after full render
        if (expandedRecordIds.size > 0) {
          requestAnimationFrame(() => {
            document.querySelectorAll('.timeline-card-wrapper').forEach(card => {
              if (expandedRecordIds.has(card.dataset.id)) {
                const grid = card.querySelector('.screenshots-grid');
                if (grid) {
                  grid.classList.add('expanded');
                }
              }
            });
          });
        }
      }

      currentRecords = records;

      // Restore playing state if the same audio still exists
      if (currentPlayingId && wasPlaying) {
        const newAudio = document.getElementById(currentPlayingId);
        if (newAudio) {
          newAudio.currentTime = currentTime || 0;
          newAudio.play().catch(() => {});
        }
      }

    } catch (error) {
      console.error('Failed to load records:', error);
      emptyState.textContent = 'Error loading recordings.';
      emptyState.style.display = 'block';
    }
  }

  await loadRecords();

  // Auto-refresh every 3 seconds to show new recordings
  const refreshInterval = setInterval(async () => {
    if (!pendingDelete && !pendingScreenshotDelete && finalizingDeleteCount === 0) {
      const scrollY = window.scrollY;
      await loadRecords();
      window.scrollTo(0, scrollY);
    }
  }, 3000);

  window.addEventListener('pagehide', () => {
    clearInterval(refreshInterval);
  });
});
