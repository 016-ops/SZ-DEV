const state = {
  dashboard: null,
  catalog: null,
  workflowDraft: {
    loopMode: "alternate",
    queue: [],
  },
  recentDraws: [],
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return response.json();
}

function byId(id) {
  return document.getElementById(id);
}

function qualityBadge(qualityLabel, qualityColor) {
  return `<span class="draw-badge" style="border-color:${qualityColor}55;background:${qualityColor}22;">
    <span class="quality-dot" style="background:${qualityColor};margin-right:0;"></span>${qualityLabel}
  </span>`;
}

function renderProfile() {
  const { profile, derived, workflow } = state.dashboard;
  byId("playerName").value = profile.playerName || "";
  byId("currentLucky").value = profile.currentLucky;
  byId("highestStage").value = profile.highestStage;
  byId("refreshTokens").value = profile.refreshTokens;
  byId("notes").value = profile.notes || "";
  byId("status-pill").textContent = derived.allTargetsCompleted ? "目标已完成" : "安全模拟中";
  byId("remaining-refresh").textContent = `剩余规划券 ${derived.remainingRefreshTokens}`;
  byId("current-screen-label").textContent = `当前页面: ${workflow.currentScreen}`;
}

function renderLoopMode() {
  const container = byId("loop-mode");
  container.innerHTML = "";
  const modes = [
    { id: "alternate", label: "交替轮换" },
    { id: "stage_1_only", label: "固定第1关" },
    { id: "stage_6_only", label: "固定第6关" },
  ];
  for (const mode of modes) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = mode.label;
    button.className = state.workflowDraft.loopMode === mode.id ? "active" : "";
    button.addEventListener("click", () => {
      state.workflowDraft.loopMode = mode.id;
      if (mode.id === "stage_1_only") state.workflowDraft.queue = ["stage_1"];
      if (mode.id === "stage_6_only") state.workflowDraft.queue = ["stage_6"];
      if (mode.id === "alternate" && state.workflowDraft.queue.length < 2) {
        state.workflowDraft.queue = ["stage_1", "stage_6"];
      }
      renderLoopMode();
      renderStageQueue();
    });
    container.appendChild(button);
  }
}

function renderStageQueue() {
  const container = byId("stage-queue");
  container.innerHTML = "";
  for (const stage of state.catalog.stages) {
    const wrap = document.createElement("label");
    wrap.className = "stage-chip";
    const checked = state.workflowDraft.queue.includes(stage.id);
    wrap.innerHTML = `
      <input type="checkbox" ${checked ? "checked" : ""} />
      <div>
        <strong>${stage.label}</strong>
        <div class="muted">${stage.recommendedActions.length} 个节奏提示</div>
      </div>
    `;
    const input = wrap.querySelector("input");
    input.addEventListener("change", (event) => {
      if (event.target.checked) {
        if (!state.workflowDraft.queue.includes(stage.id)) state.workflowDraft.queue.push(stage.id);
      } else {
        state.workflowDraft.queue = state.workflowDraft.queue.filter((item) => item !== stage.id);
      }
    });
    container.appendChild(wrap);
  }
}

function renderScreens() {
  const container = byId("screen-grid");
  container.innerHTML = "";
  const currentScreen = state.dashboard.workflow.currentScreen;
  for (const screen of state.dashboard.screens) {
    const card = document.createElement("article");
    card.className = `screen-card ${screen.screenId === currentScreen ? "active" : ""}`;
    card.innerHTML = `
      <img src="${screen.mediaUrl}" alt="${screen.label}" />
      <div class="screen-body">
        <div class="panel-header">
          <h2>${screen.label}</h2>
          <span class="muted">${screen.screenId}</span>
        </div>
        <p class="muted">${screen.summary}</p>
        <ul class="screen-actions">
          ${screen.actions.map((action) => `<li>${action}</li>`).join("")}
        </ul>
      </div>
    `;
    container.appendChild(card);
  }
}

function createCardOptions(value) {
  return state.catalog.cards
    .map((card) => `<option value="${card.id}" ${card.id === value ? "selected" : ""}>${card.name} · ${card.type}</option>`)
    .join("");
}

function createQualityOptions(value) {
  return state.catalog.qualities
    .map((quality) => `<option value="${quality.id}" ${quality.id === value ? "selected" : ""}>${quality.label}</option>`)
    .join("");
}

function syncProgressText(row) {
  const owned = Number(row.querySelector('[data-field="ownedCount"]').value || 0);
  const target = Number(row.querySelector('[data-field="targetCount"]').value || 1);
  row.querySelector("[data-progress]").textContent = `进度 ${owned}/${target}`;
}

function buildTargetRow(target = null) {
  const template = byId("target-row-template");
  const node = template.content.firstElementChild.cloneNode(true);
  node.querySelector('[data-field="cardId"]').innerHTML = createCardOptions(target?.cardId);
  node.querySelector('[data-field="qualityId"]').innerHTML = createQualityOptions(target?.qualityId);
  node.querySelector('[data-field="targetCount"]').value = target?.targetCount ?? 1;
  node.querySelector('[data-field="ownedCount"]').value = target?.ownedCount ?? 0;
  node.querySelector("[data-remove]").addEventListener("click", () => node.remove());
  node.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => syncProgressText(node)));
  syncProgressText(node);
  return node;
}

