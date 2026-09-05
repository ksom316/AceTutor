"""
Generate a SYNTHETIC prototype dataset for VARK classifier development.

*** THIS DATA IS NOT REAL. *** AceTutor does not yet have enough labelled
student data to train on (Phase A1 only just added the assessment). This
script exists purely to give the training/evaluation pipeline (train.py)
something realistic-shaped to run against during development. Any metrics
reported against this dataset describe how well a model fits SIMULATED
patterns, not real-world VARK classification accuracy — see the README for
the full disclaimer, which train.py's output also repeats.

Label-encoding safeguard (explicitly required — do not "fix" this away):
The generator does NOT assign `vark_category` as argmax(visual_score,
auditory_score, read_write_score, kinesthetic_score). If it did, the
"classification problem" would just be a rediscovery of a rule already
encoded in the four inputs, and any classifier — including a one-line
`np.argmax` with no training at all — would trivially score ~100%. Instead:

  1. A true `vark_category` is drawn first (balanced across the 4 classes).
  2. The four VARK scores get a boost on ONE dimension — but for a
     CONFOUND_FRACTION of rows that boost is deliberately redirected to a
     random *different* dimension, not the true label. Combined with wide,
     overlapping score distributions, this means argmax-of-scores recovers
     the true label only some of the time (the generator prints exactly how
     often, as a baseline sanity check — see main()).
  3. The four behavioural engagement features are generated the same way,
     independently confounded at their own (lower) rate, so they add a
     second, only-partially-correlated signal — informative, not a giveaway.

A model trained on either feature set therefore has a genuine (if imperfect
and synthetic) pattern to learn, rather than a lookup table in disguise. This
one dataset feeds BOTH of train.py's experiments — the integration-candidate
4-feature (assessment-scores-only) model and the experimental 8-feature
(+ simulated behavioural engagement) model — they just read different column
subsets of the same file, so their results stay directly comparable. See
schema.py.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from schema import (
    ASSESSMENT_FEATURE_NAMES,
    CLASS_LABELS,
    ENGAGEMENT_FEATURE_NAMES,
    TARGET_COLUMN,
)

DEFAULT_SEED = 42
DEFAULT_N_SAMPLES = 2000
DEFAULT_OUTPUT = Path(__file__).parent / "data" / "vark_synthetic.csv"

# How often the "boosted" dimension is deliberately NOT the true label.
SCORE_CONFOUND_FRACTION = 0.30
ENGAGEMENT_CONFOUND_FRACTION = 0.20

SCORE_MIN, SCORE_MAX = 0, 14
ENGAGEMENT_MAP = {
    "visual": "video_engagement",
    "auditory": "audio_engagement",
    "read_write": "text_engagement",
    "kinesthetic": "practice_engagement",
}
assert list(ENGAGEMENT_MAP.values()) == ENGAGEMENT_FEATURE_NAMES  # keep schema.py authoritative


def _confounded_targets(rng: np.random.Generator, labels: np.ndarray, fraction: float) -> np.ndarray:
    """For `fraction` of rows, redirect which class gets the "boost" to a
    random OTHER class. Returns an array the same shape as `labels`."""
    target = labels.copy()
    confused = rng.random(len(labels)) < fraction
    for i in np.where(confused)[0]:
        other_classes = [c for c in CLASS_LABELS if c != labels[i]]
        target[i] = rng.choice(other_classes)
    return target


def generate_dataset(n_samples: int = DEFAULT_N_SAMPLES, seed: int = DEFAULT_SEED) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    # Balanced ground-truth labels (as even a split as integer division
    # allows), shuffled deterministically.
    per_class = n_samples // len(CLASS_LABELS)
    labels = np.array(CLASS_LABELS * per_class)
    remainder = n_samples - len(labels)
    if remainder:
        labels = np.concatenate([labels, rng.choice(CLASS_LABELS, size=remainder, replace=False)])
    rng.shuffle(labels)
    n = len(labels)

    # ---- VARK scores (0-14, same scale as src/lib/vark.ts) --------------
    score_boost_target = _confounded_targets(rng, labels, SCORE_CONFOUND_FRACTION)
    scores: dict[str, np.ndarray] = {}
    for dim in CLASS_LABELS:
        is_boosted = score_boost_target == dim
        base = rng.normal(loc=6.4, scale=2.6, size=n)
        base[is_boosted] += rng.normal(loc=2.6, scale=1.3, size=int(is_boosted.sum()))
        scores[dim] = np.clip(np.round(base), SCORE_MIN, SCORE_MAX).astype(int)

    # ---- Behavioural engagement (0-1), independently confounded ----------
    engagement_target = _confounded_targets(rng, labels, ENGAGEMENT_CONFOUND_FRACTION)
    engagement: dict[str, np.ndarray] = {}
    for dim, column in ENGAGEMENT_MAP.items():
        is_target = engagement_target == dim
        alpha = np.where(is_target, 5.0, 2.2)
        beta = np.where(is_target, 2.2, 5.0)
        engagement[column] = np.round(rng.beta(alpha, beta), 3)

    df = pd.DataFrame(
        {
            "visual_score": scores["visual"],
            "auditory_score": scores["auditory"],
            "read_write_score": scores["read_write"],
            "kinesthetic_score": scores["kinesthetic"],
            "video_engagement": engagement["video_engagement"],
            "audio_engagement": engagement["audio_engagement"],
            "text_engagement": engagement["text_engagement"],
            "practice_engagement": engagement["practice_engagement"],
            TARGET_COLUMN: labels,
        }
    )
    return df


def argmax_score_baseline_accuracy(df: pd.DataFrame) -> float:
    """Sanity check, not a model: how often would naively picking the
    highest-scoring VARK dimension alone reproduce the true label? Printed by
    main() so it's plainly visible this is well short of a giveaway — if this
    number is ever suspiciously close to 1.0, the confound fractions above
    need to be revisited."""
    predicted = df[ASSESSMENT_FEATURE_NAMES].to_numpy().argmax(axis=1)
    predicted_labels = np.array(CLASS_LABELS)[predicted]
    return float((predicted_labels == df[TARGET_COLUMN].to_numpy()).mean())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n-samples", type=int, default=DEFAULT_N_SAMPLES)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    df = generate_dataset(n_samples=args.n_samples, seed=args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, index=False)

    baseline = argmax_score_baseline_accuracy(df)
    print(f"Wrote {len(df)} synthetic rows -> {args.output}")
    print(f"Class balance:\n{df[TARGET_COLUMN].value_counts().sort_index().to_string()}")
    print(
        f"\nNaive argmax-of-scores baseline accuracy: {baseline:.3f}\n"
        "(This is a sanity check, not a model. It should be well below 1.0 - "
        "if it's ~1.0, the label is trivially encoded in the four scores and "
        "the confound fractions in this script need to be increased.)"
    )
    print(
        "\nReminder: this dataset is SYNTHETIC and for prototype/development "
        "validation only. It is not evidence of real-world VARK classification "
        "accuracy for actual AceTutor students. See README.md."
    )
    print(f"\nGenerated {datetime.now(timezone.utc).isoformat()} with seed={args.seed}")


if __name__ == "__main__":
    main()
