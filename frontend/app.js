let floorPlans = [
  {
    id: '1b1',
    name: 'Unit A1',
    layout: '1 Bedroom / 1 Bath',
    displaySqft: '689 sq ft',
    price: 'Starting at $2,040',
    available: 'Available now',
    imageUrl: '/floor_plans/1b1.png'
  },
  {
    id: '2b2',
    name: 'Unit B2',
    layout: '2 Bedroom / 2 Bath',
    displaySqft: '988 sq ft',
    price: 'Starting at $2,620',
    available: '2 homes left',
    imageUrl: '/floor_plans/2b2.png'
  },
  {
    id: '3b2',
    name: 'Unit C3',
    layout: '3 Bedroom / 2 Bath',
    displaySqft: '1,250 sq ft',
    price: 'Starting at $3,180',
    available: 'Available June 7',
    imageUrl: '/floor_plans/3b2.png'
  }
];

const progressSteps = [
  'Validating selected floor plan',
  'Extracting room dimensions',
  'Reading Pinterest board',
  'Building structured vibe report',
  'Preparing Layer 3 handoff',
  'Ready for staged images and fal video',
  'Showing personalized preview shell'
];

let selectedPlan = floorPlans[0];
let requestedEdit = null;
let placement = null;
let currentPipelineResult = null;
let currentJob = null;
let currentJobId = null;
let jobEvents = null;

const views = {
  portal: document.querySelector('#portal-view'),
  personalize: document.querySelector('#personalize-view'),
  generation: document.querySelector('#generation-view'),
  results: document.querySelector('#results-view'),
  agent: document.querySelector('#agent-view')
};

const floorplanGrid = document.querySelector('#floorplan-grid');
const selectedPlanTitle = document.querySelector('#selected-plan-title');
const selectedPlanPreview = document.querySelector('#selected-plan-preview');
const resultsPlanPreview = document.querySelector('#results-plan-preview');
const selectedPlanMeta = document.querySelector('#selected-plan-meta');
const generationPlanChip = document.querySelector('#generation-plan-chip');
const progressList = document.querySelector('#progress-list');
const progressCaption = document.querySelector('#progress-caption');
const chatLog = document.querySelector('#chat-log');
const placementCanvas = document.querySelector('#placement-canvas');
const placementMarker = document.querySelector('#placement-marker');
const placementInstruction = document.querySelector('#placement-instruction');
const regenerateButton = document.querySelector('#regenerate-section');
const cacheNote = document.querySelector('#cache-note');
const runtimeRoomList = document.querySelector('#runtime-room-list');
const roomStrip = document.querySelector('#room-strip');
const generationPinterestGallery = document.querySelector('#generation-pinterest-gallery');
const resultsPinterestGallery = document.querySelector('#results-pinterest-gallery');

loadFloorPlans();
renderProgressSteps();
setView('portal');
addChatMessage('agent', 'After you watch the video, ask for a specific change. I can isolate the affected room and keep the rest of the cached video intact.');

document.querySelector('#back-to-plans').addEventListener('click', () => setView('portal'));
document.querySelector('#open-agent').addEventListener('click', () => setView('agent'));
document.querySelector('#back-to-results').addEventListener('click', () => setView('results'));

document.querySelector('#personalization-form').addEventListener('submit', (event) => {
  event.preventDefault();
  setView('generation');
  runGenerationSequence(new FormData(event.currentTarget));
});

document.querySelector('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#chat-message');
  const message = input.value.trim();
  if (!message) return;

  requestedEdit = message;
  placement = null;
  placementMarker.classList.add('is-hidden');
  regenerateButton.disabled = true;
  placementInstruction.textContent = 'Click where the object should be placed.';

  addChatMessage('user', message);
  addChatMessage('agent', 'I found the living room section. Click the image where you want the tall whiteboard, then I will regenerate only that room segment.');
});

placementCanvas.addEventListener('click', (event) => {
  if (!requestedEdit) return;

  const rect = placementCanvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  placement = { x, y };

  placementMarker.style.left = `${x}%`;
  placementMarker.style.top = `${y}%`;
  placementMarker.classList.remove('is-hidden');
  regenerateButton.disabled = false;
  placementInstruction.textContent = 'Placement selected. Regenerate this room section when ready.';
});

