import { detectByRules, mergeEntities, mask, rehydrate, leaks, type Entity, type MaskResult } from './pii';
import { decideRoute, DEFAULT_POLICY, type Policy, type TaskId } from './router';
import { firebaseConfigured, loadPolicy } from './firebase';
import { buildModels, deviceModelState, warmUpDevice, detectWithNano, runTask, type DeviceState } from './ai';
import { SAMPLES } from './samples';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const TASKS: Array<{ id: TaskId; label: string }> = [
  { id: 'summarize', label: 'Summarize' },
  { id: 'plain', label: 'Explain in plain English' },
  { id: 'actions', label: 'Deadlines and to-dos' },
  { id: 'translate', label: 'Translate to English' },
  { id: 'reply', label: 'Draft a reply' },
];

const state = {
  policy: DEFAULT_POLICY as Policy,
  device: 'unavailable' as DeviceState,
  entities: [] as Entity[],
  enabled: new Set<string>(),
  maskResult: null as MaskResult | null,
  task: 'summarize' as TaskId,
  ledger: [] as Array<{ at: string; task: string; where: string; chars: number; payload: string | null }>,
};

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderStatus() {
  const chips = [
    ['Gemini Nano', state.device, state.device === 'available' ? 'ok' : state.device === 'unavailable' ? 'bad' : 'warn'],
    ['Network', navigator.onLine ? 'online' : 'offline', navigator.onLine ? 'ok' : 'warn'],
    ['Firebase AI Logic', firebaseConfigured ? 'connected' : 'not configured', firebaseConfigured ? 'ok' : 'bad'],
  ];
  $('status').innerHTML = chips.map(([k, v, c]) => `<span class="chip ${c}">${k}: <b>${v}</b></span>`).join('');
}

function renderEntities() {
  const box = $('entities');
  box.innerHTML = state.entities.length
    ? state.entities.map((e, i) =>
        `<label class="ent ${state.enabled.has(e.text) ? 'on' : ''}"><input type="checkbox" data-i="${i}" ${state.enabled.has(e.text) ? 'checked' : ''}/>
         <span class="t">${e.type}</span> ${esc(e.text)} <span class="src">${e.source === 'rule' ? 'rule' : 'Nano'}</span></label>`).join('')
    : '<p class="muted">No private data found.</p>';
  box.querySelectorAll('input').forEach((el) =>
    el.addEventListener('change', () => {
      const e = state.entities[Number((el as HTMLInputElement).dataset.i)];
      (el as HTMLInputElement).checked ? state.enabled.add(e.text) : state.enabled.delete(e.text);
      remask();
    }));
  remask();
}

function remask() {
  const text = $<HTMLTextAreaElement>('input').value;
  state.maskResult = mask(text, state.entities.filter((e) => state.enabled.has(e.text)));
  $('masked').innerHTML = esc(state.maskResult.masked).replace(/\[[A-Z_]+_\d+\]/g, (m) => `<mark>${m}</mark>`);
  renderEntitiesState();
  renderRoute();
}

function renderEntitiesState() {
  document.querySelectorAll('.ent').forEach((el) => el.classList.toggle('on', (el.querySelector('input') as HTMLInputElement).checked));
}

function currentDecision() {
  const policy = { ...state.policy, strictLocal: $<HTMLInputElement>('strict').checked };
  return decideRoute({
    chars: state.maskResult?.masked.length ?? 0,
    task: state.task,
    online: navigator.onLine,
    deviceModel: state.device,
    policy,
  });
}

function renderRoute() {
  const d = currentDecision();
  const icon = d.route === 'on_device' ? '💻' : d.route === 'cloud_masked' ? '☁️' : '⛔';
  $('route').className = `route ${d.route}`;
  $('route').innerHTML = `${icon} <b>${d.route === 'on_device' ? 'On this device' : d.route === 'cloud_masked' ? 'Cloud, masked' : 'Cannot run'}</b> ${esc(d.reason)}`;
  $<HTMLButtonElement>('run').disabled = d.route === 'blocked' || !firebaseConfigured;
}

function renderTasks() {
  $('tasks').innerHTML = TASKS.map((t) => `<button class="task ${t.id === state.task ? 'sel' : ''}" data-id="${t.id}">${t.label}</button>`).join('');
  $('tasks').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => { state.task = (b as HTMLElement).dataset.id as TaskId; renderTasks(); renderRoute(); }));
}

