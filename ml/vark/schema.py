"""
Shared feature/label contract for the AceTutor VARK ML prototype.

Every other script in this workspace (generate_dataset.py, train.py,
predict.py) imports its feature/label names from HERE instead of
re-declaring them, so the dataset, the trained models, and the prediction CLI
can never silently drift out of sync with each other.

Phase A2.1 split what was one experiment into TWO, because the original
8-feature set mixed something AceTutor genuinely has (the four VARK
assessment scores) with something it does not yet have anywhere
(behavioural engagement signals):

  * ASSESSMENT_FEATURE_NAMES (4) — the INTEGRATION CANDIDATE feature set. All
    four inputs already exist today, 1:1, as vark_profiles.{visual,auditory,
    read_write,kinesthetic}_score, so this feature contract could be wired
    into AceTutor without fabricating any input. That is a statement about
    the FEATURE CONTRACT, not the model: synthetic-data metrics do not
    validate real-world accuracy — see train.py / README.md for the exact
    wording this status carries.
  * BEHAVIORAL_FEATURE_NAMES (8) — assessment scores + four simulated
    engagement signals. EXPERIMENTAL ONLY: AceTutor does not compute or
    store video/audio/text/practice engagement anywhere yet, so a model
    trained on this set cannot be connected to the live app. Kept only to
    keep exploring whether behavioural signals are worth collecting later
    (Phase A6 is expected to provide a genuine source for them).

Both experiments share the SAME underlying synthetic generation process
(generate_dataset.py) and dataset file — they just use different column
subsets of it, so their results stay directly comparable.
"""

from __future__ import annotations

# The four VARK score features are on the same 0-14 scale as AceTutor's own
# 14-question assessment (src/lib/vark.ts) — one point per question a
# dimension was selected on. These map 1:1 onto vark_profiles' four score
# columns and are the ONLY features the integration-candidate model uses.
ASSESSMENT_FEATURE_NAMES: list[str] = [
    "visual_score",
    "auditory_score",
    "read_write_score",
    "kinesthetic_score",
]

# Simulated, normalised 0-1 behavioural signals — see generate_dataset.py's
# docstring. No live AceTutor data source exists for any of these yet.
ENGAGEMENT_FEATURE_NAMES: list[str] = [
    "video_engagement",
    "audio_engagement",
    "text_engagement",
    "practice_engagement",
]

# The experimental, NOT-deployable feature set (unchanged terminology — the
# 8-feature model stays "experimental_not_deployable"; order matters here:
# this is the exact column order that experiment's model is trained on).
BEHAVIORAL_FEATURE_NAMES: list[str] = ASSESSMENT_FEATURE_NAMES + ENGAGEMENT_FEATURE_NAMES

# All columns generate_dataset.py writes to the dataset CSV, feature columns
# plus the label. Both experiments read the same file and select their own
# feature subset from it.
DATASET_COLUMNS: list[str] = BEHAVIORAL_FEATURE_NAMES + ["vark_category"]

# Matches VarkCategory in src/lib/vark.ts exactly (same 4 values, same
# spelling) so a later phase can round-trip this without a translation table.
CLASS_LABELS: list[str] = ["visual", "auditory", "read_write", "kinesthetic"]

TARGET_COLUMN = "vark_category"

# Bumped only when a feature contract itself changes (new/removed/renamed
# feature) — NOT on every retrain. predict.py refuses to run against a model
# whose saved feature list no longer matches this file.
SCHEMA_VERSION = "2.0.0"

# Status values used in model_metadata*.json — see train.py.
#
# INTEGRATION_CANDIDATE means: the feature contract can be integrated into
# AceTutor without fabricated inputs (all its features already exist in
# vark_profiles). It explicitly does NOT mean the model has been validated
# for real-world deployment — its evaluation is against synthetic data only.
# Deliberately not called "deployable" anywhere, to avoid implying production
# validation that has not happened.
INTEGRATION_CANDIDATE = "integration_candidate"
EXPERIMENTAL = "experimental_not_deployable"
