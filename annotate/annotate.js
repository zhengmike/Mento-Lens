document.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('screenshotCanvas');
  const ctx = canvas.getContext('2d');
  const canvasWrapper = document.getElementById('canvasWrapper');
  const colorPicker = document.getElementById('colorPicker');
  const toolBtns = document.querySelectorAll('.tool-btn');
  const undoBtn = document.getElementById('undoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const saveBtn = document.getElementById('saveBtn');

  // State
  let currentTool = 'select';
  let currentColor = '#ba1a1a';
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  let screenshotImage = null;
  let annotations = []; // Array of {type, x, y, x2, y2, text, color}
  let historyStack = [];
  let textInput = null;

  // Get record ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const recordId = urlParams.get('id');

  if (!recordId) {
    alert('No record ID provided');
    window.close();
    return;
  }

  // Load screenshot from storage
  async function loadScreenshot() {
    try {
      const record = await window.MentoStorage.getRecord(recordId);
      if (!record || !record.screenshotBase64) {
        alert('No screenshot found for this record');
        window.close();
        return;
      }

      screenshotImage = new Image();
      screenshotImage.onload = () => {
        canvas.width = screenshotImage.width;
        canvas.height = screenshotImage.height;
        redraw();
      };
      screenshotImage.src = record.screenshotBase64;
    } catch (err) {
      console.error('Failed to load screenshot:', err);
      alert('Failed to load screenshot');
    }
  }

  // Redraw everything
  function redraw() {
    if (!screenshotImage) return;

    // Clear and draw screenshot
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(screenshotImage, 0, 0);

    // Draw all annotations
    annotations.forEach(ann => drawAnnotation(ann));
  }

  function drawAnnotation(ann) {
    ctx.strokeStyle = ann.color;
    ctx.fillStyle = ann.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (ann.type) {
      case 'rect':
        ctx.strokeRect(ann.x, ann.y, ann.x2 - ann.x, ann.y2 - ann.y);
        break;
      case 'arrow':
        drawArrow(ann.x, ann.y, ann.x2, ann.y2, ann.color);
        break;
      case 'text':
        ctx.font = 'bold 18px Roboto, sans-serif';
        ctx.fillText(ann.text, ann.x, ann.y);
        break;
    }
  }

  function drawArrow(x1, y1, x2, y2, color) {
    const headLength = 15;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrow head
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLength * Math.cos(angle - Math.PI / 6),
      y2 - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      x2 - headLength * Math.cos(angle + Math.PI / 6),
      y2 - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  // Tool selection
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toolBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
    });
  });

  // Color picker
  colorPicker.addEventListener('input', (e) => {
    currentColor = e.target.value;
  });

  // Canvas mouse events
  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  canvas.addEventListener('mousedown', (e) => {
    if (currentTool === 'select') return;

    const coords = getCanvasCoords(e);
    isDrawing = true;
    startX = coords.x;
    startY = coords.y;

    if (currentTool === 'text') {
      isDrawing = false;
      createTextInput(startX, startY);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing || currentTool === 'text') return;

    const coords = getCanvasCoords(e);

    // Redraw base + current annotation preview
    redraw();
    drawAnnotation({
      type: currentTool,
      x: startX,
      y: startY,
      x2: coords.x,
      y2: coords.y,
      color: currentColor
    });
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!isDrawing || currentTool === 'text') return;

    const coords = getCanvasCoords(e);
    isDrawing = false;

    // Save to history before adding
    historyStack.push([...annotations]);

    annotations.push({
      type: currentTool,
      x: startX,
      y: startY,
      x2: coords.x,
      y2: coords.y,
      color: currentColor
    });

    redraw();
  });

  // Text input handling
  function createTextInput(x, y) {
    if (textInput) {
      finalizeText();
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'text-input-overlay';
    textInput.style.left = (x * scaleX) + 'px';
    textInput.style.top = (y * scaleY) + 'px';
    textInput.style.color = currentColor;
    textInput.style.borderColor = currentColor;
    textInput.placeholder = 'Type here...';

    canvasWrapper.appendChild(textInput);
    textInput.focus();

    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finalizeText();
      }
    });

    textInput.addEventListener('blur', finalizeText);
  }

  function finalizeText() {
    if (!textInput || !textInput.value.trim()) {
      if (textInput) {
        textInput.remove();
        textInput = null;
      }
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = parseFloat(textInput.style.left) * scaleX;
    const y = parseFloat(textInput.style.top) * scaleY;

    historyStack.push([...annotations]);
    annotations.push({
      type: 'text',
      x: x,
      y: y + 18, // Offset for text baseline
      text: textInput.value.trim(),
      color: textInput.style.color
    });

    textInput.remove();
    textInput = null;
    redraw();
  }

  // Undo
  undoBtn.addEventListener('click', () => {
    if (historyStack.length > 0) {
      annotations = historyStack.pop();
      redraw();
    }
  });

  // Clear all annotations
  clearBtn.addEventListener('click', () => {
    if (annotations.length > 0) {
      historyStack.push([...annotations]);
      annotations = [];
      redraw();
    }
  });

  // Save annotated screenshot
  saveBtn.addEventListener('click', async () => {
    try {
      // Finalize any active text input
      if (textInput) {
        finalizeText();
      }

      // Convert canvas to base64
      const annotatedDataUrl = canvas.toDataURL('image/png');

      // Update record with annotated screenshot
      await window.MentoStorage.updateRecord(recordId, {
        screenshotBase64: annotatedDataUrl,
        annotations: annotations
      });

      // Close window
      window.close();
    } catch (err) {
      console.error('Failed to save annotation:', err);
      alert('Failed to save annotation');
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      undoBtn.click();
    }
  });

  // Load screenshot on start
  await loadScreenshot();
});