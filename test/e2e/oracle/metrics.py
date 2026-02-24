from __future__ import annotations

from typing import Any

import cv2
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
from skimage.metrics import structural_similarity as ssim


def _resize_to_common(img1: np.ndarray, img2: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    h = min(img1.shape[0], img2.shape[0])
    w = min(img1.shape[1], img2.shape[1])
    if h < 2 or w < 2:
        raise ValueError("images too small for comparison")

    a = np.array(Image.fromarray(img1).resize((w, h), Image.LANCZOS))
    b = np.array(Image.fromarray(img2).resize((w, h), Image.LANCZOS))
    return a, b


def _resize_to_common_max(img1: np.ndarray, img2: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Resize both images to the *larger* dimensions (upscale the smaller one).

    Unlike _resize_to_common (which downscales to min), this preserves thin
    strokes in the higher-resolution image and avoids LANCZOS blur artifacts
    that destroy 1-2px features during downscaling.
    """
    h = max(img1.shape[0], img2.shape[0])
    w = max(img1.shape[1], img2.shape[1])
    if h < 2 or w < 2:
        raise ValueError("images too small for comparison")

    a = np.array(Image.fromarray(img1).resize((w, h), Image.LANCZOS))
    b = np.array(Image.fromarray(img2).resize((w, h), Image.LANCZOS))
    return a, b


# Canny thresholds used for edge_iou (shared by compute_edge_iou and edge_analysis).
EDGE_CANNY_LOW, EDGE_CANNY_HIGH = 60, 120


def compute_edge_iou(img1: np.ndarray, img2: np.ndarray) -> float:
    a, b = _resize_to_common(img1, img2)
    g1 = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    g2 = cv2.cvtColor(b, cv2.COLOR_RGB2GRAY)

    e1 = cv2.Canny(g1, EDGE_CANNY_LOW, EDGE_CANNY_HIGH) > 0
    e2 = cv2.Canny(g2, EDGE_CANNY_LOW, EDGE_CANNY_HIGH) > 0

    union = np.logical_or(e1, e2).sum()
    if union == 0:
        return 1.0

    inter = np.logical_and(e1, e2).sum()
    return float(inter / union)


def edge_analysis(
    img1: np.ndarray,
    img2: np.ndarray,
    low: int = EDGE_CANNY_LOW,
    high: int = EDGE_CANNY_HIGH,
) -> dict[str, Any]:
    """Compute edge maps and IoU for two images. For diagnostics."""
    a, b = _resize_to_common(img1, img2)
    g1 = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    g2 = cv2.cvtColor(b, cv2.COLOR_RGB2GRAY)
    e1 = cv2.Canny(g1, low, high) > 0
    e2 = cv2.Canny(g2, low, high) > 0
    inter = int(np.logical_and(e1, e2).sum())
    union = int(np.logical_or(e1, e2).sum())
    iou = float(inter / union) if union > 0 else 1.0
    return {
        "e1": e1,
        "e2": e2,
        "inter": inter,
        "union": union,
        "edge_iou": iou,
        "n1": int(e1.sum()),
        "n2": int(e2.sum()),
    }


def compute_color_histogram_correlation(img1: np.ndarray, img2: np.ndarray) -> float:
    """Compare color distributions using histogram correlation in HSV space.

    Computes per-channel histograms (H, S, V) and returns the average
    correlation across channels.  Values range from -1 (inverse) to 1
    (identical distribution); typical passing score is ≥ 0.85.

    Only foreground pixels (gray < 245) are included so that large white
    backgrounds don't dominate the comparison.
    """
    a, b = _resize_to_common_max(img1, img2)
    hsv1 = cv2.cvtColor(a, cv2.COLOR_RGB2HSV)
    hsv2 = cv2.cvtColor(b, cv2.COLOR_RGB2HSV)

    # Mask: only compare foreground (non-white) pixels
    mask1 = (cv2.cvtColor(a, cv2.COLOR_RGB2GRAY) < 245).astype(np.uint8)
    mask2 = (cv2.cvtColor(b, cv2.COLOR_RGB2GRAY) < 245).astype(np.uint8)

    # If either image has no foreground, return 1.0 (both blank → match)
    fg1_count = int(mask1.sum())
    fg2_count = int(mask2.sum())
    if fg1_count == 0 and fg2_count == 0:
        return 1.0
    if fg1_count == 0 or fg2_count == 0:
        return 0.0

    # For sparse foreground (thin strokes, outlines), histograms are unreliable
    # because anti-aliasing differences dominate.  If both images have < 1.5%
    # foreground coverage, skip the histogram check and return 1.0.
    # 0.5% was too tight — SmartArt "lined list" and similar layouts have
    # ~0.5-0.9% coverage (just thin separator lines) and still trigger
    # false-positive histogram mismatches from anti-aliasing noise.
    total_pixels = mask1.shape[0] * mask1.shape[1]
    min_fg = min(fg1_count, fg2_count)
    if min_fg < total_pixels * 0.015:
        return 1.0

    correlations = []
    # Coarse bins for robustness: fine-grained bins (180/256/256) produce
    # near-zero correlation for images with a few dominant colors because
    # anti-aliasing noise in mostly-empty bins dominates the statistic.
    # 30 H bins (6° each), 32 S/V bins (8 units each) are sufficient to
    # catch genuine color mismatches while ignoring sub-pixel edge noise.
    bins = [30, 32, 32]
    ranges = [(0, 180), (0, 256), (0, 256)]
    for ch, (nbins, (lo, hi)) in enumerate(zip(bins, ranges)):
        h1 = cv2.calcHist([hsv1], [ch], mask1, [nbins], [lo, hi])
        h2 = cv2.calcHist([hsv2], [ch], mask2, [nbins], [lo, hi])
        cv2.normalize(h1, h1)
        cv2.normalize(h2, h2)
        corr = cv2.compareHist(h1, h2, cv2.HISTCMP_CORREL)
        correlations.append(float(corr))

    return sum(correlations) / len(correlations)


def compute_visual_metrics(img1: np.ndarray, img2: np.ndarray) -> dict[str, float]:
    a, b = _resize_to_common(img1, img2)
    h, w = a.shape[0], a.shape[1]
    win_size = min(7, h, w)
    if win_size % 2 == 0:
        win_size -= 1
    if win_size < 3:
        win_size = 3

    score_ssim = float(ssim(a, b, channel_axis=2, win_size=win_size))
    score_edge = compute_edge_iou(a, b)
    mae = float(np.mean(np.abs(a.astype(np.float32) - b.astype(np.float32))) / 255.0)
    color_hist_corr = compute_color_histogram_correlation(img1, img2)

    return {
        "ssim": score_ssim,
        "edge_iou": score_edge,
        "mae": mae,
        "color_hist_corr": color_hist_corr,
    }


def _foreground_mask(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    # Treat near-white as background (PPT/PDF mostly white canvas).
    return gray < 245


def _chamfer_distance(mask1: np.ndarray, mask2: np.ndarray) -> float:
    """Symmetric Chamfer Distance: average nearest-neighbour pixel distance.

    For each foreground pixel in mask1, find the nearest foreground pixel in
    mask2 (and vice-versa), then average.  Returns distance in pixels.
    If either mask is empty, returns NaN.
    """
    pts1 = np.argwhere(mask1)  # (N, 2) — [row, col]
    pts2 = np.argwhere(mask2)
    if len(pts1) == 0 or len(pts2) == 0:
        return float("nan")

    tree2 = cKDTree(pts2)
    tree1 = cKDTree(pts1)
    d1to2, _ = tree2.query(pts1)  # dist from each pt1 to nearest pt2
    d2to1, _ = tree1.query(pts2)
    return float((d1to2.mean() + d2to1.mean()) / 2.0)


def compute_foreground_shape_metrics(img1: np.ndarray, img2: np.ndarray) -> dict[str, float]:
    a, b = _resize_to_common(img1, img2)
    m1 = _foreground_mask(a)
    m2 = _foreground_mask(b)

    inter = np.logical_and(m1, m2).sum()
    union = np.logical_or(m1, m2).sum()
    fg_iou = float(inter / union) if union > 0 else 1.0

    # Tolerant fg_iou: dilate both masks by 1px before computing IoU.
    # This absorbs anti-aliasing / sub-pixel positional differences that
    # penalise thin-stroke shapes (brackets, braces, arc, lineInv).
    kernel = np.ones((3, 3), np.uint8)
    m1d = cv2.dilate(m1.astype(np.uint8), kernel, iterations=1).astype(bool)
    m2d = cv2.dilate(m2.astype(np.uint8), kernel, iterations=1).astype(bool)
    inter_t = np.logical_and(m1d, m2d).sum()
    union_t = np.logical_or(m1d, m2d).sum()
    fg_iou_tolerant = float(inter_t / union_t) if union_t > 0 else 1.0

    area1 = m1.sum()
    area2 = m2.sum()
    if area1 == 0 and area2 == 0:
        area_ratio = 1.0
    elif max(area1, area2) == 0:
        area_ratio = 0.0
    else:
        area_ratio = float(min(area1, area2) / max(area1, area2))

    h, w = m1.shape
    diag = float((h * h + w * w) ** 0.5)
    if area1 == 0 or area2 == 0:
        centroid_dist = 1.0
    else:
        y1, x1 = np.argwhere(m1).mean(axis=0)
        y2, x2 = np.argwhere(m2).mean(axis=0)
        centroid_dist = float((((y1 - y2) ** 2 + (x1 - x2) ** 2) ** 0.5) / max(diag, 1.0))

    # Chamfer score: 1 - normalised symmetric Chamfer Distance.
    # Normalised by image diagonal so the score is resolution-independent
    # and in [0, 1] (higher = better, like fg_iou).
    raw_chamfer = _chamfer_distance(m1, m2)
    if np.isnan(raw_chamfer):
        chamfer_score = 1.0 if (area1 == 0 and area2 == 0) else 0.0
    else:
        chamfer_score = float(max(1.0 - raw_chamfer / diag, 0.0))

    return {
        "fg_iou": fg_iou,
        "fg_iou_tolerant": fg_iou_tolerant,
        "chamfer_score": chamfer_score,
        "fg_area_ratio": area_ratio,
        "fg_centroid_distance": centroid_dist,
    }


def aggregate_quality_gate(
    metrics: dict[str, float],
    thresholds: dict[str, float] | None = None,
) -> dict[str, Any]:
    req = {
        "text_coverage": 0.90,
        "shape_recall": 0.90,
        "ssim": 0.95,
    }
    if thresholds:
        req.update(thresholds)

    reasons: list[str] = []
    for key, min_value in req.items():
        val = metrics.get(key)
        if val is None:
            reasons.append(f"missing metric: {key}")
            continue
        if val < min_value:
            reasons.append(f"{key} {val:.3f} < {min_value:.3f}")

    return {"passed": len(reasons) == 0, "reasons": reasons, "thresholds": req}
