"""
Load a saved VARK model and predict on ONE feature record.

Local prototype only — no server/API here (out of scope for this phase).
Defaults to the PRIMARY, INTEGRATION CANDIDATE model (4 features: the VARK
assessment scores only) — its feature contract is the only one eligible for a
later live-integration phase, because all four inputs already exist in
vark_profiles today. "Integration candidate" does NOT mean validated for
real-world deployment: it is evaluated against synthetic data only. Pass
`--experimental` to instead run the 8-feature BEHAVIORAL model, which
requires four simulated engagement features AceTutor has no real source for
yet and must NOT be used against real students.

Usage:
    # integration-candidate model (default) — exactly the four assessment scores
    python predict.py --features '{"visual_score": 11, "auditory_score": 4, \
"read_write_score": 6, "kinesthetic_score": 5}'

    # from a JSON file
    python predict.py --input sample_record.json

    # from stdin
    echo '{...}' | python predict.py

    # the experimental 8-feature model instead
    python predict.py --experimental --features '{"visual_score": 11, ...}'

Output (stdout) is a single structured JSON object:
    {
      "predicted_category": "visual",
      "confidence": 0.62,
      "class_probabilities": {"visual": 0.62, "auditory": 0.10, ...},
      "model_version": "vark-assessment-a2.1-v1"
    }

`predict_from_features()` is also directly importable — this is the "explicit,
reusable feature contract" a later phase (A3) will need when it connects a
predictor to the live `vark_profiles` schema. Only the INTEGRATION CANDIDATE
(4-feature) model's feature contract is intended for that — see README "Two
experiments". Being an integration candidate is a statement about the
feature contract, not a claim of real-world validation.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from schema import ASSESSMENT_FEATURE_NAMES, BEHAVIORAL_FEATURE_NAMES

ARTIFACTS_DIR = Path(__file__).parent / "artifacts"

# Primary = integration candidate, 4-feature (assessment scores only).
PRIMARY_MODEL_PATH = ARTIFACTS_DIR / "vark_model.joblib"
PRIMARY_METADATA_PATH = ARTIFACTS_DIR / "model_metadata.json"
# Experimental = 8-feature (+ simulated behavioural engagement). NOT deployable.
EXPERIMENTAL_MODEL_PATH = ARTIFACTS_DIR / "vark_model_experimental_behavioral.joblib"
EXPERIMENTAL_METADATA_PATH = ARTIFACTS_DIR / "model_metadata_experimental_behavioral.json"

_cache: dict[bool, tuple[Any, dict]] = {}


class PredictionInputError(ValueError):
    """The supplied feature record doesn't match the expected contract."""


def _load_artifacts(experimental: bool = False) -> tuple[Any, dict]:
    if experimental in _cache:
        return _cache[experimental]

    model_path = EXPERIMENTAL_MODEL_PATH if experimental else PRIMARY_MODEL_PATH
    metadata_path = EXPERIMENTAL_METADATA_PATH if experimental else PRIMARY_METADATA_PATH
    expected_features = BEHAVIORAL_FEATURE_NAMES if experimental else ASSESSMENT_FEATURE_NAMES

    if not model_path.exists() or not metadata_path.exists():
        raise SystemExit(
            f"No trained model found at {model_path}. Run generate_dataset.py "
            "then train.py first."
        )

    metadata = json.loads(metadata_path.read_text())
    # Refuse to serve predictions if the saved model's feature contract has
    # drifted from what THIS file (and schema.py) expects — silently
    # mis-ordering a feature vector would produce a confident but meaningless
    # prediction, which is worse than failing loudly.
    if metadata.get("feature_names") != expected_features:
        raise SystemExit(
            "Model metadata feature_names does not match the expected schema. "
            "Retrain with the current schema.py before predicting.\n"
            f"  metadata: {metadata.get('feature_names')}\n"
            f"  expected: {expected_features}"
        )

    model = joblib.load(model_path)
    _cache[experimental] = (model, metadata)
    return model, metadata


def _validate_record(record: dict, feature_names: list[str]) -> list[float]:
    if not isinstance(record, dict):
        raise PredictionInputError("Feature record must be a JSON object.")
    missing = [f for f in feature_names if f not in record]
    if missing:
        raise PredictionInputError(f"Missing required feature(s): {missing}")
    extra = [k for k in record if k not in feature_names]
    if extra:
        raise PredictionInputError(
            f"Unexpected feature(s) not in this model's schema: {extra}. "
            f"This model requires exactly: {feature_names}"
        )

    values: list[float] = []
    for name in feature_names:
        v = record[name]
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise PredictionInputError(f"Feature '{name}' must be numeric, got {v!r}")
        values.append(float(v))
    return values


def predict_from_features(record: dict, experimental: bool = False) -> dict:
    """The reusable entry point: a feature dict in -> a structured result
    dict out. Defaults to the INTEGRATION CANDIDATE (4-feature, assessment-only) model —
    pass experimental=True only for local exploration of the 8-feature
    behavioural model, never for anything resembling live use. Raises
    PredictionInputError for a malformed record."""
    model, metadata = _load_artifacts(experimental=experimental)
    feature_names = BEHAVIORAL_FEATURE_NAMES if experimental else ASSESSMENT_FEATURE_NAMES
    values = _validate_record(record, feature_names)
    # A one-row DataFrame with the exact training column names/order — avoids
    # sklearn's "X does not have valid feature names" warning and keeps the
    # feature contract explicit end to end (the model was fit on a DataFrame
    # with these same names).
    X = pd.DataFrame([values], columns=feature_names)

    probabilities = model.predict_proba(X)[0]
    # Map by model.classes_ (sklearn's OWN fitted class order — not
    # necessarily schema.CLASS_LABELS' order) so probabilities are never
    # silently mislabeled.
    class_probabilities = {str(cls): float(p) for cls, p in zip(model.classes_, probabilities)}
    predicted_category = max(class_probabilities, key=class_probabilities.get)
    confidence = class_probabilities[predicted_category]

    return {
        "predicted_category": predicted_category,
        "confidence": confidence,
        "class_probabilities": class_probabilities,
        "model_version": metadata.get("model_version"),
    }


def _read_record(args: argparse.Namespace) -> dict:
    if args.features is not None:
        raw = args.features
    elif args.input is not None:
        raw = Path(args.input).read_text()
    else:
        raw = sys.stdin.read()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise PredictionInputError(f"Input is not valid JSON: {e}") from e


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--features", type=str, default=None, help="Inline JSON feature record")
    parser.add_argument("--input", type=str, default=None, help="Path to a JSON file with the feature record")
    parser.add_argument(
        "--experimental",
        action="store_true",
        help="Use the 8-feature EXPERIMENTAL behavioral model instead of the integration-candidate default. "
        "Local exploration only — never for anything resembling live use.",
    )
    args = parser.parse_args()

    try:
        record = _read_record(args)
        result = predict_from_features(record, experimental=args.experimental)
    except PredictionInputError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        raise SystemExit(1) from e

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
