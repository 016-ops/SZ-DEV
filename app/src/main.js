const React = require("react");
const { createRoot } = require("react-dom/client");

const h = React.createElement;
const { useEffect, useMemo, useState } = React;

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

function post(path, payload = {}) {
  return request(path, { method: "POST", body: JSON.stringify(payload) });
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function CardBadge({ label, color }) {
  return h(
    "span",
    { className: "draw-badge", style: { borderColor: `${color}66`, background: `${color}22` } },
    h("span", { className: "quality-dot", style: { background: color, marginRight: 0 } }),
    label,
  );
}

function Topbar({ dashboard, onSimulateRefresh, onSimulateRun, onExport }) {
  return h(
    "header",
    { className: "topbar" },
    h("div", null, h("p", { className: "eyebrow" }, "Python + React Local Console"), h("h1", null, "副本规划控制台")),
    h(
      "div",
      { className: "topbar-actions" },
      h("button", { className: "ghost-button", onClick: onExport }, "导出配置"),
      h("button", { className: "ghost-button", onClick: onSimulateRefresh }, "模拟刷新"),
      h("button", { className: "primary-button", onClick: onSimulateRun }, "模拟一轮流程"),
      h("span", { className: "status-pill" }, dashboard?.derived?.allTargetsCompleted ? "目标已完成" : "安全规划模式"),
    ),
  );
}

function ProfilePanel({ dashboard, onSaveProfile, onSaveAttributes }) {
  const profile = dashboard.profile;
  const [draft, setDraft] = useState(profile);
  const [attributes, setAttributes] = useState(profile.attributes || {});

  useEffect(() => {
    setDraft(profile);
    setAttributes(profile.attributes || {});
  }, [profile]);

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const updateQuota = (field, value) =>
    setDraft((current) => ({
      ...current,
      quota: { ...(current.quota || {}), [field]: value },
    }));
  const updateAttribute = (field, value) => setAttributes((current) => ({ ...current, [field]: value }));

  return h(
    "section",
    { className: "panel profile-panel" },
    h("div", { className: "panel-header" }, h("h2", null, "规划参数"), h("span", { className: "mono" }, `剩余刷新 ${dashboard.derived.remainingRefreshTokens}`)),
    h(
      "div",
      { className: "stack" },
      h(Field, {
        label: "操作者名称",
        value: draft.playerName || "",
        onChange: (value) => updateDraft("playerName", value),
      }),
      h(
        "div",
        { className: "grid two" },
        h(Field, {
          label: "幸运值",
          type: "number",
          value: draft.currentLucky,
          onChange: (value) => updateDraft("currentLucky", numberValue(value)),
        }),
        h(Field, {
          label: "最高通关",
          type: "number",
          value: draft.highestStage,
          onChange: (value) => updateDraft("highestStage", numberValue(value)),
        }),
      ),
      h(
        "div",
        { className: "grid two" },
        h(Field, {
          label: "规划刷新券",
          type: "number",
          value: draft.refreshTokens,
          onChange: (value) => updateDraft("refreshTokens", numberValue(value)),
        }),
        h(Field, {
          label: "测试额度",
          type: "number",
          value: draft.quota?.remainingRuns ?? 0,
          onChange: (value) => updateQuota("remainingRuns", numberValue(value)),
        }),
      ),
      h(
        "label",
        { className: "stage-chip" },
        h("input", {
          type: "checkbox",
          checked: Boolean(draft.quota?.lifetime),
          onChange: (event) => updateQuota("lifetime", event.target.checked),
        }),
        h("div", null, h("strong", null, "本地无限测试额度"), h("div", { className: "muted" }, "只影响本工具内的模拟次数")),
      ),
      h(Field, {
        label: "备注",
        multiline: true,
        value: draft.notes || "",
        onChange: (value) => updateDraft("notes", value),
      }),
      h("button", { className: "secondary-button", onClick: () => onSaveProfile(draft) }, "保存参数"),
    ),
    h("div", { className: "divider" }),
    h("div", { className: "panel-header" }, h("h2", null, "属性面板记录"), h("span", { className: "muted" }, "人工校正")),
    h(
      "div",
      { className: "attribute-grid" },
      Object.entries(attributes).map(([key, value]) =>
        h(Field, {
          key,
          label: attributeLabels[key] || key,
          value,
          onChange: (next) => updateAttribute(key, next),
        }),
      ),
    ),
    h("button", { className: "secondary-button", onClick: () => onSaveAttributes(attributes) }, "保存属性"),
  );
}

const attributeLabels = {
  baseDamageMultiplier: "基础伤害倍率",
  maxHealth: "最大生命值",
  armorDamage: "武装增伤",
  weaponDamage: "武器增伤",
  healthRegen: "生命恢复",
  lifeSteal: "生命偷取",
  damageReduction: "受伤减免",
  critRate: "暴击率",
  critDamage: "暴击伤害",
  attackSpeed: "攻击速度",
  overloadRate: "过载概率",
  rangedDamage: "远程伤害",
};

function Field({ label, value, onChange, type = "text", multiline = false }) {
  return h(
    "label",
    { className: "field" },
    h("span", null, label),
    multiline
      ? h("textarea", { value, rows: 4, onChange: (event) => onChange(event.target.value) })
      : h("input", { type, value: value ?? "", onChange: (event) => onChange(event.target.value), min: type === "number" ? 0 : undefined }),
  );
}

function WorkflowPanel({ dashboard, onSave }) {
  const [draft, setDraft] = useState(dashboard.workflow);

  useEffect(() => setDraft(dashboard.workflow), [dashboard.workflow]);

  const setLoopMode = (loopMode) => {
    let queue = draft.queue;
    if (loopMode === "stage_1_only") queue = ["stage_1"];
    if (loopMode === "stage_6_only") queue = ["stage_6"];
    if (loopMode === "alternate" && queue.length < 2) queue = ["stage_1", "stage_6"];
    setDraft({ ...draft, loopMode, queue });
  };

  const toggleStage = (stageId, checked) => {
    const queue = checked ? [...new Set([...draft.queue, stageId])] : draft.queue.filter((item) => item !== stageId);
    setDraft({ ...draft, queue });
  };

  return h(
    "section",
    { className: "panel" },
    h("div", { className: "panel-header" }, h("h2", null, "流程配置"), h("span", { className: "mono" }, dashboard.workflow.currentScreen)),
    h(
      "div",
      { className: "field" },
      h("span", null, "轮换模式"),
      h(
        "div",
        { className: "segmented" },
        [
          ["alternate", "交替轮换"],
          ["stage_1_only", "固定第1关"],
          ["stage_6_only", "固定第6关"],
        ].map(([id, label]) =>
          h(
            "button",
            { key: id, className: draft.loopMode === id ? "active" : "", type: "button", onClick: () => setLoopMode(id) },
            label,
          ),
        ),
      ),
    ),
    h(
      "div",
      { className: "field" },
      h("span", null, "关卡队列"),
      h(
        "div",
        { className: "stage-list" },
        dashboard.catalog.stages.map((stage) =>
          h(
            "label",
            { key: stage.id, className: "stage-chip" },
            h("input", {
              type: "checkbox",
              checked: draft.queue.includes(stage.id),
              onChange: (event) => toggleStage(stage.id, event.target.checked),
            }),
            h("div", null, h("strong", null, stage.label), h("div", { className: "muted" }, `${stage.recommendedActions.length} 个节奏提示`)),
          ),
        ),
      ),
    ),
    h("button", { className: "secondary-button", onClick: () => onSave(draft) }, "保存流程"),
    h("div", { className: "divider" }),
    h("div", { className: "panel-header" }, h("h2", null, "动作节奏预览"), h("span", { className: "muted" }, "不发送真实输入")),
    h(
      "div",
      { className: "action-plan" },
      dashboard.actionPlan.map((plan) =>
        h(
          "article",
          { key: plan.stageId, className: "mini-card" },
          h("strong", null, plan.stageLabel),
          h(
            "ol",
            null,
            plan.actions.map((action, index) => h("li", { key: `${action.kind}-${index}` }, action.label)),
          ),
        ),
      ),
    ),
  );
}

function TargetsPanel({ dashboard, onSave }) {
  const emptyTarget = {
    cardId: dashboard.catalog.cards[0]?.id || "",
    qualityId: dashboard.catalog.qualities[0]?.id || "",
    targetCount: 1,
    ownedCount: 0,
  };
  const [targets, setTargets] = useState(dashboard.targets.length ? dashboard.targets : [emptyTarget]);

  useEffect(() => setTargets(dashboard.targets.length ? dashboard.targets : [emptyTarget]), [dashboard.targets]);

  const updateTarget = (index, patch) => {
    setTargets((current) => current.map((target, rowIndex) => (rowIndex === index ? { ...target, ...patch } : target)));
  };
  const removeTarget = (index) => setTargets((current) => current.filter((_, rowIndex) => rowIndex !== index));

  return h(
    "section",
    { className: "panel target-panel" },
    h(
      "div",
      { className: "panel-header" },
      h("h2", null, "目标牌"),
      h("button", { className: "ghost-button compact", onClick: () => setTargets([...targets, emptyTarget]) }, "新增目标"),
    ),
    h(
      "div",
      { className: "target-list" },
      targets.map((target, index) =>
        h(
          "article",
          { className: "target-row", key: `${target.cardId}-${target.qualityId}-${index}` },
          h(
            "div",
            { className: "grid two" },
            h(SelectField, {
              label: "牌名",
              value: target.cardId,
              options: dashboard.catalog.cards.map((card) => ({ value: card.id, label: `${card.name} · ${card.type}` })),
              onChange: (value) => updateTarget(index, { cardId: value }),
            }),
            h(SelectField, {
              label: "品阶",
              value: target.qualityId,
              options: dashboard.catalog.qualities.map((quality) => ({ value: quality.id, label: quality.label })),
              onChange: (value) => updateTarget(index, { qualityId: value }),
            }),
          ),
          h(
            "div",
            { className: "grid two" },
            h(Field, {
              label: "目标数量",
              type: "number",
              value: target.targetCount,
              onChange: (value) => updateTarget(index, { targetCount: numberValue(value, 1) }),
            }),
            h(Field, {
              label: "已拥有",
              type: "number",
              value: target.ownedCount,
              onChange: (value) => updateTarget(index, { ownedCount: numberValue(value) }),
            }),
          ),
          h(
            "div",
            { className: "progress-line" },
            h("div", { style: { width: `${Math.min(100, ((target.ownedCount || 0) / Math.max(1, target.targetCount || 1)) * 100)}%` } }),
          ),
          h(
            "div",
            { className: "row-actions" },
            h("span", { className: "progress-text" }, `进度 ${target.ownedCount || 0}/${target.targetCount || 1}`),
            h("button", { className: "ghost-button compact danger", onClick: () => removeTarget(index) }, "删除"),
          ),
        ),
      ),
    ),
    h("button", { className: "secondary-button", onClick: () => onSave(targets) }, "保存目标牌"),
  );
}

function SelectField({ label, value, options, onChange }) {
  return h(
    "label",
    { className: "field" },
    h("span", null, label),
    h(
      "select",
      { value, onChange: (event) => onChange(event.target.value) },
      options.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
    ),
  );
}

function ScreensPanel({ dashboard, selectedScreen, setSelectedScreen, onSaveAnnotations }) {
  const screen = dashboard.screens.find((item) => item.id === selectedScreen) || dashboard.screens[0];
  const [zones, setZones] = useState(screen?.template?.zones || []);

  useEffect(() => {
    setZones(screen?.template?.zones || []);
  }, [screen?.id, dashboard.screens]);

  const updateZone = (index, field, value) => {
    setZones((current) => current.map((zone, rowIndex) => (rowIndex === index ? { ...zone, [field]: value } : zone)));
  };

  const addZone = () => {
    setZones([
      ...zones,
      {
        id: `custom_${Date.now()}`,
        label: "自定义区域",
        kind: "manual",
        purpose: "manual-note",
        box: { x: 0.1, y: 0.1, w: 0.2, h: 0.12 },
      },
    ]);
  };

  return h(
    "section",
    { className: "panel screens-panel" },
    h(
      "div",
      { className: "panel-header" },
      h("h2", null, "截图识别与标注"),
      h("span", { className: "mono" }, screen?.imageInfo ? `${screen.imageInfo.width}x${screen.imageInfo.height}` : "未读取"),
    ),
    h(
      "div",
      { className: "screen-tabs" },
      dashboard.screens.map((item) =>
        h(
          "button",
          { key: item.id, className: item.id === screen.id ? "active" : "", onClick: () => setSelectedScreen(item.id) },
          item.label,
        ),
      ),
    ),
    h(
      "div",
      { className: "annotated-screen" },
      h("img", { src: screen?.mediaUrl, alt: screen?.label }),
      zones.map((zone) =>
        h(
          "div",
          {
            key: zone.id,
            className: "zone-box",
            style: {
              left: `${zone.box.x * 100}%`,
              top: `${zone.box.y * 100}%`,
              width: `${zone.box.w * 100}%`,
              height: `${zone.box.h * 100}%`,
            },
          },
          h("span", null, zone.label),
        ),
      ),
    ),
    h(
      "div",
      { className: "zone-list" },
      zones.map((zone, index) =>
        h(
          "article",
          { className: "zone-row", key: zone.id },
          h(Field, { label: "区域名称", value: zone.label, onChange: (value) => updateZone(index, "label", value) }),
          h(SelectField, {
            label: "类型",
            value: zone.kind,
            options: ["panel", "button", "text", "tab", "row", "checkbox", "manual"].map((item) => ({ value: item, label: item })),
            onChange: (value) => updateZone(index, "kind", value),
          }),
        ),
      ),
    ),
    h(
      "div",
      { className: "row-actions" },
      h("button", { className: "ghost-button compact", onClick: addZone }, "新增标注"),
      h("button", { className: "secondary-button", onClick: () => onSaveAnnotations(screen.id, zones) }, "保存标注"),
    ),
  );
}

function RecentDraws({ draws, dashboard }) {
  return h(
    "section",
    { className: "panel" },
    h("div", { className: "panel-header" }, h("h2", null, "最近模拟"), h("span", { className: "mono" }, `已跑 ${dashboard.workflow.completedRuns} 轮`)),
    draws.length
      ? h(
          "div",
          { className: "draw-grid" },
          draws.map((draw) =>
            h(
              "article",
              { className: "draw-card", key: `${draw.cardId}-${draw.qualityId}-${Math.random()}` },
              h("div", { className: "panel-header" }, h("strong", null, draw.cardName), h(CardBadge, { label: draw.qualityLabel, color: draw.qualityColor })),
              h("small", null, draw.cardId),
              h("div", { className: "panel-header" }, h("span", { className: "muted" }, "价值"), h("strong", null, draw.value)),
            ),
          ),
        )
      : h("div", { className: "empty-state" }, "尚未模拟"),
  );
}

function StatisticsPanel({ dashboard, onRecordSample }) {
  const [sample, setSample] = useState({
    cardId: dashboard.catalog.cards[0]?.id,
    qualityId: dashboard.catalog.qualities[0]?.id,
    count: 1,
  });

  return h(
    "section",
    { className: "panel stats-panel" },
    h("div", { className: "panel-header" }, h("h2", null, "掉落统计"), h("span", { className: "muted" }, `样本 ${dashboard.statistics.samples.length}`)),
    h(
      "div",
      { className: "sample-form" },
      h(SelectField, {
        label: "牌",
        value: sample.cardId,
        options: dashboard.catalog.cards.map((card) => ({ value: card.id, label: card.name })),
        onChange: (value) => setSample({ ...sample, cardId: value }),
      }),
      h(SelectField, {
        label: "品阶",
        value: sample.qualityId,
        options: dashboard.catalog.qualities.map((quality) => ({ value: quality.id, label: quality.label })),
        onChange: (value) => setSample({ ...sample, qualityId: value }),
      }),
      h(Field, {
        label: "次数",
        type: "number",
        value: sample.count,
        onChange: (value) => setSample({ ...sample, count: numberValue(value, 1) }),
      }),
      h("button", { className: "secondary-button", onClick: () => onRecordSample(sample) }, "记录样本"),
    ),
    h(
      "div",
      { className: "table-wrap" },
      h(
        "table",
        null,
        h("thead", null, h("tr", null, h("th", null, "牌"), h("th", null, "品阶"), h("th", null, "次数"), h("th", null, "概率"))),
        h(
          "tbody",
          null,
          dashboard.statistics.summary.map((row) =>
            h(
              "tr",
              { key: row.key },
              h("td", null, row.cardName),
              h("td", null, h("span", { className: "quality-dot", style: { background: row.qualityColor } }), row.qualityLabel),
              h("td", null, row.count),
              h("td", null, `${(row.probability * 100).toFixed(2)}%`),
            ),
          ),
        ),
      ),
    ),
  );
}

function LogsPanel({ logs, capabilities }) {
  return h(
    "section",
    { className: "panel logs-panel" },
    h("div", { className: "panel-header" }, h("h2", null, "运行日志"), h("span", { className: "muted" }, "本地安全模式")),
    h(
      "div",
      { className: "capability-list" },
      capabilities.disabled.map((item) => h("span", { key: item, className: "blocked-chip" }, item)),
    ),
    h(
      "div",
      { className: "log-list" },
      logs.map((log) =>
        h(
          "article",
          { className: "log-item", key: log.id },
          h("div", { className: "log-head" }, h("span", { className: `log-level ${log.level}` }, log.level), h("span", { className: "muted" }, new Date(log.timestamp).toLocaleString("zh-CN"))),
          h("div", null, log.message),
        ),
      ),
    ),
  );
}

function App() {
  const [dashboard, setDashboard] = useState(null);
  const [draws, setDraws] = useState([]);
  const [selectedScreen, setSelectedScreen] = useState("refresh");
  const [error, setError] = useState("");

  const load = async () => {
    const next = await request("/api/dashboard");
    setDashboard(next);
    setSelectedScreen((current) => next.screens.some((screen) => screen.id === current) ? current : next.screens[0]?.id);
  };

  const execute = async (action) => {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    execute(load);
  }, []);

  const cardMap = useMemo(() => {
    if (!dashboard) return {};
    return Object.fromEntries(dashboard.catalog.cards.map((card) => [card.id, card]));
  }, [dashboard]);
  const qualityMap = useMemo(() => {
    if (!dashboard) return {};
    return Object.fromEntries(dashboard.catalog.qualities.map((quality) => [quality.id, quality]));
  }, [dashboard]);

  if (!dashboard) {
    return h("div", { className: "loading" }, "正在加载控制台...");
  }

  return h(
    "div",
    { className: "shell" },
    h(Topbar, {
      dashboard,
      onExport: () => window.open("/api/export", "_blank"),
      onSimulateRefresh: () =>
        execute(async () => {
          const payload = await post("/api/simulate/refresh");
          setDashboard(payload.dashboard);
          setDraws(payload.result.draws || []);
        }),
      onSimulateRun: () =>
        execute(async () => {
          const payload = await post("/api/simulate/run");
          setDashboard(payload.dashboard);
          setDraws(payload.result.refresh?.draws || []);
        }),
    }),
    error ? h("div", { className: "error-banner" }, error) : null,
    h(
      "main",
      { className: "layout" },
      h(
        "div",
        { className: "left-stack" },
        h(ProfilePanel, {
          dashboard,
          onSaveProfile: (payload) => execute(async () => setDashboard(await post("/api/profile", payload))),
          onSaveAttributes: (payload) => execute(async () => setDashboard(await post("/api/attributes", payload))),
        }),
        h(WorkflowPanel, {
          dashboard,
          onSave: (payload) => execute(async () => setDashboard(await post("/api/workflow", payload))),
        }),
      ),
      h(ScreensPanel, {
        dashboard,
        selectedScreen,
        setSelectedScreen,
        onSaveAnnotations: (screenId, zones) => execute(async () => setDashboard(await post("/api/annotations", { screenId, zones }))),
      }),
      h(
        "div",
        { className: "right-stack" },
        h(TargetsPanel, {
          dashboard,
          onSave: (targets) => execute(async () => setDashboard(await post("/api/targets", { targets }))),
        }),
        h(RecentDraws, { draws, dashboard }),
      ),
    ),
    h(
      "section",
      { className: "bottom-layout" },
      h(StatisticsPanel, {
        dashboard,
        onRecordSample: (sample) =>
          execute(async () => {
            setDashboard(
              await post("/api/statistics/sample", {
                lucky: dashboard.profile.currentLucky,
                highestStage: dashboard.profile.highestStage,
                drops: [sample],
              }),
            );
            setDraws([
              {
                ...sample,
                cardName: cardMap[sample.cardId]?.name || sample.cardId,
                qualityLabel: qualityMap[sample.qualityId]?.label || sample.qualityId,
                qualityColor: qualityMap[sample.qualityId]?.color || "#94a3b8",
                value: "手动",
              },
            ]);
          }),
      }),
      h(LogsPanel, { logs: dashboard.logs, capabilities: dashboard.capabilities }),
    ),
  );
}

createRoot(document.getElementById("root")).render(h(App));
