"""
Train + evaluate TWO SEPARATE experiments on the synthetic VARK dataset:

  1. ASSESSMENT   (4 features: the VARK scores only)             -> INTEGRATION CANDIDATE
  2. BEHAVIORAL   (8 features: scores + simulated engagement)     -> EXPERIMENTAL, not deployable

Split this way (Phase A2.1) because the original single 8-feature experiment
mixed something AceTutor genuinely has (the four VARK assessment scores —
1:1 with vark_profiles.{visual,auditory,read_write,kinesthetic}_score) with
something it does not yet collect anywhere (behavioural engagement signals).
A live classifier must never require fabricated/default behavioural inputs,
so only the 4-feature ASSESSMENT model's FEATURE CONTRACT is eligible for a
later integration phase (A3) — the 8-feature BEHAVIORAL model is kept purely
to keep exploring whether engagement signals are worth collecting later (see
README).

"Integration candidate" is deliberately NOT called "deployable": it means the
feature contract can be wired into AceTutor without fabricated inputs — it
does NOT mean the model has been validated for real-world deployment. Its
evaluation here is against synthetic data only (current held-out macro F1
~0.39); meaningful validation/retraining will need live behavioural/outcome
data collected later.

Both experiments train the same two algorithms (RandomForestClassifier,
GradientBoostingClassifier) on the SAME underlying synthetic dataset — just a
different column subset — with the same stratified 80/20 split, the same
lightweight stratified 5-fold cross-validation, and the same selection rule
(macro F1 primary, accuracy secondary), so their numbers are directly
comparable to each other.

Usage:
    python generate_dataset.py      # once, or whenever you want a fresh set
    python train.py

Artifacts:
    artifacts/vark_model.joblib                            <- PRIMARY: integration-candidate, 4-feature winner
    artifacts/model_metadata.json                          <- its metadata
    artifacts/vark_model_experimental_behavioral.joblib    <- EXPERIMENTAL: 8-feature winner
    artifacts/model_metadata_experimental_behavioral.json  <- its metadata

This dataset is synthetic (see generate_dataset.py). Nothing this script
prints is evidence of real-world VARK classification accuracy.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split

from schema import (
    ASSESSMENT_FEATURE_NAMES,
    BEHAVIORAL_FEATURE_NAMES,
    CLASS_LABELS,
    EXPERIMENTAL,
    INTEGRATION_CANDIDATE,
    SCHEMA_VERSION,
    TARGET_COLUMN,
)

DEFAULT_SEED = 42
DEFAULT_DATA = Path(__file__).parent / "data" / "vark_synthetic.csv"
ARTIFACTS_DIR = Path(__file__).parent / "artifacts"

MODEL_VERSION_ASSESSMENT = "vark-assessment-a2.1-v1"
MODEL_VERSION_BEHAVIORAL = "vark-behavioral-experimental-a2.1-v1"

SYNTHETIC_DISCLAIMER = (
    "Trained and evaluated on a SYNTHETIC dataset (see generate_dataset.py). "
    "These metrics describe model fit to simulated data for prototype/"
    "development validation of the training pipeline ONLY. They are NOT "
    "evidence of real-world VARK classification accuracy for actual AceTutor "
    "students."
)

ASSESSMENT_LIMITATIONS = [
    SYNTHETIC_DISCLAIMER,
    "Uses only the four VARK assessment scores (visual_score, auditory_score, "
    "read_write_score, kinesthetic_score) - this is why it is an INTEGRATION "
    "CANDIDATE: all four inputs already exist in vark_profiles today, so this "
    "feature contract could be wired in without fabricating or defaulting any "
    "input. This does NOT mean the model has been validated for real-world "
    "deployment - its evaluation here is against synthetic data only "
    "(current held-out macro F1 ~0.39). Meaningful validation/retraining will "
    "require live behavioural/outcome data collected later.",
    "Not yet integrated into AceTutor. prediction_source stays 'assessment' "
    "in vark_profiles until Phase A3 deliberately connects a real predictor.",
]

BEHAVIORAL_LIMITATIONS = [
    SYNTHETIC_DISCLAIMER,
    "Uses four SIMULATED behavioural engagement features (video_engagement, "
    "audio_engagement, text_engagement, practice_engagement) that AceTutor "
    "does not currently compute or store anywhere. EXPERIMENTAL ONLY - this "
    "model must NOT be connected to the live app, because doing so would "
    "require fabricating or defaulting those four inputs.",
    "Kept only to keep exploring whether behavioural signals are worth "
    "collecting. A genuine data source for them is expected from a later "
    "phase (A6) before this feature set could be retrained on real data and "
    "reconsidered for deployment.",
]


def _build_models(seed: int) -> dict[str, object]:
    return {
        "random_forest": RandomForestClassifier(
            n_estimators=300,
            max_depth=None,
            min_samples_leaf=2,
            random_state=seed,
        ),
        "gradient_boosting": GradientBoostingClassifier(
            n_estimators=200,
            learning_rate=0.05,
            max_depth=3,
            random_state=seed,
        ),
    }


def _evaluate(model, X_test: pd.DataFrame, y_test: pd.Series) -> dict:
    y_pred = model.predict(X_test)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, y_pred, labels=CLASS_LABELS, average="macro", zero_division=0
    )
    cm = confusion_matrix(y_test, y_pred, labels=CLASS_LABELS)
    return {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "macro_precision": float(precision),
        "macro_recall": float(recall),
        "macro_f1": float(f1),
        # Rows = true class, columns = predicted class, both in CLASS_LABELS
        # order (NOT sklearn's alphabetical default) so this is unambiguous
        # without cross-referencing model.classes_.
        "confusion_matrix": {"labels_order": CLASS_LABELS, "matrix": cm.tolist()},
    }


def _cross_validate(model, X_train: pd.DataFrame, y_train: pd.Series, seed: int) -> dict:
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    scores = cross_validate(
        model, X_train, y_train, cv=cv, scoring=["accuracy", "f1_macro"], n_jobs=None
    )
    return {
        "folds": 5,
        "accuracy_mean": float(np.mean(scores["test_accuracy"])),
        "accuracy_std": float(np.std(scores["test_accuracy"])),
        "macro_f1_mean": float(np.mean(scores["test_f1_macro"])),
        "macro_f1_std": float(np.std(scores["test_f1_macro"])),
    }


def run_experiment(
    label: str, feature_names: list[str], df: pd.DataFrame, seed: int
) -> dict:
    """Trains + evaluates BOTH algorithms on `feature_names`, prints a
    comparison, and returns everything needed to persist the winner (already
    refit on the full dataset)."""
    X = df[feature_names]
    y = df[TARGET_COLUMN]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=seed
    )

    print(f"=== Experiment: {label} ({len(feature_names)} features: {feature_names}) ===")
    print(f"{len(df)} rows ({len(X_train)} train / {len(X_test)} test)")

    results: dict[str, dict] = {}
    for model_name, model in _build_models(seed).items():
        cv_result = _cross_validate(model, X_train, y_train, seed)
        model.fit(X_train, y_train)
        test_result = _evaluate(model, X_test, y_test)
        results[model_name] = {**test_result, "cross_validation": cv_result}

        print(f"--- {model_name} ---")
        print(
            f"  test:  accuracy={test_result['accuracy']:.3f}  "
            f"macro_precision={test_result['macro_precision']:.3f}  "
            f"macro_recall={test_result['macro_recall']:.3f}  "
            f"macro_f1={test_result['macro_f1']:.3f}"
        )
        print(
            f"  cv(5): accuracy={cv_result['accuracy_mean']:.3f}"
            f"+/-{cv_result['accuracy_std']:.3f}  "
            f"macro_f1={cv_result['macro_f1_mean']:.3f}+/-{cv_result['macro_f1_std']:.3f}"
        )
        print(f"  confusion_matrix (rows=true, cols=pred, order={CLASS_LABELS}):")
        for cls_label, row in zip(CLASS_LABELS, test_result["confusion_matrix"]["matrix"]):
            print(f"    {cls_label:>12}: {row}")

    winner_name = max(results, key=lambda n: (results[n]["macro_f1"], results[n]["accuracy"]))
    print(f"Winner for '{label}' (by macro F1, accuracy as tie-break): {winner_name}\n")

    # Refit the winner on the FULL dataset for the persisted artifact — the
    # reported metrics above still reflect the held-out test split, not this.
    winner_model = _build_models(seed)[winner_name]
    winner_model.fit(X, y)

    return {
        "results": results,
        "winner_name": winner_name,
        "winner_model": winner_model,
        "train_size": len(X_train),
        "test_size": len(X_test),
    }


def _build_metadata(
    *,
    experiment: dict,
    feature_names: list[str],
    feature_set_label: str,
    model_version: str,
    deployment_status: str,
    limitations: list[str],
    dataset_size: int,
    dataset_path: Path,
    seed: int,
) -> dict:
    winner_model = experiment["winner_model"]
    return {
        "model_type": type(winner_model).__name__,
        "winner": experiment["winner_name"],
        "model_version": model_version,
        "schema_version": SCHEMA_VERSION,
        "deployment_status": deployment_status,
        "feature_set": feature_set_label,
        "feature_names": feature_names,
        "class_labels": CLASS_LABELS,
        "model_classes_order": list(winner_model.classes_),
        "training_timestamp": datetime.now(timezone.utc).isoformat(),
        "random_seed": seed,
        "dataset_type": "synthetic",
        "dataset_path": str(dataset_path),
        "dataset_size": dataset_size,
        "train_size": experiment["train_size"],
        "test_size": experiment["test_size"],
        "selection_metric": "macro_f1",
        "selection_secondary_metric": "accuracy",
        "final_model_trained_on": "full_dataset",
        "reported_metrics_computed_on": "held_out_test_split",
        "models_compared": experiment["results"],
        "limitations": limitations,
        "prediction_source": "assessment",
        "note": "prediction_source is NOT changed by this artifact. Live "
        "integration (writing prediction_source='ml_model' into "
        "vark_profiles) is Phase A3, not implemented here.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--artifacts-dir", type=Path, default=ARTIFACTS_DIR)
    args = parser.parse_args()

    if not args.data.exists():
        raise SystemExit(
            f"{args.data} not found — run generate_dataset.py first "
            "(python generate_dataset.py)."
        )

    df = pd.read_csv(args.data)
    missing = set(BEHAVIORAL_FEATURE_NAMES) - set(df.columns)
    if missing:
        raise SystemExit(f"Dataset is missing expected feature columns: {sorted(missing)}")

    print(SYNTHETIC_DISCLAIMER)
    print()

    assessment = run_experiment("ASSESSMENT (integration candidate)", ASSESSMENT_FEATURE_NAMES, df, args.seed)
    behavioral = run_experiment("BEHAVIORAL (experimental, not deployable)", BEHAVIORAL_FEATURE_NAMES, df, args.seed)

    print(f"Integration-candidate winner (4-feature assessment): {assessment['winner_name']}")
    print(f"Experimental winner          (8-feature behavioral): {behavioral['winner_name']}")

    args.artifacts_dir.mkdir(parents=True, exist_ok=True)

    # --- PRIMARY artifact: integration candidate, 4-feature -----------------
    primary_model_path = args.artifacts_dir / "vark_model.joblib"
    joblib.dump(assessment["winner_model"], primary_model_path)
    primary_metadata = _build_metadata(
        experiment=assessment,
        feature_names=ASSESSMENT_FEATURE_NAMES,
        feature_set_label="assessment_scores_only",
        model_version=MODEL_VERSION_ASSESSMENT,
        deployment_status=INTEGRATION_CANDIDATE,
        limitations=ASSESSMENT_LIMITATIONS,
        dataset_size=len(df),
        dataset_path=args.data,
        seed=args.seed,
    )
    primary_metadata_path = args.artifacts_dir / "model_metadata.json"
    primary_metadata_path.write_text(json.dumps(primary_metadata, indent=2))

    # --- EXPERIMENTAL artifact: behavioral, 8-feature ----------------------
    experimental_model_path = args.artifacts_dir / "vark_model_experimental_behavioral.joblib"
    joblib.dump(behavioral["winner_model"], experimental_model_path)
    experimental_metadata = _build_metadata(
        experiment=behavioral,
        feature_names=BEHAVIORAL_FEATURE_NAMES,
        feature_set_label="assessment_scores_plus_simulated_behavioral_engagement",
        model_version=MODEL_VERSION_BEHAVIORAL,
        deployment_status=EXPERIMENTAL,
        limitations=BEHAVIORAL_LIMITATIONS,
        dataset_size=len(df),
        dataset_path=args.data,
        seed=args.seed,
    )
    experimental_metadata_path = args.artifacts_dir / "model_metadata_experimental_behavioral.json"
    experimental_metadata_path.write_text(json.dumps(experimental_metadata, indent=2))

    print(f"\nSaved PRIMARY (integration-candidate) model -> {primary_model_path}")
    print(f"Saved PRIMARY metadata                       -> {primary_metadata_path}")
    print(f"Saved EXPERIMENTAL model                     -> {experimental_model_path}")
    print(f"Saved EXPERIMENTAL metadata                  -> {experimental_metadata_path}")


if __name__ == "__main__":
    main()
