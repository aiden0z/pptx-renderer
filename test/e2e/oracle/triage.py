from __future__ import annotations

from typing import Iterable


def classify_case_outcome(
    summary: dict[str, float],
    thresholds: dict[str, float],
    *,
    pdf_std_max: float | None = None,
) -> list[str]:
    """Return stable labels explaining why a case failed or looks suspicious."""
    reasons: list[str] = []

    if pdf_std_max is not None and pdf_std_max < 1.0:
        reasons.append("oracle:pdf_probably_blank")

    for key, min_value in thresholds.items():
        value = summary.get(key)
        if value is None:
            reasons.append(f"metric:missing:{key}")
            continue
        if value < min_value:
            reasons.append(f"metric:{key}")

    fg_iou = float(summary.get("fg_iou", 1.0))
    ssim = float(summary.get("ssim", 1.0))

    if fg_iou < 0.12 and ssim < 0.50:
        reasons.append("likely:shape_missing_or_wrong_geometry")
    if fg_iou < 0.15 and ssim >= float(thresholds.get("ssim", 0.70)):
        reasons.append("warn:low_foreground_overlap_check_manually")

    return _uniq(reasons)


def _uniq(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def build_attention_ranking(results: list[dict]) -> list[dict]:
    ranked: list[dict] = []
    for row in results:
        warnings = row.get("warnings") or []
        if not warnings:
            continue
        summary = row.get("summary") or {}
        severity = _attention_severity(summary)
        ranked.append(
            {
                "case": row.get("case"),
                "label": row.get("case_label"),
                "warnings": warnings,
                "severity": round(severity, 4),
            }
        )
    ranked.sort(key=lambda x: x["severity"], reverse=True)
    return ranked


def bucket_failure(failure: dict) -> str:
    """Classify failure records into root-cause buckets for renderer capability triage."""
    if failure.get("error"):
        return "oracle_generation_failure"
    reasons = list(failure.get("reasons", []))
    if reasons and all(r == "metric:ssim" for r in reasons):
        return "fidelity_regression"
    return "unsupported_candidate"


def diagnose_fidelity_gap(case_name: str, summary: dict) -> list[str]:
    """Heuristic hints for likely renderer capability gaps behind SSIM-only failures."""
    hints: list[str] = []
    case_key = str(case_name).lower()
    ssim = float(summary.get("ssim", 1.0))
    fg_iou = float(summary.get("fg_iou", 1.0))

    if fg_iou < 0.12:
        hints.append("possible:smartart_subshape_geometry_mismatch")
    if "picture" in case_key and ssim < 0.56:
        hints.append("possible:smartart_picture_fill_or_mask_mismatch")
    if "hierarchy" in case_key:
        hints.append("possible:smartart_hierarchy_connector_routing_mismatch")

    if not hints:
        hints.append("possible:general_smartart_style_or_effect_mismatch")
    return _uniq(hints)


def _attention_severity(summary: dict) -> float:
    # Higher severity means more likely geometric mismatch.
    ssim = float(summary.get("ssim", 1.0))
    fg_iou = float(summary.get("fg_iou", 1.0))
    color_hist_corr = float(summary.get("color_hist_corr", 1.0))
    return (
        (1.0 - fg_iou) * 0.50
        + (1.0 - ssim) * 0.25
        + (1.0 - color_hist_corr) * 0.25
    )
