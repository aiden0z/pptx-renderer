"""
Layer 1: Structural comparison tests.

Compares ground truth (lxml-extracted from PPTX XML) against
renderer output (serialized JSON via Playwright).
"""

import json
from pathlib import Path

import pytest

import testdata_paths as tdp
from extract_ground_truth import extract_ground_truth
from models import NodeData, PresentationStructure


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def renderer_to_structure(data: dict) -> PresentationStructure:
    """Convert raw JSON dict from export.html to PresentationStructure."""
    from models import (
        CellData,
        Position,
        RowData,
        Size,
        SlideData,
        TextBody,
        TextParagraph,
    )

    slides = []
    for s in data.get("slides", []):
        nodes = []
        for n in s.get("nodes", []):
            node = _dict_to_node(n)
            nodes.append(node)
        slides.append(SlideData(index=s["index"], nodes=nodes))

    return PresentationStructure(
        width=data["width"],
        height=data["height"],
        slide_count=data["slideCount"],
        slides=slides,
    )


def _dict_to_node(n: dict) -> NodeData:
    from models import CellData, Position, RowData, Size, TextBody, TextParagraph

    text_body = None
    if tb := n.get("textBody"):
        paragraphs = [
            TextParagraph(level=p.get("level", 0), text=p.get("text", ""))
            for p in tb.get("paragraphs", [])
        ]
        text_body = TextBody(paragraphs=paragraphs, total_text=tb.get("totalText", ""))

    rows = None
    if r_list := n.get("rows"):
        rows = []
        for r in r_list:
            cells = [
                CellData(
                    text=c.get("text", ""),
                    grid_span=c.get("gridSpan", 1),
                    row_span=c.get("rowSpan", 1),
                )
                for c in r.get("cells", [])
            ]
            rows.append(RowData(height=r.get("height", 0), cells=cells))

    children = None
    if ch := n.get("children"):
        children = [_dict_to_node(c) for c in ch]

    return NodeData(
        id=n.get("id", ""),
        name=n.get("name", ""),
        node_type=n.get("nodeType", ""),
        position=Position(x=n["position"]["x"], y=n["position"]["y"]),
        size=Size(w=n["size"]["w"], h=n["size"]["h"]),
        rotation=n.get("rotation", 0),
        flip_h=n.get("flipH", False),
        flip_v=n.get("flipV", False),
        preset_geometry=n.get("presetGeometry"),
        text_body=text_body,
        columns=n.get("columns"),
        rows=rows,
        table_style_id=n.get("tableStyleId"),
        children=children,
    )


def _collect_all_nodes(nodes: list[NodeData]) -> list[NodeData]:
    """Flatten nodes including group children."""
    result = []
    for node in nodes:
        result.append(node)
        if node.children:
            result.extend(_collect_all_nodes(node.children))
    return result


def _extract_words(structure: PresentationStructure, slide_idx: int) -> set[str]:
    """Extract unique words from all text in a slide."""
    words = set()
    if slide_idx >= len(structure.slides):
        return words
    slide = structure.slides[slide_idx]
    all_nodes = _collect_all_nodes(slide.nodes)
    for node in all_nodes:
        if node.text_body:
            for part in node.text_body.total_text.split():
                if len(part) > 1:
                    words.add(part)
        if node.rows:
            for row in node.rows:
                for cell in row.cells:
                    for part in cell.text.split():
                        if len(part) > 1:
                            words.add(part)
    return words


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSlideCount:
    def test_slide_count(self, test_file, export_presentation):
        pptx_path = tdp.source_pptx(test_file)
        ground_truth = extract_ground_truth(pptx_path)
        renderer_data = export_presentation(test_file)
        renderer = renderer_to_structure(renderer_data)

        assert ground_truth.slide_count == renderer.slide_count, (
            f"Slide count mismatch: ground_truth={ground_truth.slide_count}, "
            f"renderer={renderer.slide_count}"
        )


class TestTextCoverage:
    def test_text_coverage(self, test_file, export_presentation):
        pptx_path = tdp.source_pptx(test_file)
        ground_truth = extract_ground_truth(pptx_path)
        renderer_data = export_presentation(test_file)
        renderer = renderer_to_structure(renderer_data)

        for i in range(ground_truth.slide_count):
            gt_words = _extract_words(ground_truth, i)
            rn_words = _extract_words(renderer, i)

            if not gt_words:
                continue  # Skip empty slides

            matched = len(gt_words & rn_words)
            coverage = matched / len(gt_words)

            assert coverage >= 0.90, (
                f"Slide {i}: text coverage {coverage:.1%} < 90% "
                f"({matched}/{len(gt_words)} words). "
                f"Missing: {list(gt_words - rn_words)[:10]}"
            )


class TestShapeCount:
    def test_shape_count(self, test_file, export_presentation):
        pptx_path = tdp.source_pptx(test_file)
        ground_truth = extract_ground_truth(pptx_path)
        renderer_data = export_presentation(test_file)
        renderer = renderer_to_structure(renderer_data)

        for i in range(ground_truth.slide_count):
            gt_slide = ground_truth.slides[i] if i < len(ground_truth.slides) else None
            rn_slide = renderer.slides[i] if i < len(renderer.slides) else None
            if gt_slide is None or rn_slide is None:
                continue

            gt_count = len(gt_slide.nodes)
            rn_count = len(rn_slide.nodes)

            if gt_count == 0:
                continue

            ratio = rn_count / gt_count
            assert ratio >= 0.90, (
                f"Slide {i}: shape count ratio {ratio:.2f} < 0.90 "
                f"(gt={gt_count}, renderer={rn_count})"
            )