regenerateButton.addEventListener('click', () => {
  if (!placement) return;

  regenerateButton.disabled = true;
  cacheNote.textContent = 'Regenerating living room still and fal video segment. Bedroom and kitchen clips remain cached.';
  addChatMessage('agent', `Got it. I will place the whiteboard around ${Math.round(placement.x)}% across and ${Math.round(placement.y)}% down in the living room frame.`);

  window.setTimeout(() => {
    cacheNote.textContent = 'Living room segment regenerated. Final video reassembled from 1 new segment and cached unchanged segments.';
    addChatMessage('agent', 'Updated preview is ready. I reused the cached unchanged room segments and replaced only the living room section.');
    regenerateButton.disabled = false;
  }, 1300);
});

runtimeRoomList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-room-action]');
  if (!button || !currentJobId) return;

  const roomId = button.dataset.roomId;
  const action = button.dataset.roomAction;
  button.disabled = true;

  try {
    if (action === 'approve-still') {
      await approveStill(roomId, true);
    } else if (action === 'reject-still') {
      await approveStill(roomId, false);
    } else if (action === 'retry-still-pin') {
      await retryRoom(roomId, 'still', [button.dataset.pinId]);
    } else if (action === 'retry-still') {
      await retryRoom(roomId, 'still');
    } else if (action === 'retry-video') {
      await retryRoom(roomId, 'video');
    }
    await refreshJob(currentJobId);
  } catch (error) {
    progressCaption.textContent = error.message;
    button.disabled = false;
  }
});

document.querySelectorAll('[data-view-jump]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.viewJump;
    if (target === 'results' && views.results.classList.contains('is-hidden')) {
      setView('personalize');
      return;
    }
    setView(target);
  });
});

async function loadFloorPlans() {
  try {
    const response = await fetch('/api/floor-plans');
    if (response.ok) {
      const data = await response.json();
      floorPlans = data.floor_plans;
      selectedPlan = floorPlans[0];
    }
  } catch {
    // Static file fallback keeps the mock usable if opened without the dev server.
  }

  renderFloorPlans();
  renderSelectedPlan();
}

function renderFloorPlans() {
  floorplanGrid.innerHTML = floorPlans.map((plan) => `
    <article class="floorplan-card ${plan.id === selectedPlan.id ? 'is-selected' : ''}">
      <div class="plan-diagram">${renderFloorPlanMedia(plan, `${plan.name} floor plan`)}</div>
      <div class="plan-card-body">
        <div>
          <h3>${plan.name}</h3>
          <p>${plan.layout}</p>
        </div>
        <dl>
          <div><dt>Size</dt><dd>${plan.displaySqft}</dd></div>
          <div><dt>Rent</dt><dd>${plan.price}</dd></div>
          <div><dt>Status</dt><dd>${plan.available}</dd></div>
        </dl>
        <button class="primary-button" type="button" data-plan-id="${plan.id}">Visualize with your style</button>
      </div>
    </article>
  `).join('');

  floorplanGrid.querySelectorAll('[data-plan-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedPlan = floorPlans.find((plan) => plan.id === button.dataset.planId);
      renderFloorPlans();
      renderSelectedPlan();
      setView('personalize');
    });
  });
}

function renderSelectedPlan() {
  selectedPlanTitle.textContent = `${selectedPlan.name} · ${selectedPlan.layout}`;
  generationPlanChip.textContent = selectedPlan.name;
  selectedPlanPreview.innerHTML = renderFloorPlanMedia(selectedPlan, `${selectedPlan.name} selected floor plan`);
  resultsPlanPreview.innerHTML = renderFloorPlanMedia(selectedPlan, `${selectedPlan.name} selected floor plan`);
  selectedPlanMeta.innerHTML = `
    <span>${selectedPlan.displaySqft}</span>
    <span>${selectedPlan.price}</span>
    <span>${selectedPlan.available}</span>
  `;
}

function renderFloorPlanMedia(plan, altText) {
  return `<img class="floor-plan-image" src="${plan.imageUrl}" alt="${altText}">`;
}

