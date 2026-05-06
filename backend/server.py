import json
import mimetypes
import os
import random
import struct
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "app" / "public"
DATA_DIR = ROOT / "backend" / "data"
STATE_PATH = DATA_DIR / "state.json"
CATALOG_PATH = ROOT / "shared" / "catalog.json"
TEMPLATE_PATH = ROOT / "shared" / "templates.json"


DEFAULT_STATE = {
    "profile": {
        "playerName": "本地操作者",
        "currentLucky": 300,
        "highestStage": 48,
        "refreshTokens": 9,
        "notes": "本工具只做本地规划、标注与模拟。",
        "attributes": {
            "baseDamageMultiplier": 913,
            "maxHealth": 0,
            "armorDamage": 410,
            "weaponDamage": 1315,
            "healthRegen": "0/5s",
            "lifeSteal": 0,
            "damageReduction": 0,
            "critRate": 31,
            "critDamage": 0,
            "attackSpeed": 500,
            "overloadRate": 0,
            "rangedDamage": 130,
        },
        "quota": {
            "plan": "local_test",
            "remainingRuns": 60,
            "lifetime": False,
        },
    },
    "targets": [],
    "workflow": {
        "queue": ["stage_1", "stage_6"],
        "loopMode": "alternate",
        "currentScreen": "refresh",
        "runState": "idle",
        "completedRuns": 0,
        "refreshesUsed": 0,
        "lastError": None,
        "safetyMode": "manual-preview",
    },
    "recognition": {
        "annotations": {},
    },
    "statistics": {
        "samples": [],
    },
    "logs": [],
}


class ValidationError(Exception):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path, fallback=None):
    if not path.exists():
        return deepcopy(fallback)
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def merge_defaults(current, default):
    if isinstance(default, dict):
        if not isinstance(current, dict):
            current = {}
        for key, value in default.items():
            current[key] = merge_defaults(current.get(key), value)
        return current
    if current is None:
        return deepcopy(default)
    return current


def clamp_int(value, minimum=0, maximum=10_000_000):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"数值无效: {value}")
    return max(minimum, min(maximum, parsed))


def png_size(path: Path):
    if not path.exists():
        return None
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width, height = struct.unpack(">II", header[16:24])
    return {"width": width, "height": height}


def send_json(handler, status, payload):
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


