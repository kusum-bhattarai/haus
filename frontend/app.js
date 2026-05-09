const floorPlans = [
  {
    id: 'a1',
    name: 'Unit A1',
    layout: 'Studio / 1 Bath',
    sqft: '642 sq ft',
    price: 'Starting at $1,760',
    available: 'Available May 18',
    rooms: ['living', 'sleeping', 'kitchen', 'bath']
  },
  {
    id: 'b2',
    name: 'Unit B2',
    layout: '1 Bed / 1 Bath',
    sqft: '784 sq ft',
    price: 'Starting at $2,040',
    available: 'Available now',
    rooms: ['living', 'bedroom', 'kitchen', 'bath']
  },
  {
    id: 'c4',
    name: 'Unit C4',
    layout: '2 Bed / 2 Bath',
    sqft: '1,086 sq ft',
    price: 'Starting at $2,620',
    available: '2 homes left',
    rooms: ['living', 'bedroom', 'bedroom', 'kitchen', 'bath', 'bath']
  }
];

const progressSteps = [
  'Validating selected floor plan',
  'Extracting room dimensions',
  'Reading Pinterest board',
  'Building structured vibe report',
  'Generating staged room images',
  'Creating fal video segments',
  'Reassembling final preview'
];

let selectedPlan = floorPlans[1];
let currentView = 'portal';
let requestedEdit = null;
let placement = null;

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
const selectedPlanMeta = document.querySelector('#selected-plan-meta');
const generationPlanChip = document.querySelector('#generation-plan-chip');
const progressList = document.querySelector('#progress-list');
const chatLog = document.querySelector('#chat-log');
const placementCanvas = document.querySelector('#placement-canvas');
const placementMarker = document.querySelector('#placement-marker');
const placementInstruction = document.querySelector('#placement-instruction');
const regenerateButton = document.querySelector('#regenerate-section');
const cacheNote = document.querySelector('#cache-note');

renderFloorPlans();
renderSelectedPlan();
renderProgressSteps();
setView('portal');
addChatMessage('agent', 'After you watch the video, ask for a specific change. I can isolate the affected room and keep the rest of the cached video intact.');

document.querySelector('#back-to-plans').addEventListener('click', () => setView('portal'));
document.querySelector('#open-agent').addEventListener('click', () => setView('agent'));
document.querySelector('#back-to-results').addEventListener('click', () => setView('results'));

document.querySelector('#personalization-form').addEventListener('submit', (event) => {
  event.preventDefault();
  setView('generation');
  runGenerationSequence();
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
    cacheNote.textContent = 'Living room segment regenerated. Final video reassembled from 1 new segment and 2 cached segments.';
    addChatMessage('agent', 'Updated preview is ready. I reused the cached bedroom and kitchen segments and replaced only the living room section.');
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

function renderFloorPlans() {
  floorplanGrid.innerHTML = floorPlans.map((plan) => `
    <article class="floorplan-card ${plan.id === selectedPlan.id ? 'is-selected' : ''}">
      <div class="plan-diagram" aria-hidden="true">${renderPlanDiagram(plan)}</div>
      <div class="plan-card-body">
        <div>
          <h3>${plan.name}</h3>
          <p>${plan.layout}</p>
        </div>
        <dl>
          <div><dt>Size</dt><dd>${plan.sqft}</dd></div>
          <div><dt>Rent</dt><dd>${plan.price}</dd></div>
          <div><dt>Status</dt><dd>${plan.available}</dd></div>
        </dl>
        <button class="primary-button" type="button" data-plan-id="${plan.id}">Visualize this floor plan</button>
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
  selectedPlanPreview.innerHTML = renderPlanDiagram(selectedPlan);
  selectedPlanMeta.innerHTML = `
    <span>${selectedPlan.sqft}</span>
    <span>${selectedPlan.price}</span>
    <span>${selectedPlan.available}</span>
  `;
}

function renderPlanDiagram(plan) {
  const roomLabels = plan.rooms.map((room, index) => `<div class="diagram-room room-${index + 1}">${room}</div>`).join('');
  return `<div class="diagram-grid diagram-${plan.id}">${roomLabels}</div>`;
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

function runGenerationSequence() {
  let index = 0;
  renderProgressSteps(index);

  const interval = window.setInterval(() => {
    index += 1;
    if (index >= progressSteps.length) {
      window.clearInterval(interval);
      renderProgressSteps(progressSteps.length, true);
      window.setTimeout(() => setView('results'), 700);
      return;
    }
    renderProgressSteps(index);
  }, 650);
}

function setView(viewName) {
  currentView = viewName;
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
