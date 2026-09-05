# AceTutor VARK ML prototype (Phase A2 / A2.1)

A small, self-contained, reproducible Python workspace for training and
comparing **Random Forest** and **Gradient Boosting** VARK classifiers on a
synthetic dataset. This is a **training/evaluation pipeline only**.

> **This workspace is NOT connected to AceTutor.** It does not read or write
> Supabase, does not run inside the app, and nothing it produces is used by
> the live product yet. `src/lib/vark.ts` and `vark_profiles.prediction_source`
> stay exactly as Phase A1 left them (`'assessment'`, deterministic scoring).
> Connecting a real predictor to the live app is **Phase A3** — not this one.

## Two experiments, not one (Phase A2.1)

Phase A2 originally trained one 8-feature model (four VARK scores + four
*simulated* behavioural engagement signals). That mixed something AceTutor
genuinely has today with something it does not collect anywhere yet — a live
classifier must never require fabricated/default behavioural inputs. A2.1
splits this into two clearly separated, independently trained experiments:

| | **1. ASSESSMENT** | **2. BEHAVIORAL** |
|---|---|---|
| Features | 4 — the VARK scores only | 8 — VARK scores + 4 simulated engagement signals |
| Status | ✅ **Integration candidate** | 🧪 **Experimental — NOT deployable** |
| Why | All four inputs already exist, 1:1, in `vark_profiles` today | AceTutor has no real source for any of the 4 engagement features |
| Artifact | `artifacts/vark_model.joblib` (primary) | `artifacts/vark_model_experimental_behavioral.joblib` |
| Metadata | `artifacts/model_metadata.json` | `artifacts/model_metadata_experimental_behavioral.json` |
| `predict.py` | default | `--experimental` flag |

> **"Integration candidate" is not "deployable."** It is a statement about the
> **feature contract only**: all four assessment scores already exist in
> `vark_profiles` today, so this feature set could be wired into AceTutor
> without fabricating or defaulting any input. It does **NOT** mean the model
> itself has been validated for real-world deployment. Its metrics below
> (macro F1 ≈ 0.39 on held-out synthetic data) come from a synthetic dataset,
> not real students, and **do not establish real-student accuracy**.
> Meaningful validation — or retraining — will require live behavioural/
> outcome data collected from real students later (expected from Phase A6
> onward), not just wiring up the feature contract.

**Only the 4-feature ASSESSMENT model's feature contract is eligible for
Phase A3.** The 8-feature BEHAVIORAL model is kept purely to keep exploring
whether behavioural signals are worth collecting later — see "Why two
experiments" below. Both read the *same* underlying synthetic dataset (just a
different column subset of it), trained and evaluated with the identical
methodology, so their numbers are directly comparable.

## Purpose