def send_bytes(handler, status, body, content_type):
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class AppState:
    def __init__(self):
        self.catalog = load_json(CATALOG_PATH, {"cards": [], "qualities": [], "stages": [], "screens": []})
        self.templates = load_json(TEMPLATE_PATH, {"screens": {}})
        self.state = merge_defaults(load_json(STATE_PATH, DEFAULT_STATE), DEFAULT_STATE)
        self.persist()

    def persist(self):
        save_json(STATE_PATH, self.state)

    def maps(self):
        return {
            "cards": {card["id"]: card for card in self.catalog["cards"]},
            "qualities": {quality["id"]: quality for quality in self.catalog["qualities"]},
            "stages": {stage["id"]: stage for stage in self.catalog["stages"]},
            "screens": {screen["id"]: screen for screen in self.catalog["screens"]},
        }

    def append_log(self, level, message):
        self.state["logs"].insert(
            0,
            {
                "id": str(uuid.uuid4()),
                "level": level,
                "timestamp": utc_now(),
                "message": message,
            },
        )
        self.state["logs"] = self.state["logs"][:300]

    def enriched_targets(self):
        maps = self.maps()
        rows = []
        for target in self.state["targets"]:
            card = maps["cards"].get(target["cardId"], {})
            quality = maps["qualities"].get(target["qualityId"], {})
            target_count = max(1, int(target.get("targetCount", 1)))
            owned_count = min(max(0, int(target.get("ownedCount", 0))), target_count)
            rows.append(
                {
                    **target,
                    "targetCount": target_count,
                    "ownedCount": owned_count,
                    "cardName": card.get("name", target["cardId"]),
                    "cardType": card.get("type", "未知"),
                    "qualityLabel": quality.get("label", target["qualityId"]),
                    "qualityColor": quality.get("color", "#94a3b8"),
                    "completed": owned_count >= target_count,
                    "remaining": max(0, target_count - owned_count),
                    "progress": round(owned_count / target_count, 4),
                }
            )
        return rows

    def statistics_summary(self):
        maps = self.maps()
        total = 0
        card_counts = {}
        lucky_groups = {}
        stage_groups = {}

        for sample in self.state["statistics"]["samples"]:
            lucky_key = str(sample.get("lucky", "未记录"))
            stage_key = str(sample.get("highestStage", "未记录"))
            lucky_groups.setdefault(lucky_key, 0)
            stage_groups.setdefault(stage_key, 0)
            for drop in sample.get("drops", []):
                count = clamp_int(drop.get("count", 1), 0, 9999)
                key = f'{drop.get("cardId")}:{drop.get("qualityId")}'
                card_counts[key] = card_counts.get(key, 0) + count
                lucky_groups[lucky_key] += count
                stage_groups[stage_key] += count
                total += count

        rows = []
        for key, count in card_counts.items():
            card_id, quality_id = key.split(":", 1)
            card = maps["cards"].get(card_id, {})
            quality = maps["qualities"].get(quality_id, {})
            rows.append(
                {
                    "key": key,
                    "cardId": card_id,
                    "cardName": card.get("name", card_id),
                    "qualityId": quality_id,
                    "qualityLabel": quality.get("label", quality_id),
                    "qualityColor": quality.get("color", "#94a3b8"),
                    "count": count,
                    "probability": round(count / total, 4) if total else 0,
                }
            )
        rows.sort(key=lambda item: (-item["count"], item["cardName"], item["qualityId"]))
        return {
            "totalDrops": total,
            "summary": rows,
            "byLucky": [{"lucky": key, "count": value} for key, value in sorted(lucky_groups.items())],
            "byHighestStage": [
                {"highestStage": key, "count": value}
                for key, value in sorted(stage_groups.items(), key=lambda item: str(item[0]))
            ],
            "samples": self.state["statistics"]["samples"][:100],
        }

    def workflow_action_plan(self):
        maps = self.maps()
        actions = []
        for stage_id in self.state["workflow"]["queue"]:
            stage = maps["stages"].get(stage_id)
            if not stage:
                continue
            readable = []
            for action in stage.get("recommendedActions", []):
                if action["kind"] == "keyHold":
                    readable.append(
                        {
                            **action,
                            "label": f'按住 {action["key"]} {action["minMs"]}-{action["maxMs"]}ms',
                        }
                    )
                elif action["kind"] == "keyTapChain":
                    readable.append({**action, "label": " -> ".join(action["keys"])})
                elif action["kind"] == "wait":
                    readable.append({**action, "label": f'等待 {action["minMs"]}-{action["maxMs"]}ms'})
            actions.append({"stageId": stage_id, "stageLabel": stage["label"], "actions": readable})
        return actions

    def screen_templates(self):
        default_screens = self.templates.get("screens", {})
        overrides = self.state.get("recognition", {}).get("annotations", {})
        result = {}
        for screen_id, template in default_screens.items():
            zones = deepcopy(template.get("zones", []))
            zones.extend(deepcopy(overrides.get(screen_id, [])))
            result[screen_id] = {**template, "zones": zones}
        for screen_id, zones in overrides.items():
            result.setdefault(screen_id, {"zones": []})
            known = {zone["id"] for zone in result[screen_id]["zones"]}
            result[screen_id]["zones"].extend([zone for zone in zones if zone["id"] not in known])
        return result

    def screens(self):
        templates = self.screen_templates()
        actions_by_screen = {
            "initial": [
                "确认挑战入口与页签位置。",
                f"当前关卡队列：{' -> '.join(self.state['workflow']['queue'])}",
            ],
            "refresh": [
                "记录左侧属性面板。",
                "核对目标牌、品阶、价格区域。",
                f"剩余刷新规划次数：{self.remaining_refresh_tokens()}",
            ],
            "boss_select": ["根据队列给出下一关建议，但不执行真实点击。"],
            "prepare": ["展示开始前检查清单。", "不直接控制游戏。"],
            "ingame": ["展示动作节奏计划，不发送真实键鼠输入。"],
            "result": ["记录结算状态。", "回到刷新页后继续人工校验。"],
        }
        output = []
        for screen in self.catalog["screens"]:
            file_path = ROOT / screen["file"]
            output.append(
                {
                    **screen,
                    "mediaUrl": f"/media/{screen['file']}",
                    "imageInfo": png_size(file_path),
                    "exists": file_path.exists(),
                    "template": templates.get(screen["id"], {"zones": []}),
                    "actions": actions_by_screen.get(screen["id"], []),
                    "active": screen["id"] == self.state["workflow"]["currentScreen"],
                }
            )
        return output

    def remaining_refresh_tokens(self):
        return max(
            0,
            int(self.state["profile"].get("refreshTokens", 0))
            - int(self.state["workflow"].get("refreshesUsed", 0)),
        )

    def dashboard(self):
        targets = self.enriched_targets()
        stats = self.statistics_summary()
        return {
            "catalog": self.catalog,
            "profile": self.state["profile"],
            "targets": targets,
            "workflow": self.state["workflow"],
            "actionPlan": self.workflow_action_plan(),
            "statistics": stats,
            "screens": self.screens(),
            "logs": self.state["logs"][:80],
            "capabilities": {
                "enabled": ["本地配置", "截图标注", "流程模拟", "概率统计", "配置导入导出"],
                "disabled": ["真实游戏控制", "键鼠注入", "反作弊绕过", "后门", "真实支付"],
            },
            "derived": {
                "allTargetsCompleted": bool(targets) and all(target["completed"] for target in targets),
                "remainingRefreshTokens": self.remaining_refresh_tokens(),
                "totalOpenTargets": sum(target["remaining"] for target in targets),
                "totalDrops": stats["totalDrops"],
            },
        }

    def update_profile(self, payload):
        profile = self.state["profile"]
        for field in ("playerName", "notes"):
            if field in payload:
                profile[field] = str(payload[field]).strip()
        for field in ("currentLucky", "highestStage", "refreshTokens"):
            if field in payload:
                profile[field] = clamp_int(payload[field], 0)
        if "quota" in payload and isinstance(payload["quota"], dict):
            quota = profile.setdefault("quota", {})
            quota["plan"] = str(payload["quota"].get("plan", quota.get("plan", "local_test")))
            quota["remainingRuns"] = clamp_int(payload["quota"].get("remainingRuns", quota.get("remainingRuns", 0)), 0)
            quota["lifetime"] = bool(payload["quota"].get("lifetime", quota.get("lifetime", False)))
        self.append_log("info", "已更新本地规划参数。")
        self.persist()

    def update_attributes(self, payload):
        attributes = self.state["profile"].setdefault("attributes", {})
        if not isinstance(payload, dict):
            raise ValidationError("属性数据必须是对象。")
        for key, value in payload.items():
            attributes[str(key)] = value
        self.append_log("info", "已更新属性面板记录。")
        self.persist()

    def replace_targets(self, payload):
        if not isinstance(payload, list):
            raise ValidationError("目标牌数据必须是数组。")
        maps = self.maps()
        rows = []
        seen = set()
        for item in payload:
            card_id = item.get("cardId")
            quality_id = item.get("qualityId")
            if card_id not in maps["cards"] or quality_id not in maps["qualities"]:
                continue
            key = f"{card_id}:{quality_id}"
            if key in seen:
                continue
            seen.add(key)
            target_count = clamp_int(item.get("targetCount", 1), 1, 999)
            owned_count = clamp_int(item.get("ownedCount", 0), 0, target_count)
            rows.append(
                {
                    "cardId": card_id,
                    "qualityId": quality_id,
                    "targetCount": target_count,
                    "ownedCount": owned_count,
                }
            )
        self.state["targets"] = rows
        self.append_log("info", f"目标牌配置已保存，共 {len(rows)} 项。")
        self.persist()

    def update_workflow(self, payload):
        workflow = self.state["workflow"]
        maps = self.maps()
        if "queue" in payload:
            if not isinstance(payload["queue"], list):
                raise ValidationError("关卡队列必须是数组。")
            queue = [stage_id for stage_id in payload["queue"] if stage_id in maps["stages"]]
            if not queue:
                raise ValidationError("至少选择一个关卡。")
            workflow["queue"] = queue
        if "loopMode" in payload:
            workflow["loopMode"] = str(payload["loopMode"])
        if "currentScreen" in payload and payload["currentScreen"] in maps["screens"]:
            workflow["currentScreen"] = payload["currentScreen"]
        self.append_log("info", "流程配置已保存。")
        self.persist()

    def update_annotations(self, payload):
        screen_id = payload.get("screenId")
        maps = self.maps()
        if screen_id not in maps["screens"]:
            raise ValidationError("未知截图页面。")
        zones = payload.get("zones", [])
        if not isinstance(zones, list):
            raise ValidationError("标注区域必须是数组。")
        normalized = []
        for zone in zones:
            box = zone.get("box", {})
            normalized.append(
                {
                    "id": str(zone.get("id") or uuid.uuid4()),
                    "label": str(zone.get("label") or "未命名区域"),
                    "kind": str(zone.get("kind") or "manual"),
                    "purpose": str(zone.get("purpose") or "manual-note"),
                    "box": {
                        "x": min(1, max(0, float(box.get("x", 0)))),
                        "y": min(1, max(0, float(box.get("y", 0)))),
                        "w": min(1, max(0.01, float(box.get("w", 0.1)))),
                        "h": min(1, max(0.01, float(box.get("h", 0.1)))),
                    },
                }
            )
        self.state.setdefault("recognition", {}).setdefault("annotations", {})[screen_id] = normalized
        self.append_log("info", f"已保存 {maps['screens'][screen_id]['label']} 的 {len(normalized)} 个自定义标注。")
        self.persist()

    def record_sample(self, payload):
        maps = self.maps()
        drops = []
        for drop in payload.get("drops", []):
            card_id = drop.get("cardId")
            quality_id = drop.get("qualityId")
            if card_id in maps["cards"] and quality_id in maps["qualities"]:
                drops.append(
                    {
                        "cardId": card_id,
                        "qualityId": quality_id,
                        "count": clamp_int(drop.get("count", 1), 1, 999),
                    }
                )
        if not drops:
            raise ValidationError("至少记录一条有效掉落。")
        self.state["statistics"]["samples"].insert(
            0,
            {
                "timestamp": utc_now(),
                "lucky": clamp_int(payload.get("lucky", self.state["profile"]["currentLucky"]), 0),
                "highestStage": clamp_int(payload.get("highestStage", self.state["profile"]["highestStage"]), 0),
                "drops": drops,
            },
        )
        self.state["statistics"]["samples"] = self.state["statistics"]["samples"][:500]
        self.append_log("info", f"已手动记录 {len(drops)} 条掉落样本。")
        self.persist()

    def simulate_refresh(self):
        if self.remaining_refresh_tokens() <= 0:
            message = "刷新规划次数已用完，模拟刷新被跳过。"
            self.state["workflow"]["lastError"] = message
            self.append_log("warning", message)
            self.persist()
            return {"ok": False, "draws": [], "matchedTargets": [], "message": message}

        maps = self.maps()
        qualities = self.catalog["qualities"]
        weights = [quality.get("weight", 1) for quality in qualities]
        prices = [40, 80, 120, 160, 200, 300, 320, 350]
        draws = []
        matched = []

        open_targets = [target for target in self.state["targets"] if target["ownedCount"] < target["targetCount"]]
        for _ in range(4):
            card = random.choice(self.catalog["cards"])
            quality = random.choices(qualities, weights=weights, k=1)[0]
            draw = {
                "cardId": card["id"],
                "cardName": card["name"],
                "qualityId": quality["id"],
                "qualityLabel": quality["label"],
                "qualityColor": quality["color"],
                "value": random.choice(prices),
            }
            draws.append(draw)
            for target in open_targets:
                if target["cardId"] == draw["cardId"] and target["qualityId"] == draw["qualityId"]:
                    target["ownedCount"] = min(target["targetCount"], target["ownedCount"] + 1)
                    matched.append(
                        {
                            "cardId": target["cardId"],
                            "cardName": maps["cards"][target["cardId"]]["name"],
                            "qualityId": target["qualityId"],
                            "qualityLabel": maps["qualities"][target["qualityId"]]["label"],
                            "ownedCount": target["ownedCount"],
                            "targetCount": target["targetCount"],
                        }
                    )
                    break

        self.state["workflow"]["refreshesUsed"] = int(self.state["workflow"].get("refreshesUsed", 0)) + 1
        self.state["workflow"]["currentScreen"] = "refresh"
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
        self.state["statistics"]["samples"] = self.state["statistics"]["samples"][:500]
        self.append_log("info", f"完成 1 次本地刷新模拟，命中目标 {len(matched)} 项。")
        self.persist()
        return {"ok": True, "draws": draws, "matchedTargets": matched}

    def simulate_run(self):
        workflow = self.state["workflow"]
        quota = self.state["profile"].setdefault("quota", DEFAULT_STATE["profile"]["quota"])
        if not quota.get("lifetime") and int(quota.get("remainingRuns", 0)) <= 0:
            message = "本地测试额度已用完，请在规划参数中调整测试额度。"
            workflow["lastError"] = message
            self.append_log("warning", message)
            self.persist()
            return {"ok": False, "message": message}
        if not workflow["queue"]:
            raise ValidationError("未配置关卡队列。")

        stage_id = workflow["queue"][0]
        if workflow.get("loopMode") == "alternate" and len(workflow["queue"]) > 1:
            workflow["queue"] = workflow["queue"][1:] + [stage_id]
        if not quota.get("lifetime"):
            quota["remainingRuns"] = max(0, int(quota.get("remainingRuns", 0)) - 1)
        workflow["completedRuns"] = int(workflow.get("completedRuns", 0)) + 1
        workflow["currentScreen"] = "result"
        workflow["lastError"] = None
        refresh = self.simulate_refresh()
        self.append_log("info", f"完成 1 次本地流程模拟，关卡：{stage_id}。")
        self.persist()
        return {"ok": True, "stageId": stage_id, "nextQueue": workflow["queue"], "refresh": refresh}

    def export_state(self):
        return {
            "catalog": self.catalog,
            "state": self.state,
            "exportedAt": utc_now(),
            "version": 1,
        }


