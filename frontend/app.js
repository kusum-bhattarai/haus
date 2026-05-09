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
  progressCaption.textContent = 'Running Layers 1-3 with the selected floor plan and Pinterest board.';

  const pipelinePromise = runPipeline({
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
    currentPipelineResult = await pipelinePromise;
    window.clearInterval(interval);
    renderProgressSteps(progressSteps.length, true);
    renderPipelineResult(currentPipelineResult);
    progressCaption.textContent = 'Layer 3 handoff created. Showing personalized preview shell.';
    window.setTimeout(() => setView('results'), 700);
  } catch (error) {
    window.clearInterval(interval);
    renderProgressSteps(index);
    progressCaption.textContent = error.message;
  }
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
