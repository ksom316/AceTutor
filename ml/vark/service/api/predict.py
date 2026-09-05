"""
Vercel Python Function (Phase A3) — the ONE live inference endpoint for the
AceTutor VARK ML prototype: POST /api/predict.

Deployed as its own small, separate Vercel project (Root Directory
ml/vark/service) alongside the main AceTutor app's existing Vercel project —
see this folder's README.md for why. Never imported by, and never runs
inside, the main TanStack Start app's own server functions.

This is a thin wrapper around the REAL trained model saved by
ml/vark/train.py — it loads model/vark_model.joblib with joblib and calls its
own predict_proba(); nothing here reimplements any model logic. The
prediction logic (validate_scores / predict) mirrors ml/vark/predict.py's
predict_from_features() exactly (DataFrame with named columns, probabilities
mapped via model.classes_) so this deployed copy and the local dev CLI can
never silently diverge in how they call the same artifact.

Only ever loads the PRIMARY (4-feature, integration-candidate) model from
model/vark_model.joblib. There is no code path here that can reach the
8-feature experimental artifact - it was never copied into this service
directory at all.

Auth: this endpoint is service-to-service only, never called from a browser.
The caller (predictVarkMlCategory, src/lib/vark-inference.functions.ts) has
already verified the request is an authenticated AceTutor student BEFORE
calling here; this endpoint additionally requires a shared secret
(X-Inference-Secret header == VARK_INFERENCE_SECRET env var) so that even a
leaked/guessed URL can't be used to run inference anonymously.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

MODEL_DIR = Path(__file__).parent.parent / "model"
MODEL_PATH = MODEL_DIR / "vark_model.joblib"
METADATA_PATH = MODEL_DIR / "model_metadata.json"

FEATURE_NAMES = ["visual_score", "auditory_score", "read_write_score", "kinesthetic_score"]
SCORE_MIN, SCORE_MAX = 0, 14

_cache: dict[str, Any] = {}


class InvalidFeatureInput(ValueError):
    """The request body doesn't match the model's exact 4-feature contract."""


def load_model() -> tuple[Any, dict]:
    if "model" in _cache:
        return _cache["model"], _cache["metadata"]
    model = joblib.load(MODEL_PATH)
    metadata = json.loads(METADATA_PATH.read_text())
    _cache["model"] = model
    _cache["metadata"] = metadata
    return model, metadata


def validate_scores(record: dict) -> list[float]:
    """Exactly the 4 assessment scores, each numeric and 0-14. Raises
    InvalidFeatureInput naming precisely what was wrong - never silently
    drops/defaults a bad value."""
    if not isinstance(record, dict):
        raise InvalidFeatureInput("Request body must be a JSON object.")
    missing = [f for f in FEATURE_NAMES if f not in record]
    if missing:
        raise InvalidFeatureInput(f"Missing required feature(s): {missing}")
    extra = [k for k in record if k not in FEATURE_NAMES]
    if extra:
        raise InvalidFeatureInput(
            f"Unexpected feature(s): {extra}. This model requires exactly: {FEATURE_NAMES}"
        )
    values: list[float] = []
    for name in FEATURE_NAMES:
        v = record[name]
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise InvalidFeatureInput(f"Feature '{name}' must be numeric, got {v!r}")
        if v < SCORE_MIN or v > SCORE_MAX:
            raise InvalidFeatureInput(
                f"Feature '{name}' must be between {SCORE_MIN} and {SCORE_MAX}, got {v!r}"
            )
        values.append(float(v))
    return values


def predict(record: dict) -> dict:
    """record -> {predicted_category, confidence, class_probabilities,
    model_version, model_type}. Raises InvalidFeatureInput for a malformed
    record (do_POST maps that to HTTP 400)."""
    values = validate_scores(record)
    model, metadata = load_model()

    X = pd.DataFrame([values], columns=FEATURE_NAMES)
    probabilities = model.predict_proba(X)[0]
    # Map by model.classes_ (sklearn's OWN fitted class order) so
    # probabilities are never silently mislabeled - same approach as
    # ml/vark/predict.py's predict_from_features().
    class_probabilities = {str(cls): float(p) for cls, p in zip(model.classes_, probabilities)}
    predicted_category = max(class_probabilities, key=class_probabilities.get)
    confidence = class_probabilities[predicted_category]

    return {
        "predicted_category": predicted_category,
        "confidence": confidence,
        "class_probabilities": class_probabilities,
        "model_version": metadata.get("model_version"),
        "model_type": metadata.get("model_type"),
    }


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:
        expected_secret = os.environ.get("VARK_INFERENCE_SECRET")
        provided_secret = self.headers.get("X-Inference-Secret")
        # Fail closed: if the env var isn't configured at all, refuse every
        # request rather than accepting an unauthenticated one.
        if not expected_secret or provided_secret != expected_secret:
            self._send_json(401, {"error": "Unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            record = json.loads(raw)
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "Request body must be valid JSON."})
            return

        try:
            result = predict(record)
        except InvalidFeatureInput as e:
            self._send_json(400, {"error": str(e)})
            return
        except Exception:
            # Never leak internals (file paths, stack traces) in the response.
            self._send_json(500, {"error": "Inference failed."})
            return

        self._send_json(200, result)

    def do_GET(self) -> None:
        self._send_json(405, {"error": "Use POST."})