Phase A1 added the VARK assessment and the `vark_profiles` table
(`prediction_source: 'assessment'`). This phase builds and validates the
*pipeline* a later phase could use to produce a `prediction_source: 'ml_model'`
prediction instead — training, evaluation, model selection, and a prediction
interface with an explicit feature contract. It does **not** train on real
AceTutor students (there isn't enough labelled data yet — see "Limitations")
and does **not** change anything the live app reads.

## Setup

```bash
cd ml/vark
pip install -r requirements.txt
```

Requires Python 3.9+ (developed against 3.11). No AceTutor/Node tooling is
required for anything in this directory, and nothing in the main app requires
Python.

## 1. Generate the dataset

```bash
python generate_dataset.py
```

Writes `data/vark_synthetic.csv` (deterministic given `--seed`, default `42`
— rerunning with the same seed reproduces byte-identical output). One file
feeds *both* experiments. Prints the class balance and a **naive
argmax-of-scores baseline accuracy** — a sanity check confirming the label is
*not* a trivial function of the four VARK scores alone (see "Dataset
generation" below). Options: `--n-samples`, `--seed`, `--output`.

## 2. Train + evaluate (both experiments)

```bash
python train.py
```

Reads `data/vark_synthetic.csv` and, for **each** experiment (ASSESSMENT then
BEHAVIORAL): trains both models on a stratified 80/20 split, runs a
stratified 5-fold cross-validation on the training split, prints a full
comparison, picks a winner by macro F1 (accuracy as tie-break), and refits
that winner on the full dataset. Saves 4 files total — see the table above.
Each `model_metadata*.json` records `deployment_status` (`"integration_candidate"`
or `"experimental_not_deployable"`), `feature_set`,
`feature_names`, `dataset_type: "synthetic"`, `limitations`, and the full
metrics for **both** algorithms in that experiment (not just its winner), so
the losing model's numbers are never lost.

Rerun any time after regenerating the dataset (or with `--seed`/`--data` to
try variations).

## 3. Predict on one record

**Integration-candidate model (default) — exactly the four assessment scores:**

```bash
python predict.py --features '{"visual_score": 11, "auditory_score": 4, "read_write_score": 6, "kinesthetic_score": 5}'
```

Passing anything else (an engagement feature, a typo, a missing score) is
rejected with a clear error naming exactly which features are required —
never silently ignored or defaulted.

**Experimental model (8 features) — for local exploration only:**

```bash
python predict.py --experimental --features '{"visual_score": 11, "auditory_score": 4, "read_write_score": 6, "kinesthetic_score": 5, "video_engagement": 0.8, "audio_engagement": 0.2, "text_engagement": 0.4, "practice_engagement": 0.3}'
```

Both accept `--input path/to/record.json` or piped stdin instead of
`--features`. Output (stdout) is one structured JSON object:

```json
{
  "predicted_category": "visual",
  "confidence": 0.39,
  "class_probabilities": { "visual": 0.39, "auditory": 0.16, "read_write": 0.19, "kinesthetic": 0.26 },
  "model_version": "vark-assessment-a2.1-v1"
}
```

`predict_from_features(record, experimental=False)` in `predict.py` is also
directly importable (see "Reuse in Phase A3" below). It refuses to run if the
saved model's feature list no longer matches `schema.py` — a mismatch fails
loudly instead of silently mis-ordering the input vector.

## Feature schema

Defined once, in `schema.py`, and imported by every other script here so the
dataset / models / predictor can never drift apart. Exact order matters —
it's the order each model is trained on and the order `predict.py` builds its
input vector in.

| # | Feature | Range | Used by | Source |
|---|---|---|---|---|
| 1 | `visual_score` | 0–14 | both | Same scale as AceTutor's own 14-question assessment (`src/lib/vark.ts`) — one point per question that dimension was selected on |
| 2 | `auditory_score` | 0–14 | both | ″ |
| 3 | `read_write_score` | 0–14 | both | ″ |
| 4 | `kinesthetic_score` | 0–14 | both | ″ |
| 5 | `video_engagement` | 0–1 | BEHAVIORAL only | Simulated — proportion of video content engaged with |
| 6 | `audio_engagement` | 0–1 | BEHAVIORAL only | Simulated — audio/narration content engagement |
| 7 | `text_engagement` | 0–1 | BEHAVIORAL only | Simulated — reading/written content engagement |
| 8 | `practice_engagement` | 0–1 | BEHAVIORAL only | Simulated — hands-on practice/activity engagement |

`schema.ASSESSMENT_FEATURE_NAMES` = features 1–4 (the integration-candidate set).
`schema.BEHAVIORAL_FEATURE_NAMES` = all 8 (the experimental set).

Target: `vark_category` ∈ `{visual, auditory, read_write, kinesthetic}`
(`schema.CLASS_LABELS` — same spelling as `VarkCategory` in `src/lib/vark.ts`).

## Dataset generation approach

`generate_dataset.py` produces a **synthetic** dataset, deterministic given a
seed (default 2,000 rows, ~500 per class — balanced as evenly as integer
division allows). One file feeds both experiments.

**The label is intentionally not derivable by simply taking
`argmax(visual_score, auditory_score, read_write_score, kinesthetic_score)`.**
If it were, the "classification problem" would just be a rediscovery of a
rule already encoded in the inputs, and any classifier (including a
zero-training `argmax`) would trivially score ~100% — that would validate
nothing about the pipeline. Instead:

1. A true `vark_category` is drawn first, balanced across the 4 classes.
2. The four VARK scores get a boost on one dimension — but for **30%** of
   rows (`SCORE_CONFOUND_FRACTION`) that boost is deliberately redirected to
   a random *different* dimension, not the true label. Combined with wide,
   overlapping score distributions (`Normal` with heavy overlap), argmax on
   the scores alone recovers the true label only part of the time.
3. The four engagement features are generated the same way, independently
   confounded at their own, lower rate (**20%**) — a second, only
   partially-correlated signal that is NOT simply derivable from the scores.

`generate_dataset.py` prints the resulting **naive argmax-of-scores baseline
accuracy** every run specifically so this is never a silent assumption.

## Why the two experiments score so differently

On the committed run, the 4-feature ASSESSMENT model lands close to (and on
this split, even slightly below) the naive argmax-of-scores baseline, while
the 8-feature BEHAVIORAL model scores substantially higher. This is expected,
not a bug: the four VARK scores alone were deliberately generated with heavy
overlap/noise (see above), so there is a real ceiling on how much signal
*any* model — however sophisticated — can extract from them alone. The
engagement features are independently confounded, so they add genuinely new
information a classifier can combine with the scores. In other words: **the
current best integration-candidate signal (assessment scores only) is
honestly weaker** than what a model *could* do with real behavioural data —
which is exactly the motivation for eventually collecting real behavioural
signals (expected from **Phase A6**) and retraining before reconsidering the
feature set, not a reason to ship the stronger experimental model with
fabricated inputs today.

## Training / evaluation methodology

- Stratified 80/20 train/test split, fixed seed, per experiment.
- Held-out **test set** → accuracy, macro precision, macro recall, macro F1,
  confusion matrix (labelled, not sklearn's default alphabetical order — the
  row/column order is always `schema.CLASS_LABELS`).
- Stratified **5-fold cross-validation** on the training split (accuracy and
  macro F1, mean ± std) — a stability check, kept separate from the test-set
  numbers above.
- Both `RandomForestClassifier` and `GradientBoostingClassifier` use a fixed
  `random_state` for reproducibility.

## Model selection

Within each experiment, the winner is chosen by **test-set macro F1,
primarily** (fairer than accuracy alone across 4 classes), with **test-set
accuracy as the secondary tie-breaker**. The losing model's full metrics are
still saved in that experiment's `model_metadata*.json.models_compared` —
nothing is discarded. The winner is then refit on the *full* dataset (train +
test) before being saved with `joblib`; the *reported* metrics still come
from the held-out split, not this refit.

## Limitations — read before trusting any number here

- **This is not real AceTutor student data.** AceTutor does not yet have
  enough labelled VARK outcomes to train on. Every number this pipeline
  prints (accuracy, F1, confusion matrix, cross-validation), for **either**
  experiment, describes how well a model fits a **simulated** pattern — it is
  **not evidence of real-world VARK classification accuracy** for actual
  students.
- **The 4-feature ASSESSMENT model's "integration candidate" status is about
  its feature contract, not its accuracy.** All four inputs already exist in
  `vark_profiles`, so it *could* be wired in without fabricating anything —
  but its held-out macro F1 (~0.39, against a synthetic dataset) does **not**
  establish real-student accuracy. It must not be treated as validated for
  production use. Meaningful validation, or a meaningful retrain, requires
  live behavioural/outcome data collected from real students — not currently
  available, expected to start becoming available from **Phase A6** onward.
- The 8-feature BEHAVIORAL model's stronger numbers are *not* a reason to
  prefer it for deployment: its four engagement features are placeholders
  AceTutor does not currently compute or store anywhere. A real predictor
  would need a genuine data source for them (or would need to be retrained
  without them) before it could responsibly be connected to the live app.
  **Phase A6** is expected to provide genuine behavioural signals that a
  future retrain could use.
- No claim is made that either feature set or either algorithm is the right
  final choice for production VARK classification — this phase validates the
  *pipeline mechanics* (generate, train, evaluate, select, persist, predict),
  not the *science*.
- No EdNet, ASSISTments, or any other external dataset is used or referenced
  anywhere in this workspace — every row here is generated by
  `generate_dataset.py` from a documented synthetic process.

## Reuse in Phase A3 (not implemented here)

`schema.py` is the explicit, shared feature/label contract a later phase
would import (or reimplement, e.g. in TypeScript) to connect a real predictor
to `vark_profiles` — using `ASSESSMENT_FEATURE_NAMES` and the primary
`vark_model.joblib` / `model_metadata.json`, never the experimental pair.
`predict.py`'s `predict_from_features()` shows the expected interface — a
feature dict in, a structured result dict out — that Phase A3 would need to
reproduce (e.g. by shelling out to this script, or via a small internal
service). None of that wiring exists yet; this phase deliberately stops at a
local CLI.

## Files

```
ml/vark/
  requirements.txt     scikit-learn / pandas / numpy / joblib
  schema.py            shared feature names (both experiments), class labels, target column
  generate_dataset.py  synthetic dataset generator (feeds both experiments)
  train.py             trains + evaluates BOTH experiments, saves both winners
  predict.py           loads a saved model (integration-candidate by default, --experimental for the other), predicts on one record
  README.md            this file
  data/                generated dataset (gitignored; regenerate anytime)
  artifacts/           trained models + metrics for both experiments (gitignored; regenerate anytime)
```
