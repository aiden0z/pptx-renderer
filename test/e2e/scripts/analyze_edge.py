#!/usr/bin/env python3
"""
Analyze edge_iou for a case: load PDF/HTML report images, compute Canny edges,
save edge maps and overlay, print inter/union/IoU.

Usage:
  cd test/e2e
  .venv/bin/python scripts/analyze_edge.py oracle-full-shapeid-0161
  .venv/bin/python scripts/analyze_edge.py oracle-full-shapeid-0161 --slide 0 --out-dir reports/edge_analysis
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

E2E_DIR = Path(__file__).resolve().parents[1]
if str(E2E_DIR) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(E2E_DIR))

from oracle.metrics import edge_analysis, EDGE_CANNY_LOW, EDGE_CANNY_HIGH


def main() -> None:
    ap = argparse.ArgumentParser(description="Edge analysis for oracle case")
    ap.add_argument("case", help="Test file stem, e.g. oracle-full-shapeid-0161")
    ap.add_argument("--slide", type=int, default=0, help="Slide index")
    ap.add_argument("--out-dir", type=Path, default=None, help="Output dir (default: reports/edge_analysis/<case>)")
    args = ap.parse_args()

    reports = E2E_DIR / "reports"
    pdf_path = reports / f"{args.case}_slide{args.slide}_pdf.png"
    html_path = reports / f"{args.case}_slide{args.slide}_html.png"
    if not pdf_path.exists():
        raise SystemExit(f"Missing {pdf_path} (run evaluate for this case first)")
    if not html_path.exists():
        raise SystemExit(f"Missing {html_path} (run evaluate for this case first)")

    pdf_img = np.array(Image.open(pdf_path).convert("RGB"))
    html_img = np.array(Image.open(html_path).convert("RGB"))

    out_dir = args.out_dir or (E2E_DIR / "reports" / "edge_analysis" / args.case)
    out_dir.mkdir(parents=True, exist_ok=True)

    result = edge_analysis(pdf_img, html_img, low=EDGE_CANNY_LOW, high=EDGE_CANNY_HIGH)
    e1 = result["e1"]
    e2 = result["e2"]
    h, w = e1.shape

    # Save binary edge maps (white on black)
    cv2.imwrite(str(out_dir / "pdf_edges.png"), (e1.astype(np.uint8)) * 255)
    cv2.imwrite(str(out_dir / "html_edges.png"), (e2.astype(np.uint8)) * 255)

    # Overlay: green = both, red = PDF only, blue = HTML only
    overlay = np.zeros((h, w, 3), dtype=np.uint8)
    overlay[e1 & e2] = [0, 255, 0]
    overlay[e1 & ~e2] = [0, 0, 255]
    overlay[~e1 & e2] = [255, 0, 0]
    cv2.imwrite(str(out_dir / "edge_overlay.png"), cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR))

    # Side-by-side: pdf | html | overlay
    side = np.hstack([
        (e1.astype(np.uint8) * 255).reshape(h, w, 1).repeat(3, axis=2),
        (e2.astype(np.uint8) * 255).reshape(h, w, 1).repeat(3, axis=2),
        overlay,
    ])
    cv2.imwrite(str(out_dir / "edge_sidebyside.png"), cv2.cvtColor(side, cv2.COLOR_RGB2BGR))

    print(f"Case: {args.case} slide {args.slide}")
    print(f"Canny: low={EDGE_CANNY_LOW}, high={EDGE_CANNY_HIGH}")
    print(f"PDF edge pixels:  {result['n1']}")
    print(f"HTML edge pixels: {result['n2']}")
    print(f"Intersection:     {result['inter']}")
    print(f"Union:            {result['union']}")
    print(f"edge_iou:         {result['edge_iou']:.4f} ({result['edge_iou']*100:.1f}%)")
    # Sensitivity: try different Canny thresholds
    for (low, high) in [(40, 80), (60, 120), (80, 160)]:
        r = edge_analysis(pdf_img, html_img, low=low, high=high)
        print(f"  Canny({low},{high}) -> edge_iou={r['edge_iou']:.3f}")
    print(f"Output: {out_dir}")
    print("  pdf_edges.png, html_edges.png, edge_overlay.png (green=both, red=PDF only, blue=HTML only), edge_sidebyside.png")


if __name__ == "__main__":
    main()