APP = AppState()


class RequestHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        send_json(self, HTTPStatus.NO_CONTENT, {"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                return send_json(self, HTTPStatus.OK, {"ok": True, "time": utc_now()})
            if parsed.path == "/api/dashboard":
                return send_json(self, HTTPStatus.OK, APP.dashboard())
            if parsed.path == "/api/catalog":
                return send_json(self, HTTPStatus.OK, APP.catalog)
            if parsed.path == "/api/screens":
                return send_json(self, HTTPStatus.OK, APP.screens())
            if parsed.path == "/api/export":
                return send_json(self, HTTPStatus.OK, APP.export_state())
            if parsed.path.startswith("/media/"):
                return self.serve_media(parsed.path)
            return self.serve_static(parsed.path)
        except Exception as error:
            return self.handle_error(error)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self.read_json()
            if parsed.path == "/api/profile":
                APP.update_profile(payload)
                return send_json(self, HTTPStatus.OK, APP.dashboard())
            if parsed.path == "/api/attributes":
                APP.update_attributes(payload)
                return send_json(self, HTTPStatus.OK, APP.dashboard())
            if parsed.path == "/api/targets":
                APP.replace_targets(payload.get("targets", payload) if isinstance(payload, dict) else payload)
                return send_json(self, HTTPStatus.OK, APP.dashboard())
            if parsed.path == "/api/workflow":
                APP.update_workflow(payload)
                return send_json(self, HTTPStatus.OK, APP.dashboard())
            if parsed.path == "/api/annotations":
                APP.update_annotations(payload)
                return send_json(self, HTTPStatus.OK, APP.dashboard())
            if parsed.path == "/api/statistics/sample":
                APP.record_sample(payload)
                return send_json(self, HTTPStatus.OK, APP.dashboard())
            if parsed.path == "/api/simulate/refresh":
                return send_json(self, HTTPStatus.OK, {"result": APP.simulate_refresh(), "dashboard": APP.dashboard()})
            if parsed.path == "/api/simulate/run":
                return send_json(self, HTTPStatus.OK, {"result": APP.simulate_run(), "dashboard": APP.dashboard()})
            return send_json(self, HTTPStatus.NOT_FOUND, {"error": "Not found"})
        except Exception as error:
            return self.handle_error(error)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8")) if raw else {}

    def serve_media(self, path):
        file_name = unquote(path.replace("/media/", "", 1))
        file_path = (ROOT / file_name).resolve()
        if ROOT not in file_path.parents and file_path != ROOT:
            return send_json(self, HTTPStatus.FORBIDDEN, {"error": "Forbidden"})
        if not file_path.exists() or not file_path.is_file():
            return send_json(self, HTTPStatus.NOT_FOUND, {"error": "Media not found"})
        mime = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        return send_bytes(self, HTTPStatus.OK, file_path.read_bytes(), mime)

    def serve_static(self, request_path):
        path = "/index.html" if request_path in ("", "/") else request_path
        file_path = (PUBLIC_DIR / path.lstrip("/")).resolve()
        if PUBLIC_DIR not in file_path.parents and file_path != PUBLIC_DIR:
            return send_json(self, HTTPStatus.FORBIDDEN, {"error": "Forbidden"})
        if not file_path.exists() or not file_path.is_file():
            file_path = PUBLIC_DIR / "index.html"
        mime = mimetypes.guess_type(str(file_path))[0] or "text/html"
        if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
            mime = f"{mime}; charset=utf-8"
        return send_bytes(self, HTTPStatus.OK, file_path.read_bytes(), mime)

    def handle_error(self, error):
        status = HTTPStatus.BAD_REQUEST if isinstance(error, ValidationError) else HTTPStatus.INTERNAL_SERVER_ERROR
        APP.state["workflow"]["lastError"] = str(error)
        APP.append_log("error" if status == HTTPStatus.INTERNAL_SERVER_ERROR else "warning", str(error))
        APP.persist()
        return send_json(self, status, {"error": str(error)})

    def log_message(self, fmt, *args):
        return


def main():
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), RequestHandler)
    print(f"Backend listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
