import numpy as np

from oracle.metrics import compute_foreground_shape_metrics


def test_foreground_metrics_identical_shape():
    a = np.full((200, 300, 3), 255, dtype=np.uint8)
    b = np.full((200, 300, 3), 255, dtype=np.uint8)
    a[60:140, 90:210] = 20
    b[60:140, 90:210] = 20

    m = compute_foreground_shape_metrics(a, b)
    assert m["fg_iou"] > 0.95
    assert m["fg_iou_tolerant"] > 0.95


def test_foreground_metrics_different_shape_position():
    a = np.full((200, 300, 3), 255, dtype=np.uint8)
    b = np.full((200, 300, 3), 255, dtype=np.uint8)
    a[60:140, 60:160] = 20
    b[60:140, 180:280] = 20

    m = compute_foreground_shape_metrics(a, b)
    assert m["fg_iou"] < 0.2
    assert m["fg_iou_tolerant"] < 0.2


def test_tolerant_gte_raw():
    """fg_iou_tolerant should always be >= fg_iou (dilation can only help)."""
    a = np.full((200, 300, 3), 255, dtype=np.uint8)
    b = np.full((200, 300, 3), 255, dtype=np.uint8)
    a[80:120, 100:200] = 30
    b[81:121, 101:201] = 30  # 1px shifted

    m = compute_foreground_shape_metrics(a, b)
    assert m["fg_iou_tolerant"] >= m["fg_iou"]


def test_tolerant_helps_1px_shift():
    """For a 1px shifted wider stroke, tolerant should be significantly higher."""
    a = np.full((200, 300, 3), 255, dtype=np.uint8)
    b = np.full((200, 300, 3), 255, dtype=np.uint8)
    # Wider horizontal stroke (4px tall) — more realistic for rendered shapes
    a[100:104, 50:250] = 30
    b[101:105, 50:250] = 30  # shifted 1px down

    m = compute_foreground_shape_metrics(a, b)
    # Raw IoU: overlap 3 rows / union 5 rows = 0.6
    assert m["fg_iou"] < 0.8
    # Tolerant: dilation expands both to 6px, overlap 5 of 7 = ~0.71
    assert m["fg_iou_tolerant"] > m["fg_iou"]
    # The gap should be meaningful
    assert m["fg_iou_tolerant"] - m["fg_iou"] > 0.05


def test_tolerant_still_low_for_different_shapes():
    """Genuinely different shapes should still fail even with tolerance."""
    a = np.full((200, 300, 3), 255, dtype=np.uint8)
    b = np.full((200, 300, 3), 255, dtype=np.uint8)
    # Circle-ish region vs rectangle in different location
    a[20:80, 20:80] = 30
    b[120:180, 220:280] = 30

    m = compute_foreground_shape_metrics(a, b)
    assert m["fg_iou_tolerant"] < 0.1


def test_both_blank_images():
    """Both blank (no foreground) should return 1.0 for both metrics."""
    a = np.full((200, 300, 3), 255, dtype=np.uint8)
    b = np.full((200, 300, 3), 255, dtype=np.uint8)

    m = compute_foreground_shape_metrics(a, b)
    assert m["fg_iou"] == 1.0
    assert m["fg_iou_tolerant"] == 1.0