function renderProgressSteps(activeIndex = -1, complete = false) {
  progressList.innerHTML = progressSteps.map((step, index) => {
    const state = complete || index < activeIndex ? 'is-done' : index === activeIndex ? 'is-active' : '';
    return `
      <div class="progress-step ${state}">
        <div class="step-dot"></div>
        <div>
          <strong>${step}</strong>
          <span>${state === 'is-done' ? 'Complete' : state === 'is-active' ? 'In progress' : 'Waiting'}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function runGenerationSequence(formData) {
  let index = 0;
  renderProgressSteps(index);
  progressCaption.textContent = 'Creating a backend job and starting the room pipeline.';

  const jobPromise = createJob({
    floor_plan_id: selectedPlan.id,
    pinterest_board_url: formData.get('pinterestUrl'),
    brief: formData.get('brief'),
    objects: formData.getAll('objects'),
    platform: 'all'
  });

  const interval = window.setInterval(() => {
    index = Math.min(index + 1, progressSteps.length - 1);
    renderProgressSteps(index);
  }, 900);

  try {
    const job = await jobPromise;
    window.clearInterval(interval);
    renderProgressSteps(1);
    currentJobId = job.job_id;
    subscribeToJob(currentJobId);
    await refreshJob(currentJobId);
    progressCaption.textContent = 'Backend job created. Waiting for room events.';
  } catch (error) {
    window.clearInterval(interval);
    renderProgressSteps(index);
    progressCaption.textContent = error.message;
  }
}

async function createJob(body) {
  const response = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error ?? 'Job creation failed.');
  }

  return result;
}

async function runPipeline(body) {
  const response = await fetch('/api/pipeline/layers-1-3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error ?? 'Pipeline failed.');
  }

  return result;
}

function subscribeToJob(jobId) {
  if (jobEvents) jobEvents.close();

  jobEvents = new EventSource(`/api/jobs/${jobId}/events`);
  jobEvents.onmessage = async (message) => {
    const event = JSON.parse(message.data);
    progressCaption.textContent = event.message;
    await refreshJob(jobId);
  };
  jobEvents.onerror = () => {
    progressCaption.textContent = 'Job event stream disconnected. Polling latest state.';
    refreshJob(jobId).catch(() => {});
  };
}

async function refreshJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`);
  const job = await response.json();
  if (!response.ok) {
    throw new Error(job.error ?? 'Could not load job.');
  }

  currentJob = job;
  currentPipelineResult = job;
  renderPipelineResult(job);
  renderPinterestReferences(job);
  renderRuntimeRooms(job);

  if (job.status === 'completed') {
    renderProgressSteps(progressSteps.length, true);
    progressCaption.textContent = 'All approved room clips are ready.';
    window.setTimeout(() => setView('results'), 700);
  }

  if (job.status === 'failed') {
    progressCaption.textContent = job.warnings?.at(-1)?.message ?? 'Job failed.';
  }
}

async function approveStill(roomId, approved) {
  const response = await fetch(`/api/jobs/${currentJobId}/rooms/${roomId}/still-approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved })
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? 'Still approval failed.');
  }
}

async function retryRoom(roomId, target, referencePinIds = []) {
  const response = await fetch(`/api/jobs/${currentJobId}/rooms/${roomId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, reference_pin_ids: referencePinIds })
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? 'Retry request failed.');
  }
}

function renderPipelineResult(result) {
  const vibeReport = result.handoff?.vibe_report;
  const profile = result.profile;

  if (vibeReport) {
    document.querySelector('#vibe-name').textContent = vibeReport.aesthetic_name;
    document.querySelector('#vibe-summary').textContent = vibeReport.summary;
    document.querySelector('#vibe-lighting').textContent = vibeReport.lighting_mood;
    document.querySelector('#vibe-materials').textContent = vibeReport.materials.slice(0, 3).join(', ');
    document.querySelector('#vibe-avoid').textContent = vibeReport.avoid.slice(0, 3).join(', ');
  }

  if (profile?.aesthetic_profile) {
    document.querySelector('#vibe-density').textContent = profile.aesthetic_profile.density;
  }
}

function renderPinterestReferences(job) {
  const pins = (job.handoff?.pinterest_intelligence?.pins ?? []).filter((pin) => pin.image_url).slice(0, 9);
  const markup = pins.length === 0
    ? ''
    : `
      <div class="reference-gallery-header">
        <div>
          <div class="eyebrow">Pinterest references</div>
          <h3>Scraped style images</h3>
        </div>
        <span>${pins.length} pins loaded</span>
      </div>
      <div class="reference-grid">
        ${pins.map((pin) => renderPinterestPin(pin)).join('')}
      </div>
    `;

  if (generationPinterestGallery) generationPinterestGallery.innerHTML = markup;
  if (resultsPinterestGallery) resultsPinterestGallery.innerHTML = markup;
}

