import numpy as np

from oracle.metrics import aggregate_quality_gate, compute_visual_metrics


def test_visual_metrics_identical_images_are_high():
    img = np.full((120, 180, 3), 255, dtype=np.uint8)
    metrics = compute_visual_metrics(img, img)
    assert metrics["ssim"] > 0.99


def test_visual_metrics_detect_large_difference():
    a = np.zeros((120, 180, 3), dtype=np.uint8)
    b = np.zeros((120, 180, 3), dtype=np.uint8)
    a[20:70, 20:70] = 255
    b[70:110, 110:170] = 255
    metrics = compute_visual_metrics(a, b)
    assert metrics["ssim"] < 0.75


def test_quality_gate_uses_structural_text_and_visual_signals():
    result = aggregate_quality_gate(
        {
            "text_coverage": 0.98,
            "shape_recall": 0.95,
            "ssim": 0.96,
        }
    )
    assert result["passed"] is True

    failed = aggregate_quality_gate(
        {
            "text_coverage": 0.85,
            "shape_recall": 0.95,
            "ssim": 0.96,
        }
    )
    assert failed["passed"] is False
    assert any("text_coverage" in reason for reason in failed["reasons"])
