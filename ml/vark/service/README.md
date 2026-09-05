# VARK ML inference service (Phase A3)

A tiny, standalone Vercel project — **not** part of the main AceTutor app's own Vercel project —
that serves the actual trained VARK model over HTTP. One endpoint, one job: load
`model/vark_model.joblib` and run real inference. Nothing here is a prototype or a mock; it is
the same trained model `ml/vark/train.py` produces, described in `../README.md`.

## Why a separate Vercel project

The main AceTutor app deploys to its own Vercel project (`ace-tutor-fucu`) via TanStack Start's
zero-config Nitro build, which owns the whole Build Output API surface for that project. There is
no documented/verified way to also drop ad-hoc Python `/api/*.py` files into that same project
without risking the existing zero-config detection — and Node.js (what that project's own
functions run on) has no bundled Python interpreter regardless. So this is its own project,
pointed at the **same GitHub repo** with Root Directory set to `ml/vark/service`, deployed
independently. It requires zero changes to the main app's build/config/domain.

## Deploying this project (first time)

1. In Vercel, "Add New Project" → import `ksom316/AceTutor` again (a second project from the
   same repo is normal and supported).
2. Set **Root Directory** to `ml/vark/service`.
3. Framework preset: leave as detected (Python, via `requirements.txt`) or "Other" — either way
   `api/predict.py`'s `handler` class is picked up as the file-based Python function contract.
4. Set the environment variable `VARK_INFERENCE_SECRET` to a long random string (e.g.
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) — this must
   match the same value set in the main app's project as `VARK_INFERENCE_SECRET`.
5. Deploy. Note the resulting URL (e.g. `https://<this-project>.vercel.app`) — set that as
   `VARK_INFERENCE_URL` in the main app's Vercel project (pointing at `/api/predict`, e.g.
   `https://<this-project>.vercel.app/api/predict`).

## API

`POST /api/predict`

Headers: `X-Inference-Secret: <VARK_INFERENCE_SECRET>` (required — 401 without it or on
mismatch), `Content-Type: application/json`.

Body — exactly these 4 keys, each an integer 0–14 (extra/missing/out-of-range/non-numeric is
rejected with 400):

```json
{ "visual_score": 11, "auditory_score": 4, "read_write_score": 6, "kinesthetic_score": 5 }
```

Response (200):

```json
{
  "predicted_category": "visual",
  "confidence": 0.62,
  "class_probabilities": { "visual": 0.62, "auditory": 0.1, "read_write": 0.12, "kinesthetic": 0.16 },
  "model_version": "vark-assessment-a2.1-v1",
  "model_type": "GradientBoostingClassifier"
}
```

curl example:

```bash
curl -X POST https://<this-project>.vercel.app/api/predict \
  -H "X-Inference-Secret: $VARK_INFERENCE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"visual_score": 11, "auditory_score": 4, "read_write_score": 6, "kinesthetic_score": 5}'
```

## Refreshing the deployed model

`model/vark_model.joblib` and `model/model_metadata.json` here are a **deliberate, committed
deploy copy** — not the gitignored `ml/vark/artifacts/` (that stays dev-only output). Whenever
`ml/vark/train.py` is re-run and produces a new primary model:

1. `cp ../artifacts/vark_model.joblib model/vark_model.joblib`
2. `cp ../artifacts/model_metadata.json model/model_metadata.json`
3. If the scikit-learn/joblib/numpy versions used to train changed, update `requirements.txt`
   here to match exactly (pickle compatibility across versions is not guaranteed).
4. Commit and redeploy this Vercel project.

Only the primary (4-feature, integration-candidate) model ever lives in this folder. The
8-feature experimental/behavioral model is never copied here and this service has no code path
that could load or serve it.

## Local test

```bash
pip install -r requirements.txt
python test_predict.py
```

Exercises `api/predict.py`'s prediction logic directly against the committed model artifact —
valid predictions for all 4 classes, and rejection of malformed/missing/extra/out-of-range input.
