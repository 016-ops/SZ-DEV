const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const STATE_PATH = path.join(ROOT, "backend", "data", "state.json");
const CATALOG_PATH = path.join(ROOT, "shared", "catalog.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function utcNow() {
  return new Date().toISOString();
}

function buildMaps(catalog) {
  return {
    cards: Object.fromEntries(catalog.cards.map((card) => [card.id, card])),
    qualities: Object.fromEntries(catalog.qualities.map((quality) => [quality.id, quality])),
    stages: Object.fromEntries(catalog.stages.map((stage) => [stage.id, stage])),
  };
}

function summarizeProbabilities(state, catalog) {
  const maps = buildMaps(catalog);
  const counts = new Map();
  let total = 0;

  for (const sample of state.statistics.samples) {
    for (const drop of sample.drops) {
      const key = `${drop.cardId}:${drop.qualityId}`;
      counts.set(key, (counts.get(key) || 0) + drop.count);
      total += drop.count;
    }
  }

  return [...counts.entries()]
    .map(([key, count]) => {
      const [cardId, qualityId] = key.split(":");
      return {
        key,
        cardId,
        cardName: maps.cards[cardId]?.name || cardId,
        qualityId,
        qualityLabel: maps.qualities[qualityId]?.label || qualityId,
        qualityColor: maps.qualities[qualityId]?.color || "#94a3b8",
        count,
        probability: total ? Number((count / total).toFixed(4)) : 0,
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.cardName.localeCompare(right.cardName, "zh-Hans-CN");
    });
}

function enrichTargets(state, catalog) {
  const maps = buildMaps(catalog);
  return state.targets.map((target) => {
    const card = maps.cards[target.cardId] || {};
    const quality = maps.qualities[target.qualityId] || {};
    const progress = target.targetCount
      ? Number((target.ownedCount / target.targetCount).toFixed(4))
      : 0;

    return {
      ...target,
      cardName: card.name || target.cardId,
      cardType: card.type || "未知",
      qualityLabel: quality.label || target.qualityId,
      qualityColor: quality.color || "#94a3b8",
      completed: target.ownedCount >= target.targetCount,
      progress,
    };
  });
}

function appendLog(state, level, message) {
  state.logs.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    timestamp: utcNow(),
    message,
  });
  state.logs = state.logs.slice(0, 200);
}

function screenRecognition(state, catalog) {
  const maps = buildMaps(catalog);
  const queue = state.workflow.queue;
  const queueLabels = queue.map((stageId) => maps.stages[stageId]?.label || stageId).join(" -> ");

  return catalog.screens.map((screen) => {
    const base = {
      screenId: screen.id,
      label: screen.label,
      file: screen.file,
      mediaUrl: `/media/${encodeURIComponent(screen.file)}`,
      summary: "",
      actions: [],
    };

    if (screen.id === "initial") {
      base.summary = "入口页用于确认挑战页签和下一轮关卡队列。";
      base.actions = [`预设轮换队列：${queueLabels || "未配置"}`];
    } else if (screen.id === "refresh") {
      base.summary = "刷新页用于记录属性面板、免费刷新次数和目标牌进度。";
      base.actions = [
        `幸运值：${state.profile.currentLucky}`,
        `最高通关：第 ${state.profile.highestStage} 关`,
        `规划刷新券：${state.profile.refreshTokens}`,
      ];
    } else if (screen.id === "boss_select") {
      base.summary = "Boss 关选择页只给出建议，不产生真实点击。";
      base.actions = queue.slice(0, 2).map((stageId) => `候选关卡：${maps.stages[stageId]?.label || stageId}`);
    } else if (screen.id === "prepare") {
      base.summary = "开始页展示手动勾选项与开始前检查点。";
      base.actions = ["勾选“跳过匹配直接开始”。", "确认当前构筑与目标牌一致。"];
    } else if (screen.id === "ingame") {
      base.summary = "游戏内页面只输出推荐动作节奏样本。";
      base.actions = queue.slice(0, 2).map((stageId) => {
        const stage = maps.stages[stageId];
        if (!stage) return stageId;
        const readable = stage.recommendedActions.map((action) => {
          if (action.kind === "keyHold") return `按住 ${action.key} ${action.minMs}-${action.maxMs}ms`;
          if (action.kind === "keyTapChain") return action.keys.join(" -> ");
          if (action.kind === "wait") return `等待 ${action.minMs}-${action.maxMs}ms`;
          return action.kind;
        });
        return `${stage.label}: ${readable.join(" / ")}`;
      });
    } else if (screen.id === "result") {
      base.summary = "结算页用于关闭结果页并回到刷新规划。";
      base.actions = ["手动关闭结算。", "回到刷新页后继续记录。"];
    }

    return base;
  });
}

function weightedChoice(items, weights) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = Math.random() * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return items[index];
  }
  return items[items.length - 1];
}

