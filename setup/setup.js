document.getElementById('grantBtn').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop tracks immediately, we just needed the permission saved in Chrome
    stream.getTracks().forEach(track => track.stop());
    
    // Update UI
    document.getElementById('grantBtn').style.display = 'none';
    document.getElementById('successMsg').style.display = 'block';
  } catch (error) {
    alert("Permission was denied. Please check the URL bar icon to allow microphone access manually.");
    console.error(error);
  }
});