function renderRuntimeRooms(job) {
  if (!runtimeRoomList || !Array.isArray(job.rooms)) return;
  const pins = (job.handoff?.pinterest_intelligence?.pins ?? []).filter((pin) => pin.image_url).slice(0, 9);

  runtimeRoomList.innerHTML = job.rooms.map((room) => {
    const stillUrl = room.artifacts?.styled_image_url;
    const videoUrl = room.artifacts?.video_url;
    const score = room.scores?.overall == null ? 'Waiting' : `${Number(room.scores.overall).toFixed(1)} / 10`;
    const needsStillReview = room.state === 'STILL_REVIEW_READY' && !room.review?.still_approved;
    const hasVideo = Boolean(videoUrl);
    const selectedPinIds = new Set(room.review?.reference_pin_ids ?? []);
    const reviewPins = needsStillReview ? pins.slice(0, 6) : [];

    return `
      <article class="runtime-room-card">
        <div class="runtime-media">
          ${hasVideo ? `<video src="${escapeHtml(videoUrl)}" controls playsinline></video>` : stillUrl ? `<img src="${escapeHtml(stillUrl)}" alt="${escapeHtml(room.room_name)} still">` : '<div class="runtime-placeholder">Waiting for media</div>'}
        </div>
        <div class="runtime-room-body">
          <div>
            <strong>${escapeHtml(room.room_name)}</strong>
            <span>${escapeHtml(room.state.replaceAll('_', ' ').toLowerCase())}</span>
          </div>
          <dl>
            <div><dt>Score</dt><dd>${escapeHtml(score)}</dd></div>
            <div><dt>Still attempts</dt><dd>${room.still_attempt_count}</dd></div>
            <div><dt>Video attempts</dt><dd>${room.video_attempt_count}</dd></div>
          </dl>
          ${needsStillReview && reviewPins.length ? `
            <div class="runtime-reference-panel">
              <div class="runtime-reference-title">Retry from a scraped Pinterest image</div>
              <div class="runtime-reference-grid">
                ${reviewPins.map((pin) => `
                  <article class="runtime-reference-card ${selectedPinIds.has(pin.pin_id) ? 'is-selected' : ''}">
                    <img src="${escapeHtml(pin.image_url)}" alt="${escapeHtml(pin.title ?? room.room_name)}">
                    <div>
                      <strong>${escapeHtml(pin.title ?? 'Untitled pin')}</strong>
                      <span>${escapeHtml(pin.cluster_label ?? 'scraped pin')}</span>
                    </div>
                    <button class="ghost-button" data-room-action="retry-still-pin" data-room-id="${escapeHtml(room.room_id)}" data-pin-id="${escapeHtml(pin.pin_id)}" type="button">Use this pin</button>
                  </article>
                `).join('')}
              </div>
            </div>
          ` : ''}
          <div class="runtime-actions">
            ${needsStillReview ? `<button class="primary-button" data-room-action="approve-still" data-room-id="${escapeHtml(room.room_id)}" type="button">Approve still</button><button class="ghost-button" data-room-action="reject-still" data-room-id="${escapeHtml(room.room_id)}" type="button">Reject still</button><button class="ghost-button" data-room-action="retry-still" data-room-id="${escapeHtml(room.room_id)}" type="button">Retry still</button>` : ''}
            ${room.state === 'VIDEO_REVIEW_READY' ? `<button class="ghost-button" data-room-action="retry-video" data-room-id="${escapeHtml(room.room_id)}" type="button">Retry video</button>` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');

  if (roomStrip) {
    const approvedRooms = job.rooms.filter((room) => room.state === 'APPROVED');
    if (approvedRooms.length > 0) {
      roomStrip.innerHTML = approvedRooms.map((room) => `
        <article>
          ${room.artifacts?.video_url ? `<video src="${escapeHtml(room.artifacts.video_url)}" controls playsinline></video>` : `<img src="${escapeHtml(room.artifacts?.styled_image_url ?? '')}" alt="${escapeHtml(room.room_name)} still">`}
          <div><strong>${escapeHtml(room.room_name)}</strong><span>${escapeHtml(room.current_motion_mode ?? 'room clip')} · ${room.video_attempt_count} attempt</span></div>
        </article>
      `).join('');
    }
  }
}

function renderPinterestPin(pin) {
  return `
    <article class="reference-card">
      <img src="${escapeHtml(pin.image_url)}" alt="${escapeHtml(pin.title ?? 'Pinterest reference')}">
      <div>
        <strong>${escapeHtml(pin.title ?? 'Untitled pin')}</strong>
        <span>${escapeHtml(pin.cluster_label ?? 'scraped from Pinterest')}</span>
      </div>
    </article>
  `;
}

function setView(viewName) {
  Object.entries(views).forEach(([name, element]) => {
    element.classList.toggle('is-hidden', name !== viewName);
  });

  document.querySelectorAll('[data-view-jump]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.viewJump === viewName);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function addChatMessage(sender, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender === 'user' ? 'is-user' : 'is-agent'}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}