function simulateRefresh(state, catalog) {
  const openTargets = state.targets.filter((target) => target.ownedCount < target.targetCount);
  if (!openTargets.length) {
    appendLog(state, "warning", "没有可推进的目标牌，刷新模拟已跳过。");
    return { draws: [], matchedTargets: [], exhausted: true };
  }

  const qualityWeights = catalog.qualities.map((quality) => quality.weight);
  const draws = [];
  const matchedTargets = [];
  const prices = [40, 80, 120, 160, 200, 300, 320, 350];

  for (let index = 0; index < 4; index += 1) {
    const card = catalog.cards[Math.floor(Math.random() * catalog.cards.length)];
    const quality = weightedChoice(catalog.qualities, qualityWeights);
    const draw = {
      cardId: card.id,
      cardName: card.name,
      qualityId: quality.id,
      qualityLabel: quality.label,
      qualityColor: quality.color,
      value: prices[Math.floor(Math.random() * prices.length)],
    };
    draws.push(draw);

    const match = openTargets.find(
      (target) => target.cardId === draw.cardId && target.qualityId === draw.qualityId,
    );
    if (match) {
      match.ownedCount = Math.min(match.targetCount, match.ownedCount + 1);
      matchedTargets.push({
        cardId: match.cardId,
        qualityId: match.qualityId,
        ownedCount: match.ownedCount,
        targetCount: match.targetCount,
      });
    }
  }

  state.workflow.currentScreen = "refresh";
  state.workflow.completedRuns += 1;
  state.statistics.samples.unshift({
    timestamp: utcNow(),
    lucky: state.profile.currentLucky,
    highestStage: state.profile.highestStage,
    drops: draws.map((draw) => ({
      cardId: draw.cardId,
      qualityId: draw.qualityId,
      count: 1,
    })),
  });
  state.statistics.samples = state.statistics.samples.slice(0, 100);
  appendLog(state, "info", `已完成第 ${state.workflow.completedRuns} 次本地刷新模拟。`);

  return { draws, matchedTargets, exhausted: false };
}

function simulateRun(state, catalog) {
  if (!state.workflow.queue.length) {
    state.workflow.lastError = "未配置关卡轮换队列。";
    appendLog(state, "error", state.workflow.lastError);
    return { ok: false, message: state.workflow.lastError };
  }

  const stageId = state.workflow.queue[0];
  if (state.workflow.loopMode === "alternate" && state.workflow.queue.length > 1) {
    state.workflow.queue = [...state.workflow.queue.slice(1), stageId];
  }
  state.workflow.currentScreen = "result";
  state.workflow.runState = "idle";

  return {
    ok: true,
    stageId,
    nextQueue: state.workflow.queue,
    refresh: simulateRefresh(state, catalog),
  };
}

function buildDashboard(state, catalog) {
  const targets = enrichTargets(state, catalog);
  return {
    catalog,
    profile: state.profile,
    targets,
    workflow: state.workflow,
    statistics: {
      samples: state.statistics.samples,
      summary: summarizeProbabilities(state, catalog),
    },
    logs: state.logs.slice(0, 50),
    screens: screenRecognition(state, catalog),
    derived: {
      allTargetsCompleted: targets.length ? targets.every((target) => target.completed) : false,
      remainingRefreshTokens: Math.max(0, state.profile.refreshTokens - state.workflow.completedRuns),
    },
  };
}

function createStore() {
  function load() {
    return {
      catalog: readJson(CATALOG_PATH),
      state: readJson(STATE_PATH),
    };
  }

  function save(state) {
    writeJson(STATE_PATH, state);
  }

  return {
    dashboard() {
      const { catalog, state } = load();
      return buildDashboard(state, catalog);
    },
    updateProfile(payload) {
      const { catalog, state } = load();
      for (const field of ["playerName", "notes"]) {
        if (payload[field] !== undefined) state.profile[field] = String(payload[field]).trim();
      }
      for (const field of ["currentLucky", "highestStage", "refreshTokens"]) {
        if (payload[field] !== undefined) state.profile[field] = Math.max(0, Number(payload[field]) || 0);
      }
      appendLog(state, "info", "已更新规划参数。");
      save(state);
      return buildDashboard(state, catalog);
    },
    replaceTargets(payload) {
      const { catalog, state } = load();
      const maps = buildMaps(catalog);
      state.targets = payload
        .filter(
          (target) => maps.cards[target.cardId] && maps.qualities[target.qualityId],
        )
        .map((target) => ({
          cardId: target.cardId,
          qualityId: target.qualityId,
          targetCount: Math.max(1, Number(target.targetCount) || 1),
          ownedCount: Math.max(0, Number(target.ownedCount) || 0),
        }))
        .map((target) => ({
          ...target,
          ownedCount: Math.min(target.ownedCount, target.targetCount),
        }));
      appendLog(state, "info", `目标牌列表已更新，共 ${state.targets.length} 条。`);
      save(state);
      return buildDashboard(state, catalog);
    },
    updateWorkflow(payload) {
      const { catalog, state } = load();
      const validStageIds = new Set(catalog.stages.map((stage) => stage.id));
      if (Array.isArray(payload.queue) && payload.queue.length) {
        state.workflow.queue = payload.queue.filter((stageId) => validStageIds.has(stageId));
      }
      if (payload.loopMode) state.workflow.loopMode = payload.loopMode;
      if (payload.currentScreen) state.workflow.currentScreen = payload.currentScreen;
      appendLog(state, "info", "流程配置已更新。");
      save(state);
      return buildDashboard(state, catalog);
    },
    simulateRefresh() {
      const { catalog, state } = load();
      const result = simulateRefresh(state, catalog);
      save(state);
      return { result, dashboard: buildDashboard(state, catalog) };
    },
    simulateRun() {
      const { catalog, state } = load();
      const result = simulateRun(state, catalog);
      save(state);
      return { result, dashboard: buildDashboard(state, catalog) };
    },
  };
}

module.exports = {
  ROOT,
  createStore,
};
