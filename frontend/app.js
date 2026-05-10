let floorPlans = [
  {
    id: '1b1',
    name: 'Unit A1',
    layout: '1 Bedroom / 1 Bath',
    displaySqft: '689 sq ft',
    price: 'Starting at $2,040',
    available: 'Available now',
    imageUrl: '/floor_plans/1b1.png',
    hotspots: [
      { key: 'dream-1', label: 'Dream', roomType: 'bedroom', occurrence: 0, points: '13,9 50,9 50,39 13,39' },
      { key: 'revive-1', label: 'Revive', roomType: 'bathroom', occurrence: 0, points: '72,9 96,9 96,31 72,31' },
      { key: 'surf-1', label: 'Surf', roomType: 'foyer', occurrence: 0, points: '26,37 50,37 50,53 26,53' },
      { key: 'taste-1', label: 'Taste', roomType: 'kitchen', occurrence: 0, points: '64,43 94,43 94,69 64,69' },
      { key: 'nest-1', label: 'Nest', roomType: 'living_room', occurrence: 0, points: '17,53 63,53 63,86 17,86' },
      { key: 'dine-1', label: 'Dine', roomType: 'dining', occurrence: 0, points: '62,55 93,55 93,78 62,78' },
      { key: 'relax-1', label: 'Relax', roomType: 'patio', occurrence: 0, points: '32,74 60,74 60,92 32,92' }
    ]
  },
  {
    id: '2b2',
    name: 'Unit B2',
    layout: '2 Bedroom / 2 Bath',
    displaySqft: '988 sq ft',
    price: 'Starting at $2,620',
    available: '2 homes left',
    imageUrl: '/floor_plans/2b2.png',
    hotspots: [
      { key: 'dream-1', label: 'Dream', roomType: 'bedroom', occurrence: 0, points: '18,10 66,10 66,35 18,35' },
      { key: 'relax-1', label: 'Relax', roomType: 'patio', occurrence: 0, points: '76,5 96,5 96,34 76,34' },
      { key: 'revive-1', label: 'Revive', roomType: 'bathroom', occurrence: 0, points: '3,19 21,19 21,42 3,42' },
      { key: 'revive-2', label: 'Revive', roomType: 'bathroom', occurrence: 1, points: '3,43 21,43 21,61 3,61' },
      { key: 'taste-1', label: 'Taste', roomType: 'kitchen', occurrence: 0, points: '43,34 79,34 79,58 43,58' },
      { key: 'dine-1', label: 'Dine', roomType: 'dining', occurrence: 0, points: '80,34 98,34 98,61 80,61' },
      { key: 'dream-2', label: 'Dream', roomType: 'bedroom', occurrence: 1, points: '13,56 44,56 44,92 13,92' },
      { key: 'nest-1', label: 'Nest', roomType: 'living_room', occurrence: 0, points: '48,54 92,54 92,88 48,88' },
      { key: 'surf-1', label: 'Surf', roomType: 'foyer', occurrence: 0, points: '47,62 60,62 60,83 47,83' }
    ]
  },
  {
    id: '3b2',
    name: 'Unit C3',
    layout: '3 Bedroom / 2 Bath',
    displaySqft: '1,250 sq ft',
    price: 'Starting at $3,180',
    available: 'Available June 7',
    imageUrl: '/floor_plans/3b2.png',
    hotspots: [
      { key: 'watch-1', label: 'Watch', roomType: 'other', occurrence: 0, points: '46,0 61,0 61,8 46,8' },
      { key: 'nest-1', label: 'Nest', roomType: 'living_room', occurrence: 0, points: '38,8 70,8 70,28 38,28' },
      { key: 'relax-1', label: 'Relax', roomType: 'patio', occurrence: 0, points: '70,9 94,9 94,31 70,31' },
      { key: 'dream-1', label: 'Dream', roomType: 'bedroom', occurrence: 0, points: '4,33 26,33 26,57 4,57' },
      { key: 'taste-1', label: 'Taste', roomType: 'kitchen', occurrence: 0, points: '53,31 81,31 81,52 53,52' },
      { key: 'dine-1', label: 'Dine', roomType: 'dining', occurrence: 0, points: '81,31 98,31 98,56 81,56' },
      { key: 'revive-1', label: 'Revive', roomType: 'bathroom', occurrence: 0, points: '3,57 23,57 23,77 3,77' },
      { key: 'surf-1', label: 'Surf', roomType: 'foyer', occurrence: 0, points: '45,53 57,53 57,70 45,70' },
      { key: 'dream-2', label: 'Dream', roomType: 'bedroom', occurrence: 1, points: '54,55 84,55 84,78 54,78' },
      { key: 'dream-3', label: 'Dream', roomType: 'bedroom', occurrence: 2, points: '22,70 56,70 56,98 22,98' }
    ]
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
const activePlanHotspots = new Map();
let selectedAgentRoomId = null;

const views = {
  portal: document.querySelector('#portal-view'),
  personalize: document.querySelector('#personalize-view'),
  generation: document.querySelector('#generation-view'),
  results: document.querySelector('#results-view'),
  video: document.querySelector('#video-view'),
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
const generatedStillsGallery = document.querySelector('#generated-stills-gallery');
const sceneEditorList = document.querySelector('#scene-editor-list');
const editorMaxClipSeconds = document.querySelector('#editor-max-clip-seconds');
const editorMaxClipLabel = document.querySelector('#editor-max-clip-label');
const editorStoryHook = document.querySelector('#editor-story-hook');
const copyReelEditJson = document.querySelector('#copy-reel-edit-json');
const mediaModal = document.querySelector('#media-modal');
const mediaModalImage = document.querySelector('#media-modal-image');
const mediaModalTitle = document.querySelector('#media-modal-title');
const roomFocusPanel = document.querySelector('#room-focus-panel');
const agentRoomSelect = document.querySelector('#agent-room-select');
const agentCanvasImage = document.querySelector('#agent-canvas-image');

loadFloorPlans();
renderProgressSteps();
setView('portal');
addChatMessage('agent', 'After you watch the video, ask for a specific change. I can isolate the affected room and keep the rest of the cached video intact.');

document.querySelector('#back-to-plans').addEventListener('click', () => setView('portal'));
document.querySelector('#open-agent').addEventListener('click', () => setView('agent'));
document.querySelector('#back-to-results').addEventListener('click', () => setView('results'));
document.querySelector('#back-video-to-results').addEventListener('click', () => setView('results'));

agentRoomSelect.addEventListener('change', () => {
  selectedAgentRoomId = agentRoomSelect.value;
  const room = (currentJob?.rooms ?? []).find((r) => r.room_id === selectedAgentRoomId);
  if (room) {
    updateAgentCanvas(room);
    const stateLabel = AGENT_STATE_LABELS[room.state];
    placementInstruction.textContent = stateLabel ?? 'Send an edit request to begin.';
  } else {
    placementInstruction.textContent = 'Send an edit request to begin.';
  }
  requestedEdit = null;
  regenerateButton.disabled = true;
});
document.querySelector('#close-media-modal').addEventListener('click', closeMediaModal);
document.querySelectorAll('[data-close-media-modal]').forEach((element) => {
  element.addEventListener('click', closeMediaModal);
});

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
  regenerateButton.disabled = false;
  placementInstruction.textContent = 'Optionally click the image to mark placement, then click Regenerate.';

  addChatMessage('user', message);
  input.value = '';

  if (!currentJobId) {
    addChatMessage('agent', 'No active job found. Run a full generation first, then come back to edit.');
    regenerateButton.disabled = true;
    return;
  }
  addChatMessage('agent', 'Got it. Optionally mark a placement on the image, then click Regenerate — or Regenerate now to let the AI decide.');
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

regenerateButton.addEventListener('click', async () => {
  if (!requestedEdit || !currentJobId) return;

  const message = placement
    ? `${requestedEdit} — at approximately ${Math.round(placement.x)}% across and ${Math.round(placement.y)}% down`
    : requestedEdit;

  regenerateButton.disabled = true;
  cacheNote.textContent = 'Analyzing edit request and targeting affected rooms...';
  addChatMessage('agent', placement
    ? `Got it. Placing at ${Math.round(placement.x)}% across, ${Math.round(placement.y)}% down. Sending to pipeline.`
    : 'Sending your edit to the pipeline. The AI will find the right room(s).');

  try {
    const response = await fetch(`/api/jobs/${currentJobId}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, room_id: selectedAgentRoomId ?? undefined })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Edit request failed.');

    requestedEdit = null;
    placement = null;
    placementMarker.classList.add('is-hidden');
    placementInstruction.textContent = '';
    cacheNote.textContent = 'Edit queued. Only affected rooms regenerate — unchanged rooms stay cached.';
    addChatMessage('agent', 'Edit is running. Watch the room cards for progress. Unchanged rooms remain cached.');
  } catch (error) {
    addChatMessage('agent', `Something went wrong: ${error.message}`);
    regenerateButton.disabled = false;
  }
});

runtimeRoomList.addEventListener('click', async (event) => {
  const preview = event.target.closest('[data-preview-image-url]');
  if (preview) {
    openMediaModal(preview.dataset.previewImageUrl, preview.dataset.previewTitle ?? 'Generated still');
    return;
  }

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

generatedStillsGallery?.addEventListener('click', (event) => {
  const preview = event.target.closest('[data-preview-image-url]');
  if (!preview) return;
  openMediaModal(preview.dataset.previewImageUrl, preview.dataset.previewTitle ?? 'Generated still');
});

editorMaxClipSeconds?.addEventListener('input', () => {
  editorMaxClipLabel.textContent = `${Number(editorMaxClipSeconds.value).toFixed(1)}s`;
  renderReelEditor(currentJob);
});

copyReelEditJson?.addEventListener('click', async () => {
  const edit = collectReelEdit();
  await navigator.clipboard.writeText(JSON.stringify(edit, null, 2));
  copyReelEditJson.textContent = 'Copied';
  window.setTimeout(() => { copyReelEditJson.textContent = 'Copy edit JSON'; }, 1200);
});

document.querySelectorAll('[data-view-jump]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.viewJump;
    if ((target === 'results' || target === 'video') && views.results.classList.contains('is-hidden')) {
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
  renderRoomFocus(jobForPlan(selectedPlan));
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

const EVENT_STEP_MAP = {
  'layers.started': 2,
  'layer3.ready': 4,
  'job.anchors.generating': 5,
  'job.anchors.ready': 5,
  'room.still.planning': 5,
  'room.still.started': 5,
  'room.still.queued': 5,
  'room.still.review_ready': 6,
  'job.stills.review_ready': 6,
  'job.stills.approved': 6,
  'room.video.started': 6,
  'room.video.queued': 6,
  'room.video.progress': 6,
  'job.packaging': 6
};

function subscribeToJob(jobId) {
  if (jobEvents) jobEvents.close();

  jobEvents = new EventSource(`/api/jobs/${jobId}/events`);
  jobEvents.onmessage = async (message) => {
    const event = JSON.parse(message.data);
    progressCaption.textContent = event.message;
    const stepIndex = EVENT_STEP_MAP[event.type];
    if (stepIndex != null) renderProgressSteps(stepIndex);
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
  syncSelectedPlanFromJob(job);
  renderPipelineResult(job);
  renderPinterestReferences(job);
  renderGeneratedStills(job);
  renderRuntimeRooms(job);
  renderReelEditor(job);
  renderSelectedPlan();
  syncAgentView(job);

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
    document.querySelector('#vibe-materials').textContent = (vibeReport.materials ?? []).slice(0, 3).join(', ');
    document.querySelector('#vibe-avoid').textContent = (vibeReport.avoid ?? []).slice(0, 3).join(', ');
  }

  if (profile?.aesthetic_profile) {
    document.querySelector('#vibe-density').textContent = profile.aesthetic_profile.density;
  }

  renderResultsVideo(result);
  renderCaptions(result);
}

function renderResultsVideo(job) {
  const videoFrame = document.querySelector('.video-frame');
  if (!videoFrame) return;

  const finalPath = job.artifacts?.final_video_path;
  const jobId = job.job_id;
  const firstClip = (job.artifacts?.approved_room_clips ?? [])[0];
  const clipUrl = firstClip?.url;

  const relPath = finalPath && jobId ? finalPath.split(`/${jobId}/`)[1] : null;
  const localVideoUrl = relPath ? `/api/jobs/${jobId}/assets/${relPath}` : null;
  const videoUrl = localVideoUrl ?? clipUrl ?? null;

  const duration = job.artifacts?.timeline?.total_duration ?? (job.artifacts?.approved_room_clips ?? []).reduce((sum, c) => {
    const roomJob = job.handoff?.room_generation_jobs?.find((r) => r.room_id === c.room_id);
    return sum + (roomJob?.video_generation?.duration_seconds ?? 5);
  }, 0);
  const shotCount = job.artifacts?.timeline?.segments?.length ?? null;

  const statusText = finalPath
    ? `Final video assembled · 16:9 · ${duration} seconds${shotCount ? ` · ${shotCount} shots` : ''}`
    : clipUrl
      ? `Room preview · 16:9 · ${duration} seconds`
      : null;

  if (videoUrl) {
    videoFrame.innerHTML = `
      <video src="${escapeHtml(videoUrl)}" controls playsinline style="width:100%;border-radius:inherit;display:block;"></video>
      ${statusText ? `<div class="video-status">${escapeHtml(statusText)}</div>` : ''}
    `;
  }
}

function renderCaptions(job) {
  const captions = job.artifacts?.captions;
  if (!captions) return;

  let section = document.querySelector('#results-captions');
  if (!section) {
    section = document.createElement('section');
    section.id = 'results-captions';
    section.className = 'captions-section';
    const roomStrip = document.querySelector('#room-strip');
    if (roomStrip) roomStrip.after(section);
  }

  section.innerHTML = `
    <h3>Generated captions</h3>
    <div class="caption-cards">
      ${captions.instagram ? captionCard('Instagram', captions.instagram) : ''}
      ${captions.tiktok ? captionCard('TikTok', captions.tiktok) : ''}
      ${captions.listing ? captionCard('Listing', captions.listing) : ''}
    </div>
  `;
}

function captionCard(platform, text) {
  const safePlatform = escapeHtml(platform);
  const safeText = escapeHtml(text);
  const jsonText = JSON.stringify(text);
  return `
    <div class="caption-card">
      <div class="caption-platform">${safePlatform}</div>
      <p class="caption-text">${safeText}</p>
      <button class="ghost-button" onclick="navigator.clipboard.writeText(${escapeHtml(jsonText)})">Copy</button>
    </div>
  `;
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

function renderGeneratedStills(job) {
  const rooms = (job.rooms ?? []).filter((room) => room.artifacts?.styled_image_url);
  if (!generatedStillsGallery) return;

  if (rooms.length === 0) {
    generatedStillsGallery.innerHTML = '';
    return;
  }

  generatedStillsGallery.innerHTML = `
    <div class="reference-gallery-header">
      <div>
        <div class="eyebrow">Generated stills</div>
        <h3>Room images</h3>
      </div>
      <span>${rooms.length} stills ready</span>
    </div>
    <div class="reference-grid">
      ${rooms.map((room) => `
        <article class="reference-card">
          <button class="image-preview-button" data-preview-image-url="${escapeHtml(room.artifacts.styled_image_url)}" data-preview-title="${escapeHtml(room.room_name)} still" type="button">
            <img src="${escapeHtml(room.artifacts.styled_image_url)}" alt="${escapeHtml(room.room_name)} still">
          </button>
          <div>
            <strong>${escapeHtml(room.room_name)}</strong>
            <span>${escapeHtml(room.state.replaceAll('_', ' ').toLowerCase())}</span>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderReelEditor(job) {
  if (!sceneEditorList) return;
  const clips = job?.artifacts?.approved_room_clips ?? [];
  const rooms = new Map((job?.handoff?.room_generation_jobs ?? []).map((room) => [room.room_id, room]));
  if (!clips.length) {
    sceneEditorList.innerHTML = '<div class="runtime-placeholder">Room clips will appear here when videos are approved.</div>';
    return;
  }

  const maxSeconds = Number(editorMaxClipSeconds?.value ?? 2.8);
  sceneEditorList.innerHTML = clips.map((clip, index) => {
    const room = rooms.get(clip.room_id);
    const name = roomLabel(room, clip.room_id);
    const duration = Math.min(maxSeconds, Number(room?.video_generation?.duration_seconds ?? 5));
    return `
      <article class="scene-edit-card" data-scene-room-id="${escapeHtml(clip.room_id)}">
        <div>
          <strong>${index + 1}. ${escapeHtml(name)}</strong>
          <div class="scene-edit-meta">${escapeHtml(room?.video_generation?.camera_motion ?? 'clip')} · ${duration.toFixed(1)}s cut</div>
        </div>
        <label>
          On-screen subtitle
          <input data-scene-field="subtitle" value="${escapeHtml(defaultSceneSubtitle(room, name))}">
        </label>
        <label>
          Include
          <input data-scene-field="include" type="checkbox" checked>
        </label>
      </article>
    `;
  }).join('');
}

function collectReelEdit() {
  return {
    job_id: currentJob?.job_id ?? null,
    max_clip_seconds: Number(editorMaxClipSeconds?.value ?? 2.8),
    story_hook: editorStoryHook?.value?.trim() ?? '',
    scenes: [...(sceneEditorList?.querySelectorAll('[data-scene-room-id]') ?? [])].map((card, index) => ({
      index,
      room_id: card.dataset.sceneRoomId,
      include: card.querySelector('[data-scene-field="include"]')?.checked ?? true,
      subtitle: card.querySelector('[data-scene-field="subtitle"]')?.value?.trim() ?? ''
    }))
  };
}

function defaultSceneSubtitle(room, fallback) {
  const objects = room?.staging?.objects_to_include?.map((item) => item.label ?? item.object_type).filter(Boolean) ?? [];
  if (objects.length) return `${fallback}: ${objects.slice(0, 2).join(', ')}`;
  const must = room?.staging?.must_include?.[0];
  return must ? `${fallback}: ${must}` : `${fallback}: style-matched preview`;
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
          ${hasVideo ? `<video src="${escapeHtml(videoUrl)}" controls playsinline></video>` : stillUrl ? `<button class="image-preview-button" data-preview-image-url="${escapeHtml(stillUrl)}" data-preview-title="${escapeHtml(room.room_name)} still" type="button"><img src="${escapeHtml(stillUrl)}" alt="${escapeHtml(room.room_name)} still"></button>` : '<div class="runtime-placeholder">Waiting for media</div>'}
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

function renderRoomFocus(job) {
  if (!roomFocusPanel) return;
  const plan = selectedPlan;
  const hotspots = resolvePlanHotspots(plan, job);

  if (hotspots.length === 0) {
    roomFocusPanel.innerHTML = '';
    return;
  }

  const activeKey = ensureActivePlanHotspot(plan, hotspots, activePlanHotspots.get(plan.id));
  const hotspot = hotspots.find((candidate) => candidate.key === activeKey) ?? hotspots[0];
  const room = hotspot?.runtimeRoom ?? null;
  const title = room?.room_name ?? hotspot?.label ?? 'Room';
  const status = room ? room.state.replaceAll('_', ' ').toLowerCase() : 'not generated yet';

  roomFocusPanel.innerHTML = `
    <div class="room-focus-copy">
      <div class="eyebrow">Selected room</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(room?.video_generation?.camera_motion ?? room?.current_motion_mode ?? hotspot?.roomType ?? 'room highlight')}</p>
      <div class="room-focus-meta">
        <span>${escapeHtml(status)}</span>
        <span>${room?.scores?.overall == null ? 'waiting for score' : `${Number(room.scores.overall).toFixed(1)} / 10`}</span>
      </div>
    </div>
    <div class="room-focus-media">
      ${room?.artifacts?.video_url
        ? `<video src="${escapeHtml(room.artifacts.video_url)}" controls autoplay muted loop playsinline></video>`
        : room?.artifacts?.styled_image_url
          ? `<img src="${escapeHtml(room.artifacts.styled_image_url)}" alt="${escapeHtml(title)} still">`
          : `<div class="runtime-placeholder">Click a room to inspect it. Media will appear here as soon as that room is generated.</div>`}
    </div>
  `;
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

function openMediaModal(url, title) {
  if (!mediaModal || !mediaModalImage || !mediaModalTitle) return;
  mediaModalImage.src = url;
  mediaModalImage.alt = title;
  mediaModalTitle.textContent = title;
  mediaModal.classList.remove('is-hidden');
  mediaModal.setAttribute('aria-hidden', 'false');
}

function closeMediaModal() {
  if (!mediaModal || !mediaModalImage) return;
  mediaModal.classList.add('is-hidden');
  mediaModal.setAttribute('aria-hidden', 'true');
  mediaModalImage.removeAttribute('src');
}

function resolvePlanHotspots(plan, job) {
  const rooms = job?.rooms ?? [];
  return (plan.hotspots ?? []).map((hotspot) => ({
    ...hotspot,
    runtimeRoom: matchRuntimeRoom(hotspot, rooms)
  }));
}

function matchRuntimeRoom(hotspot, rooms) {
  const labelMatches = rooms.filter((room) => normalizeToken(room.room_name) === normalizeToken(hotspot.label));
  const typeMatches = rooms.filter((room) => normalizeToken(room.room_type) === normalizeToken(hotspot.roomType));
  return labelMatches[hotspot.occurrence] ?? typeMatches[hotspot.occurrence] ?? labelMatches[0] ?? typeMatches[0] ?? null;
}

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function ensureActivePlanHotspot(plan, hotspots, selectedKey) {
  const validSelected = hotspots.find((hotspot) => hotspot.key === selectedKey);
  if (validSelected) return validSelected.key;

  const fallback = hotspots.find((hotspot) => hotspot.runtimeRoom?.artifacts?.video_url)
    ?? hotspots.find((hotspot) => hotspot.runtimeRoom?.artifacts?.styled_image_url)
    ?? hotspots[0]
    ?? null;
  if (!fallback) return null;
  activePlanHotspots.set(plan.id, fallback.key);
  return fallback.key;
}

function setActivePlanHotspot(planId, hotspotKey) {
  activePlanHotspots.set(planId, hotspotKey);
  renderSelectedPlan();
}

function syncSelectedPlanFromJob(job) {
  const floorPlanId = job?.payload?.floor_plan_id;
  const matchingPlan = floorPlans.find((plan) => plan.id === floorPlanId);
  if (!matchingPlan) return;
  selectedPlan = matchingPlan;
}

function jobForPlan(plan) {
  return currentJob?.payload?.floor_plan_id === plan.id ? currentJob : null;
}

function setView(viewName) {
  Object.entries(views).forEach(([name, element]) => {
    element.classList.toggle('is-hidden', name !== viewName);
  });

  document.querySelectorAll('[data-view-jump]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.viewJump === viewName);
  });

  if (viewName === 'agent') populateAgentView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populateAgentView() {
  if (currentJob) syncAgentView(currentJob);
}

function updateAgentCanvas(room) {
  if (!room?.artifacts?.styled_image_url) return;
  agentCanvasImage.src = room.artifacts.styled_image_url;
  agentCanvasImage.alt = `${room.room_name} generated still`;
  placement = null;
  placementMarker.classList.add('is-hidden');
}

const AGENT_STATE_LABELS = {
  PENDING: 'Waiting to start...',
  STILL_PLANNING: 'Planning still...',
  STILL_GENERATING: 'Generating new still...',
  STILL_RETRYING: 'Retrying still generation...',
  STILL_VALIDATING: 'Evaluating result...',
  STILL_REVIEW_READY: 'New still ready — approve to start video.',
  VIDEO_PLANNING: 'Planning video...',
  VIDEO_GENERATING: 'Generating video clip...',
  VIDEO_RETRYING: 'Retrying video...',
  VIDEO_VALIDATING: 'Evaluating video...',
  VIDEO_REVIEW_READY: 'Video needs review.',
  APPROVED: 'Room complete. Assembling final video...',
  FAILED: 'Generation failed.'
};

function syncAgentView(job) {
  if (!agentCanvasImage || !agentRoomSelect) return;

  const rooms = (job.rooms ?? []).filter((r) => r.artifacts?.styled_image_url);
  if (!rooms.length) return;

  const currentVal = selectedAgentRoomId ?? agentRoomSelect.value;
  agentRoomSelect.innerHTML = rooms.map((r) =>
    `<option value="${escapeHtml(r.room_id)}"${r.room_id === currentVal ? ' selected' : ''}>${escapeHtml(r.room_name)}</option>`
  ).join('');

  const selected = rooms.find((r) => r.room_id === currentVal) ?? rooms[0];
  selectedAgentRoomId = selected.room_id;

  // Full room record has in-progress state even before still is ready
  const fullRoom = (job.rooms ?? []).find((r) => r.room_id === selected.room_id) ?? selected;

  if (fullRoom.artifacts?.styled_image_url) {
    agentCanvasImage.src = fullRoom.artifacts.styled_image_url;
    agentCanvasImage.alt = `${fullRoom.room_name} generated still`;
  }

  const stateLabel = AGENT_STATE_LABELS[fullRoom.state];
  if (stateLabel) placementInstruction.textContent = stateLabel;

  const cacheNoteEl = document.querySelector('#cache-note');
  if (!cacheNoteEl) return;

  if (fullRoom.state === 'STILL_REVIEW_READY') {
    cacheNoteEl.innerHTML = `
      New still ready to review.
      <span style="display:flex;gap:8px;margin-top:8px">
        <button class="primary-button" data-agent-action="approve-still" data-room-id="${escapeHtml(fullRoom.room_id)}">Approve still</button>
        <button class="ghost-button" data-agent-action="reject-still" data-room-id="${escapeHtml(fullRoom.room_id)}">Reject &amp; retry</button>
      </span>
    `;
  } else if (fullRoom.state === 'APPROVED') {
    cacheNoteEl.textContent = 'Room clip approved. Assembling final video...';
  } else if (fullRoom.state?.startsWith('VIDEO_')) {
    cacheNoteEl.textContent = 'Video generating — takes 1–3 min. Results will appear automatically.';
  } else if (fullRoom.state?.startsWith('STILL_')) {
    cacheNoteEl.textContent = 'Only this room is being regenerated. All other clips stay cached.';
  }
}

document.querySelector('#cache-note').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-agent-action]');
  if (!btn || !currentJobId) return;
  const roomId = btn.dataset.roomId;
  btn.disabled = true;
  try {
    await approveStill(roomId, btn.dataset.agentAction === 'approve-still');
    await refreshJob(currentJobId);
  } catch (err) {
    placementInstruction.textContent = err.message;
    btn.disabled = false;
  }
});

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