function renderTargets() {
  const container = byId("target-list");
  container.innerHTML = "";
  for (const target of state.dashboard.targets) {
    container.appendChild(buildTargetRow(target));
  }
}

function renderRecentDraws() {
  const container = byId("recent-draws");
  if (!state.recentDraws.length) {
    container.className = "draw-grid empty-state";
    container.textContent = "尚未模拟";
    return;
  }
  container.className = "draw-grid";
  container.innerHTML = state.recentDraws
    .map(
      (draw) => `
      <article class="draw-card">
        <div class="panel-header">
          <strong>${draw.cardName}</strong>
          ${qualityBadge(draw.qualityLabel, draw.qualityColor)}
        </div>
        <small>${draw.cardId}</small>
        <div class="panel-header">
          <span class="muted">价值</span>
          <strong>${draw.value}</strong>
        </div>
      </article>
    `,
    )
    .join("");
}

function renderStats() {
  const tbody = byId("stats-body");
  tbody.innerHTML = state.dashboard.statistics.summary
    .map(
      (row) => `
      <tr>
        <td>${row.cardName}</td>
        <td><span class="quality-dot" style="background:${row.qualityColor};"></span>${row.qualityLabel}</td>
        <td>${row.count}</td>
        <td>${(row.probability * 100).toFixed(2)}%</td>
      </tr>
    `,
    )
    .join("");
}

function renderLogs() {
  const container = byId("log-list");
  container.innerHTML = state.dashboard.logs
    .map(
      (log) => `
      <article class="log-item">
        <div class="log-head">
          <span class="log-level ${log.level}">${log.level}</span>
          <span class="muted">${new Date(log.timestamp).toLocaleString("zh-CN")}</span>
        </div>
        <div>${log.message}</div>
      </article>
    `,
    )
    .join("");
}

function collectTargetsFromForm() {
  return [...document.querySelectorAll(".target-row")].map((row) => ({
    cardId: row.querySelector('[data-field="cardId"]').value,
    qualityId: row.querySelector('[data-field="qualityId"]').value,
    targetCount: Number(row.querySelector('[data-field="targetCount"]').value || 1),
    ownedCount: Number(row.querySelector('[data-field="ownedCount"]').value || 0),
  }));
}

function applyWorkflowDraftFromDashboard() {
  state.workflowDraft.loopMode = state.dashboard.workflow.loopMode || "alternate";
  state.workflowDraft.queue = [...state.dashboard.workflow.queue];
}

function renderAll() {
  renderProfile();
  renderLoopMode();
  renderStageQueue();
  renderScreens();
  renderTargets();
  renderRecentDraws();
  renderStats();
  renderLogs();
}

async function refreshDashboard() {
  state.dashboard = await api("/api/dashboard");
  state.catalog = state.dashboard.catalog;
  applyWorkflowDraftFromDashboard();
  renderAll();
}

async function submitProfile(event) {
  event.preventDefault();
  state.dashboard = await api("/api/profile", {
    method: "POST",
    body: JSON.stringify({
      playerName: byId("playerName").value,
      currentLucky: Number(byId("currentLucky").value || 0),
      highestStage: Number(byId("highestStage").value || 0),
      refreshTokens: Number(byId("refreshTokens").value || 0),
      notes: byId("notes").value,
    }),
  });
  applyWorkflowDraftFromDashboard();
  renderAll();
}

async function saveTargets() {
  state.dashboard = await api("/api/targets", {
    method: "POST",
    body: JSON.stringify({ targets: collectTargetsFromForm() }),
  });
  applyWorkflowDraftFromDashboard();
  renderAll();
}

async function saveWorkflow() {
  const payload = {
    loopMode: state.workflowDraft.loopMode,
    queue:
      state.workflowDraft.loopMode === "stage_1_only"
        ? ["stage_1"]
        : state.workflowDraft.loopMode === "stage_6_only"
          ? ["stage_6"]
          : state.workflowDraft.queue,
  };
  state.dashboard = await api("/api/workflow", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  applyWorkflowDraftFromDashboard();
  renderAll();
}

async function simulateRefresh() {
  const payload = await api("/api/simulate/refresh", { method: "POST", body: "{}" });
  state.dashboard = payload.dashboard;
  state.recentDraws = payload.result.draws;
  applyWorkflowDraftFromDashboard();
  renderAll();
}

async function simulateRun() {
  const payload = await api("/api/simulate/run", { method: "POST", body: "{}" });
  state.dashboard = payload.dashboard;
  state.recentDraws = payload.result.refresh?.draws || [];
  applyWorkflowDraftFromDashboard();
  renderAll();
}

function bindEvents() {
  byId("profile-form").addEventListener("submit", submitProfile);
  byId("save-targets-btn").addEventListener("click", saveTargets);
  byId("save-workflow-btn").addEventListener("click", saveWorkflow);
  byId("simulate-refresh-btn").addEventListener("click", simulateRefresh);
  byId("simulate-run-btn").addEventListener("click", simulateRun);
  byId("add-target-btn").addEventListener("click", () => {
    byId("target-list").appendChild(buildTargetRow({
      cardId: state.catalog.cards[0]?.id,
      qualityId: state.catalog.qualities[0]?.id,
      targetCount: 1,
      ownedCount: 0,
    }));
  });
}

refreshDashboard()
  .then(bindEvents)
  .catch((error) => {
    byId("status-pill").textContent = "加载失败";
    console.error(error);
  });
