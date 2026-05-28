// --- Phantom Veil — Hand Tracker ---
// MediaPipe Hands wrapper with pinch detection and device adaptation

export function createHandTracker(canvas) {
  let hands = null;
  let camera = null;
  let videoEl = null;
  let isReady = false;
  let activeHands = [];
  let onResultsCallback = null;
  let cameraFacingMode = 'user';

  // Auto-adapted threshold
  let pinchThresholdLow = 0.05;
  let pinchThresholdHigh = 0.08;
  let interactionRadius = 150;

  function getScreenCoords(landmark, canvasW, canvasH) {
    return {
      x: (1 - landmark.x) * canvasW,
      y: landmark.y * canvasH,
    };
  }

  function adaptThresholds() {
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const sw = window.innerWidth;
    let deviceType = 'laptop';
    let fov = null;

    if (isMobile && sw < 768) {
      deviceType = 'phone';
      pinchThresholdLow = 0.06;
      pinchThresholdHigh = 0.09;
      interactionRadius = 180;
    } else if (isMobile) {
      deviceType = 'tablet';
      pinchThresholdLow = 0.055;
      pinchThresholdHigh = 0.085;
      interactionRadius = 165;
    } else {
      pinchThresholdLow = 0.05;
      pinchThresholdHigh = 0.08;
      interactionRadius = 150;
    }

    // If FOV is available from camera, refine
    if (camera && camera.videoTrack) {
      const settings = camera.videoTrack.getSettings();
      if (settings.fieldOfView) {
        fov = settings.fieldOfView;
        const factor = fov / 70;
        pinchThresholdLow = 0.05 * factor;
        pinchThresholdHigh = 0.08 * factor;
        interactionRadius = 150 * factor;
      }
    }

    console.log(`HandTracker: device=${deviceType}${fov ? ' fov=' + fov.toFixed(0) : ''} pinch=[${pinchThresholdLow.toFixed(3)},${pinchThresholdHigh.toFixed(3)}] radius=${interactionRadius}`);
  }

  async function init(facingMode = 'user') {
    cameraFacingMode = facingMode;
    videoEl = document.createElement('video');
    videoEl.setAttribute('playsinline', '');
    videoEl.muted = true;
    videoEl.loop = true;
    videoEl.style.display = 'none';
    document.body.appendChild(videoEl);

    hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results) => {
      processResults(results);
      if (onResultsCallback) onResultsCallback(activeHands);
    });

    camera = new window.Camera(videoEl, {
      onFrame: async () => {
        await hands.send({ image: videoEl });
      },
      width: 640,
      height: 480,
      facingMode: cameraFacingMode,
    });

    await camera.start();
    isReady = true;
    adaptThresholds();
  }

  function processResults(results) {
    const prevHands = activeHands;
    const newHands = [];

    if (results.multiHandLandmarks) {
      const w = canvas.width;
      const h = canvas.height;

      for (const landmarks of results.multiHandLandmarks) {
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
        const mid = getScreenCoords({
          x: (indexTip.x + thumbTip.x) / 2,
          y: (indexTip.y + thumbTip.y) / 2,
        }, w, h);

        // Match to previous hand to maintain state
        let prev = null;
        let minD = Infinity;
        for (const ph of prevHands) {
          const d = Math.hypot(ph.x - mid.x, ph.y - mid.y);
          if (d < 200 && d < minD) {
            minD = d;
            prev = ph;
          }
        }

        const wasPinching = prev ? prev.isPinching : false;
        const threshold = wasPinching ? pinchThresholdHigh : pinchThresholdLow;
        const isPinching = pinchDist < threshold;

        newHands.push({
          x: mid.x,
          y: mid.y,
          isPinching,
          grabbedIdx: prev ? prev.grabbedIdx : null,
          id: prev ? prev.id : Math.random(),
        });
      }
    }
    activeHands = newHands;
  }

  function onResults(fn) {
    onResultsCallback = fn;
  }

  function getHands() {
    return activeHands;
  }

  function getInteractionRadius() {
    return interactionRadius;
  }

  async function destroy() {
    if (camera) {
      await camera.stop();
      camera = null;
    }
    if (videoEl && videoEl.parentNode) {
      videoEl.parentNode.removeChild(videoEl);
      videoEl = null;
    }
    hands = null;
    activeHands = [];
    isReady = false;
  }

  function getVideoElement() {
    return videoEl;
  }

  function getCameraFacingMode() {
    return cameraFacingMode;
  }

  return { init, onResults, getHands, getInteractionRadius, getVideoElement, getCameraFacingMode, destroy, get isReady() { return isReady; } };
}