class TestShapePositions:
    def test_shape_positions(self, test_file, export_presentation):
        """Position difference should be < 2% of slide dimensions."""
        pptx_path = tdp.source_pptx(test_file)
        ground_truth = extract_ground_truth(pptx_path)
        renderer_data = export_presentation(test_file)
        renderer = renderer_to_structure(renderer_data)

        slide_w = ground_truth.width
        slide_h = ground_truth.height
        threshold_x = slide_w * 0.02
        threshold_y = slide_h * 0.02

        for i in range(min(ground_truth.slide_count, renderer.slide_count)):
            gt_nodes = ground_truth.slides[i].nodes
            rn_nodes = renderer.slides[i].nodes

            # Match nodes by id
            rn_by_id = {n.id: n for n in rn_nodes}
            for gt_node in gt_nodes:
                rn_node = rn_by_id.get(gt_node.id)
                if rn_node is None:
                    continue
                # Skip placeholders with inherited position (0,0 + 0x0 in ground truth)
                if gt_node.size.w == 0 and gt_node.size.h == 0:
                    continue
                # Skip nodes at origin with zero size in ground truth
                if gt_node.position.x == 0 and gt_node.position.y == 0 and gt_node.size.w == 0:
                    continue

                dx = abs(gt_node.position.x - rn_node.position.x)
                dy = abs(gt_node.position.y - rn_node.position.y)

                assert dx < threshold_x and dy < threshold_y, (
                    f"Slide {i}, node '{gt_node.name}' (id={gt_node.id}): "
                    f"position diff ({dx:.1f}, {dy:.1f}) exceeds threshold "
                    f"({threshold_x:.1f}, {threshold_y:.1f})"
                )


class TestShapeSizes:
    def test_shape_sizes(self, test_file, export_presentation):
        """Size ratio should be between 0.95 and 1.05."""
        pptx_path = tdp.source_pptx(test_file)
        ground_truth = extract_ground_truth(pptx_path)
        renderer_data = export_presentation(test_file)
        renderer = renderer_to_structure(renderer_data)

        for i in range(min(ground_truth.slide_count, renderer.slide_count)):
            gt_nodes = ground_truth.slides[i].nodes
            rn_nodes = renderer.slides[i].nodes

            rn_by_id = {n.id: n for n in rn_nodes}
            for gt_node in gt_nodes:
                rn_node = rn_by_id.get(gt_node.id)
                if rn_node is None:
                    continue
                # Skip zero-size nodes (placeholders with inherited size)
                if gt_node.size.w == 0 or gt_node.size.h == 0:
                    continue

                w_ratio = rn_node.size.w / gt_node.size.w if gt_node.size.w > 0 else 1
                h_ratio = rn_node.size.h / gt_node.size.h if gt_node.size.h > 0 else 1

                assert 0.95 <= w_ratio <= 1.05, (
                    f"Slide {i}, node '{gt_node.name}': "
                    f"width ratio {w_ratio:.3f} out of [0.95, 1.05]"
                )
                assert 0.95 <= h_ratio <= 1.05, (
                    f"Slide {i}, node '{gt_node.name}': "
                    f"height ratio {h_ratio:.3f} out of [0.95, 1.05]"
                )


class TestTableStructure:
    def test_table_structure(self, test_file, export_presentation):
        """Table row/column counts must match exactly."""
        pptx_path = tdp.source_pptx(test_file)
        ground_truth = extract_ground_truth(pptx_path)
        renderer_data = export_presentation(test_file)
        renderer = renderer_to_structure(renderer_data)

        for i in range(min(ground_truth.slide_count, renderer.slide_count)):
            gt_tables = [n for n in _collect_all_nodes(ground_truth.slides[i].nodes) if n.node_type == "table"]
            rn_tables = [n for n in _collect_all_nodes(renderer.slides[i].nodes) if n.node_type == "table"]

            # Match by id
            rn_by_id = {t.id: t for t in rn_tables}
            for gt_table in gt_tables:
                rn_table = rn_by_id.get(gt_table.id)
                if rn_table is None:
                    continue

                gt_cols = len(gt_table.columns) if gt_table.columns else 0
                rn_cols = len(rn_table.columns) if rn_table.columns else 0
                assert gt_cols == rn_cols, (
                    f"Slide {i}, table '{gt_table.name}': "
                    f"column count mismatch gt={gt_cols} vs renderer={rn_cols}"
                )

                gt_rows = len(gt_table.rows) if gt_table.rows else 0
                rn_rows = len(rn_table.rows) if rn_table.rows else 0
                assert gt_rows == rn_rows, (
                    f"Slide {i}, table '{gt_table.name}': "
                    f"row count mismatch gt={gt_rows} vs renderer={rn_rows}"
                )


class TestPresetGeometry:
    def test_preset_geometry(self, test_file, export_presentation):
        """Preset geometry strings must match exactly for shapes that have them."""
        pptx_path = tdp.source_pptx(test_file)
        ground_truth = extract_ground_truth(pptx_path)
        renderer_data = export_presentation(test_file)
        renderer = renderer_to_structure(renderer_data)

        for i in range(min(ground_truth.slide_count, renderer.slide_count)):
            gt_nodes = _collect_all_nodes(ground_truth.slides[i].nodes)
            rn_nodes = _collect_all_nodes(renderer.slides[i].nodes)

            rn_by_id = {n.id: n for n in rn_nodes}
            for gt_node in gt_nodes:
                if gt_node.preset_geometry is None:
                    continue
                rn_node = rn_by_id.get(gt_node.id)
                if rn_node is None:
                    continue

                assert gt_node.preset_geometry == rn_node.preset_geometry, (
                    f"Slide {i}, node '{gt_node.name}': "
                    f"preset geometry mismatch: "
                    f"gt='{gt_node.preset_geometry}' vs renderer='{rn_node.preset_geometry}'"
                )