function renderLedger() {
  $('ledger').innerHTML = state.ledger.slice().reverse().map((l) => `
    <div class="ledger-row">
      <div><b>${l.at}</b> · ${esc(l.task)} · ${l.where === 'on_device' ? '💻 stayed on device' : '☁️ sent to cloud'} · ${l.chars} chars</div>
      ${l.payload === null ? '<div class="muted">Nothing left this device.</div>' : `<pre class="payload">${esc(l.payload)}</pre>`}
    </div>`).join('');
}

async function scan() {
  const text = $<HTMLTextAreaElement>('input').value.trim();
  if (!text) return;
  $('progress').textContent = 'Scanning locally...';
  const rules = detectByRules(text);
  let ai: Entity[] = [];
  let note = `${rules.length} items found by local rules.`;
  if (firebaseConfigured && state.device === 'available') {
    try {
      ai = await detectWithNano(text);
      note += ` ${ai.length} more found by Gemini Nano on this device.`;
    } catch (err) {
      note += ` On-device model failed (${(err as Error).message}); using rules only.`;
    }
  } else {
    note += ' Gemini Nano is not ready, so only rules were used. Review the list and add anything missing.';
  }
  state.entities = mergeEntities(rules, ai);
  state.enabled = new Set(state.entities.map((e) => e.text));
  $('scanInfo').textContent = note + ' Untick anything that is safe to share.';
  $('progress').textContent = '';
  ['step2', 'step3'].forEach((id) => $(id).classList.remove('hidden'));
  renderEntities();
}

async function run() {
  const m = state.maskResult;
  if (!m) return;
  const d = currentDecision();
  if (d.route === 'blocked') return;
  const leaked = leaks(m.masked, m.vault);
  if (leaked.length) { alert('Safety check failed: some private values are still in the text.'); return; }
  $<HTMLButtonElement>('run').disabled = true;
  $('answer').textContent = 'Thinking...';
  $('step4').classList.remove('hidden');
  try {
    const r = await runTask(state.task, m.masked, d.route);
    const answer = rehydrate(r.text, m.vault);
    $('badge').className = `badge ${r.source}`;
    $('badge').textContent = `${r.source === 'on_device' ? '💻 on-device' : '☁️ cloud'} · ${r.model} · ${r.ms} ms`;
    $('answer').innerHTML = esc(answer).replace(/\n/g, '<br>');
    state.ledger.push({
      at: new Date().toLocaleTimeString(),
      task: TASKS.find((t) => t.id === state.task)!.label,
      where: r.source,
      chars: m.masked.length,
      payload: r.source === 'in_cloud' ? m.masked : null,
    });
    renderLedger();
  } catch (err) {
    const msg = (err as Error).message || String(err);
    const hint = /App Check/i.test(msg)
      ? ' Register this browser\'s App Check debug token in the Firebase console (App Check > Apps > Manage debug tokens), then reload. See README.'
      : '';
    $('answer').textContent = `Error: ${msg}${hint}`;
  } finally {
    renderRoute();
  }
}

async function init() {
  $('samples').innerHTML = Object.entries(SAMPLES).map(([k, s]) => `<button class="ghost" data-k="${k}">${s.label}</button>`).join('');
  $('samples').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => { $<HTMLTextAreaElement>('input').value = SAMPLES[(b as HTMLElement).dataset.k!].text; }));
  renderTasks();
  $('scan').addEventListener('click', scan);
  $('run').addEventListener('click', run);
  $('strict').addEventListener('change', renderRoute);
  $('addExtra').addEventListener('click', () => {
    const v = $<HTMLInputElement>('extra').value.trim();
    if (!v || !$<HTMLTextAreaElement>('input').value.includes(v)) return;
    state.entities = mergeEntities(state.entities, [{ type: 'OTHER', text: v, source: 'rule' }]);
    state.enabled.add(v);
    $<HTMLInputElement>('extra').value = '';
    renderEntities();
  });
  window.addEventListener('online', () => { renderStatus(); renderRoute(); });
  window.addEventListener('offline', () => { renderStatus(); renderRoute(); });
  $('warm').addEventListener('click', async () => {
    try {
      await warmUpDevice((p) => ($('progress').textContent = `Downloading Gemini Nano: ${Math.round(p * 100)}%`));
      state.device = await deviceModelState();
      $('progress').textContent = 'On-device model ready.';
    } catch (err) {
      $('progress').textContent = `Could not prepare the on-device model: ${(err as Error).message}`;
    }
    renderStatus(); renderRoute();
  });
  state.device = await deviceModelState();
  if (firebaseConfigured) {
    state.policy = await loadPolicy();
    buildModels(state.policy);
  }
  renderStatus();
}

init();
