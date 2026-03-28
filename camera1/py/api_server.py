#!/usr/bin/env python3
"""
FastAPI 计算服务

职责：
1. 将原本通过子进程调用的 Python 算法封装成常驻 HTTP 服务
2. 为 Node.js 提供稳定的本地计算 API
3. 保持输入输出格式尽量与旧 JSON 协议一致，降低上层改动
"""

from typing import Any, Dict

from fastapi import FastAPI
from pydantic import BaseModel

from .compute_engine import (
    analyze_events_for_route,
    enrich_incidents_with_cameras,
    evaluate_route_events,
    normalize_incidents,
    plan_routes,
)
from .ml_traffic_predictor import load_or_train, predict


class PayloadModel(BaseModel):
    payload: Dict[str, Any] = {}


app = FastAPI(title="FAST Compute API", version="1.0.0")


@app.on_event("startup")
def startup_event() -> None:
    # ML 模型在服务启动时加载，避免每次请求重复初始化。
    load_or_train()


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True}


@app.post("/compute/normalize-incidents")
def compute_normalize_incidents(body: PayloadModel) -> Dict[str, Any]:
    return normalize_incidents(body.payload)


@app.post("/compute/enrich-incidents-with-cameras")
def compute_enrich_incidents_with_cameras(body: PayloadModel) -> Dict[str, Any]:
    return enrich_incidents_with_cameras(body.payload)


@app.post("/compute/analyze-events-for-route")
def compute_analyze_events_for_route(body: PayloadModel) -> Dict[str, Any]:
    return analyze_events_for_route(body.payload)


@app.post("/compute/evaluate-route-events")
def compute_evaluate_route_events(body: PayloadModel) -> Dict[str, Any]:
    return evaluate_route_events(body.payload)


@app.post("/compute/plan-routes")
def compute_plan_routes(body: PayloadModel) -> Dict[str, Any]:
    return plan_routes(body.payload)


@app.post("/compute/ml-traffic-impact")
def compute_ml_traffic_impact(body: PayloadModel) -> Dict[str, Any]:
    return predict(body.payload)
