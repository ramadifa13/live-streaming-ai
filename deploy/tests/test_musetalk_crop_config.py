import unittest
from pathlib import Path


class TestMuseTalkCropConfig(unittest.TestCase):
    def test_inference_landmark_defaults_are_consistent(self):
        text = Path("deploy/inference.py").read_text(encoding="utf-8")
        self.assertIn('"MUSETALK_BBOX_SHIFT_X", "0"', text)
        self.assertNotIn('"MUSETALK_BBOX_SHIFT_X", "-10"', text)

    def test_live_worker_uses_visual_params_for_sync(self):
        text = Path("deploy/live_worker.py").read_text(encoding="utf-8")
        self.assertIn("musetalk_visual_params()", text)
        self.assertIn("bbox_shift_x", text)

    def test_mouth_motion_is_soft_and_natural(self):
        text = Path("deploy/ai_worker.py").read_text(encoding="utf-8")
        self.assertIn("MOUTH_STRENGTH = 1.0", text)
        self.assertIn("MOUTH_TEMPORAL = 0.0", text)
        self.assertIn("MOUTH_MAX_DELTA = 0.0", text)
        self.assertIn("MOUTH_MAX_STALE_FRAMES = 0", text)

    def test_musetalk_facebox_stabilizes_on_entry(self):
        text = Path("deploy/ai_worker.py").read_text(encoding="utf-8")
        self.assertIn("FACE_JITTER_MAX_DELTA = 2", text)
        self.assertIn("full-prerender contract violated", text)

    def test_visual_cache_invalidates_on_param_change(self):
        text = Path("deploy/inference.py").read_text(encoding="utf-8")
        self.assertIn("bbox_smooth_window", text)
        self.assertIn("cache_signature", text)
        self.assertIn('"MUSETALK_BBOX_SHIFT_X", "0"', text)
        self.assertIn('"MUSETALK_UPPER_BOUNDARY_RATIO", "0.32"', text)

    def test_continuous_pipeline_has_no_runtime_transition(self):
        text = Path("deploy/ai_worker.py").read_text(encoding="utf-8")
        self.assertIn('CONTINUOUS_CLIP_NAME = "continuous"', text)
        self.assertIn("target=continuous_broadcaster_loop", text)


if __name__ == "__main__":
    unittest.main()
