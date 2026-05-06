import json
import random
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "backend" / "data"
STATE_PATH = DATA_DIR / "state.json"
CATALOG_PATH = ROOT / "shared" / "catalog.json"


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, payload):
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def response(handler: BaseHTTPRequestHandler, status: int, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


class AppState:
    def __init__(self):
        self.catalog = load_json(CATALOG_PATH)
        self.state = load_json(STATE_PATH)

    def persist(self):
        save_json(STATE_PATH, self.state)

    def append_log(self, level: str, message: str):
        self.state["logs"].insert(
            0,
            {
                "id": str(uuid.uuid4()),
                "level": level,
                "timestamp": utc_now(),
                "message": message,
            },
        )
        self.state["logs"] = self.state["logs"][:200]

    def get_catalog_map(self):
        cards = {card["id"]: card for card in self.catalog["cards"]}
        qualities = {quality["id"]: quality for quality in self.catalog["qualities"]}
        stages = {stage["id"]: stage for stage in self.catalog["stages"]}
        return cards, qualities, stages

    def enriched_targets(self):
        cards, qualities, _ = self.get_catalog_map()
        targets = []
        for target in self.state["targets"]:
            card = cards.get(target["cardId"], {})
            quality = qualities.get(target["qualityId"], {})
            progress = 0
            if target["targetCount"] > 0:
                progress = round(target["ownedCount"] / target["targetCount"], 4)
            targets.append(
                {
                    **target,
                    "cardName": card.get("name", target["cardId"]),
                    "cardType": card.get("type", "未知"),
                    "qualityLabel": quality.get("label", target["qualityId"]),
                    "qualityColor": quality.get("color", "#94a3b8"),
                    "completed": target["ownedCount"] >= target["targetCount"],
                    "progress": progress,
                }
            )
        return targets

    def probability_summary(self):
        cards, qualities, _ = self.get_catalog_map()
        counters = {}
        total = 0
        for sample in self.state["statistics"]["samples"]:
            for drop in sample["drops"]:
                key = f'{drop["cardId"]}:{drop["qualityId"]}'
                counters[key] = counters.get(key, 0) + drop["count"]
                total += drop["count"]

        rows = []
        for key, count in counters.items():
            card_id, quality_id = key.split(":")
            rows.append(
                {
                    "key": key,
                    "cardId": card_id,
                    "cardName": cards.get(card_id, {}).get("name", card_id),
                    "qualityId": quality_id,
                    "qualityLabel": qualities.get(quality_id, {}).get("label", quality_id),
                    "count": count,
                    "probability": round(count / total, 4) if total else 0,
                }
            )
        rows.sort(key=lambda item: (-item["count"], item["cardName"], item["qualityId"]))
        return rows

    def dashboard(self):
        workflow = self.state["workflow"]
        return {
            "catalog": self.catalog,
            "profile": self.state["profile"],
            "targets": self.enriched_targets(),
            "workflow": workflow,
            "statistics": {
                "samples": self.state["statistics"]["samples"],
                "summary": self.probability_summary(),
            },
            "logs": self.state["logs"][:50],
            "screens": self.screen_recognition(),
            "derived": {
                "allTargetsCompleted": all(target["completed"] for target in self.enriched_targets())
                if self.state["targets"]
                else False,
                "remainingRefreshTokens": max(
                    0,
                    self.state["profile"]["refreshTokens"]
                    - workflow.get("completedRuns", 0),
                ),
            },
        }

    def update_profile(self, payload):
        profile = self.state["profile"]
        for field in ("playerName", "notes"):
            if field in payload:
                profile[field] = str(payload[field]).strip()
        for field in ("currentLucky", "highestStage", "refreshTokens"):
            if field in payload:
                value = int(payload[field])
                profile[field] = max(0, value)
        self.append_log("info", "已更新规划参数。")
        self.persist()

    def replace_targets(self, payload):
        cards, qualities, _ = self.get_catalog_map()
        next_targets = []
        for row in payload:
            card_id = row.get("cardId")
            quality_id = row.get("qualityId")
            if card_id not in cards or quality_id not in qualities:
                continue
            target_count = max(1, int(row.get("targetCount", 1)))
            owned_count = max(0, int(row.get("ownedCount", 0)))
            next_targets.append(
                {
                    "cardId": card_id,
                    "qualityId": quality_id,
                    "targetCount": target_count,
                    "ownedCount": min(owned_count, target_count),
                }
            )
        self.state["targets"] = next_targets
        self.append_log("info", f"目标牌列表已更新，共 {len(next_targets)} 条。")
        self.persist()

    def update_workflow(self, payload):
        workflow = self.state["workflow"]
        queue = payload.get("queue")
        if isinstance(queue, list) and queue:
            valid_stage_ids = {stage["id"] for stage in self.catalog["stages"]}
            workflow["queue"] = [stage_id for stage_id in queue if stage_id in valid_stage_ids] or workflow["queue"]
        if "loopMode" in payload:
            workflow["loopMode"] = payload["loopMode"]
        if "currentScreen" in payload:
            workflow["currentScreen"] = payload["currentScreen"]
        self.append_log("info", "流程配置已更新。")
        self.persist()

    def screen_recognition(self):
        profile = self.state["profile"]
        _, _, stages = self.get_catalog_map()
        queue = self.state["workflow"]["queue"]
        return [
            {
                "screenId": "initial",
                "summary": "入口页保持在深渊挑战标签。",
                "actions": [
                    "确认当前位于“深渊挑战”入口。",
                    f"预设下一轮关卡队列：{' -> '.join(stages[stage]['label'] for stage in queue)}。",
                ],
            },
            {
                "screenId": "refresh",
                "summary": "从截图中提取当前属性与免费刷新次数。",
                "actions": [
                    f"记录幸运值基线：{profile['currentLucky']}",
                    f"记录已知最高通关：第 {profile['highestStage']} 关",
                    f"当前规划中的刷新券：{profile['refreshTokens']}",
                ],
            },
            {
                "screenId": "boss_select",
                "summary": "根据用户配置建议下一关，但不执行点击。",
                "actions": [f"下一候选关卡：{stages[queue[0]]['label']}"] if queue else [],
            },
            {
                "screenId": "prepare",
                "summary": "准备页包含勾选框与开始按钮位置说明。",
                "actions": ["勾选“跳过匹配直接开始”作为手动操作提示。", "开始前确认当前构筑已同步。"] ,
            },
            {
                "screenId": "ingame",
                "summary": "仅展示推荐动作链，不接入真实按键。",
                "actions": self._ingame_action_hints(queue),
            },
            {
                "screenId": "result",
                "summary": "结算页识别关闭按钮并返回刷新页的流程提示。",
                "actions": ["确认本轮结算已完成。", "关闭结算页后回到刷新规划。"] ,
            },
        ]

    def _ingame_action_hints(self, queue):
        _, _, stages = self.get_catalog_map()
        hints = []
        for stage_id in queue[:2]:
            stage = stages.get(stage_id)
            if not stage:
                continue
            readable = []
            for action in stage["recommendedActions"]:
                if action["kind"] == "keyHold":
                    readable.append(f'按住 {action["key"]} {action["minMs"]}-{action["maxMs"]} ms')
                elif action["kind"] == "keyTapChain":
                    readable.append(" -> ".join(action["keys"]))
                elif action["kind"] == "wait":
                    readable.append(f'等待 {action["minMs"]}-{action["maxMs"]} ms')
            hints.append(f'{stage["label"]}: ' + " / ".join(readable))
        return hints

    def simulate_refresh(self):
        targets = [target for target in self.state["targets"] if target["ownedCount"] < target["targetCount"]]
        if not targets:
            self.append_log("warning", "没有可推进的目标牌，模拟刷新已跳过。")
            self.persist()
            return {"draws": [], "matchedTargets": [], "exhausted": True}

        qualities = self.catalog["qualities"]
        quality_weights = [quality["weight"] for quality in qualities]
        cards = self.catalog["cards"]

        draws = []
        matched_targets = []
        for _ in range(4):
            card = random.choice(cards)
            quality = random.choices(qualities, weights=quality_weights, k=1)[0]
            draw = {
                "cardId": card["id"],
                "cardName": card["name"],
                "qualityId": quality["id"],
                "qualityLabel": quality["label"],
                "qualityColor": quality["color"],
                "value": random.choice([40, 80, 120, 160, 200, 300, 320, 350]),
            }
            draws.append(draw)
            for target in targets:
                if target["cardId"] == draw["cardId"] and target["qualityId"] == draw["qualityId"]:
                    target["ownedCount"] += 1
                    matched_targets.append(
                        {
                            "cardId": target["cardId"],
                            "qualityId": target["qualityId"],
                            "ownedCount": target["ownedCount"],
                            "targetCount": target["targetCount"],
                        }
                    )
                    break

        workflow = self.state["workflow"]
        workflow["currentScreen"] = "refresh"
        workflow["completedRuns"] += 1
        self.state["statistics"]["samples"].insert(
            0,
            {
                "timestamp": utc_now(),
                "lucky": self.state["profile"]["currentLucky"],
                "highestStage": self.state["profile"]["highestStage"],
                "drops": [
                    {"cardId": draw["cardId"], "qualityId": draw["qualityId"], "count": 1}
                    for draw in draws
                ],
            },
        )
        self.state["statistics"]["samples"] = self.state["statistics"]["samples"][:100]
        self.append_log(
            "info",
            f"已完成第 {workflow['completedRuns']} 次本地模拟，抽取 {len(draws)} 张牌。",
        )
        self.persist()
        return {"draws": draws, "matchedTargets": matched_targets, "exhausted": False}

    def simulate_run(self):
        workflow = self.state["workflow"]
        queue = workflow["queue"]
        if not queue:
            workflow["lastError"] = "未配置关卡队列。"
            self.append_log("error", workflow["lastError"])
            self.persist()
            return {"ok": False, "message": workflow["lastError"]}

        current_stage = queue[0]
        if workflow["loopMode"] == "alternate" and len(queue) > 1:
            workflow["queue"] = queue[1:] + [queue[0]]
        workflow["runState"] = "idle"
        workflow["currentScreen"] = "result"
        refresh = self.simulate_refresh()
        return {
            "ok": True,
            "stageId": current_stage,
            "nextQueue": workflow["queue"],
            "refresh": refresh,
        }


APP = AppState()


class RequestHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        response(self, HTTPStatus.NO_CONTENT, {"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/dashboard":
            return response(self, HTTPStatus.OK, APP.dashboard())
        if parsed.path == "/api/catalog":
            return response(self, HTTPStatus.OK, APP.catalog)
        if parsed.path == "/api/screens":
            return response(self, HTTPStatus.OK, APP.screen_recognition())
        if parsed.path == "/api/health":
            return response(self, HTTPStatus.OK, {"ok": True, "time": utc_now()})
        return response(self, HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        payload = self.read_json()
        if parsed.path == "/api/profile":
            APP.update_profile(payload)
            return response(self, HTTPStatus.OK, APP.dashboard())
        if parsed.path == "/api/targets":
            APP.replace_targets(payload if isinstance(payload, list) else payload.get("targets", []))
            return response(self, HTTPStatus.OK, APP.dashboard())
        if parsed.path == "/api/workflow":
            APP.update_workflow(payload)
            return response(self, HTTPStatus.OK, APP.dashboard())
        if parsed.path == "/api/simulate/refresh":
            return response(self, HTTPStatus.OK, APP.simulate_refresh())
        if parsed.path == "/api/simulate/run":
            return response(self, HTTPStatus.OK, APP.simulate_run())
        return response(self, HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def log_message(self, fmt, *args):
        return


def main():
    port = 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), RequestHandler)
    print(f"Backend listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
