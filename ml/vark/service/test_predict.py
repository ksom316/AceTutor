"""
Plain unittest (no new test dependency) covering api/predict.py's inference
logic against the ACTUAL committed model artifact in model/ - not a mock.
Run from this directory: `python test_predict.py`
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "api"))

import predict as predict_module  # noqa: E402

VALID_RECORD = {
    "visual_score": 11,
    "auditory_score": 4,
    "read_write_score": 6,
    "kinesthetic_score": 5,
}

ALL_CLASSES = {"visual", "auditory", "read_write", "kinesthetic"}


class TestValidateScores(unittest.TestCase):
    def test_valid_record_passes(self):
        values = predict_module.validate_scores(VALID_RECORD)
        self.assertEqual(values, [11.0, 4.0, 6.0, 5.0])

    def test_missing_feature_rejected(self):
        bad = dict(VALID_RECORD)
        del bad["kinesthetic_score"]
        with self.assertRaises(predict_module.InvalidFeatureInput):
            predict_module.validate_scores(bad)

    def test_extra_feature_rejected(self):
        bad = dict(VALID_RECORD, video_engagement=0.5)
        with self.assertRaises(predict_module.InvalidFeatureInput):
            predict_module.validate_scores(bad)

    def test_non_numeric_rejected(self):
        bad = dict(VALID_RECORD, visual_score="a lot")
        with self.assertRaises(predict_module.InvalidFeatureInput):
            predict_module.validate_scores(bad)

    def test_out_of_range_rejected(self):
        bad = dict(VALID_RECORD, visual_score=15)
        with self.assertRaises(predict_module.InvalidFeatureInput):
            predict_module.validate_scores(bad)

    def test_negative_rejected(self):
        bad = dict(VALID_RECORD, visual_score=-1)
        with self.assertRaises(predict_module.InvalidFeatureInput):
            predict_module.validate_scores(bad)

    def test_non_dict_rejected(self):
        with self.assertRaises(predict_module.InvalidFeatureInput):
            predict_module.validate_scores([1, 2, 3, 4])  # type: ignore[arg-type]


class TestPredict(unittest.TestCase):
    def test_valid_prediction_shape(self):
        result = predict_module.predict(VALID_RECORD)
        self.assertIn(result["predicted_category"], ALL_CLASSES)
        self.assertTrue(0.0 <= result["confidence"] <= 1.0)
        self.assertEqual(set(result["class_probabilities"].keys()), ALL_CLASSES)
        self.assertAlmostEqual(sum(result["class_probabilities"].values()), 1.0, places=4)
        self.assertEqual(result["model_version"], "vark-assessment-a2.1-v1")
        self.assertEqual(result["model_type"], "GradientBoostingClassifier")

    def test_all_four_classes_reachable(self):
        # The model is trained on deliberately noisy synthetic data (macro F1
        # ~0.39 - see ml/vark/README.md), so a single one-hot input is NOT
        # guaranteed to map to its "obvious" label; this checks the model
        # itself isn't degenerate (collapsed to predicting fewer than 4
        # classes) across a wider, varied sample - not that any one specific
        # input maps to a specific output.
        import random

        rng = random.Random(0)
        predicted: set[str] = set()
        for _ in range(60):
            values = [rng.randint(0, 14) for _ in range(4)]
            record = dict(zip(predict_module.FEATURE_NAMES, values))
            predicted.add(predict_module.predict(record)["predicted_category"])
        self.assertEqual(predicted, ALL_CLASSES)

    def test_malformed_input_raises_before_model_call(self):
        with self.assertRaises(predict_module.InvalidFeatureInput):
            predict_module.predict({"visual_score": 11})


if __name__ == "__main__":
    unittest.main()
