#!/usr/bin/env python3
"""Generate ground truth cases using python-pptx + native PowerPoint export.

Produces oracle-pypptx-* cases covering:
  - Rich text: fonts, sizes, bold/italic, alignment, vertical text, bullets
  - Shape adjustment variants: same shape with different adj values
  - Chart data variants: 2D chart types with custom data/series
  - Composite: multiple components on a single slide

Usage (from test/e2e/):
  pip install python-pptx
  python scripts/generate_pypptx_cases.py              # PDF on macOS; PDF+PNG on Windows
  python scripts/generate_pypptx_cases.py --pptx-only  # generate PPTX only (any platform)
  python scripts/generate_pypptx_cases.py --case 'oracle-pypptx-text-00[45]*'
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import math
import posixpath
import random
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree
from pptx import Presentation
from pptx.chart.data import BubbleChartData, CategoryChartData, XyChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

E2E_DIR = Path(__file__).resolve().parents[1]
if str(E2E_DIR) not in sys.path:
    sys.path.insert(0, str(E2E_DIR))

CASES_DIR = E2E_DIR / "oracle" / "cases-pypptx"
TESTDATA_DIR = E2E_DIR / "testdata"
REPORT_PATH = E2E_DIR / "reports" / "oracle-failures" / "pypptx-ground-truth.json"

# Slide dimensions (standard widescreen 13.333" x 7.5")
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)


# ---------------------------------------------------------------------------
# Case definition helpers
# ---------------------------------------------------------------------------

CaseDef = dict  # {name: str, build_fn: Callable[[Presentation], None]}

PML_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
PML_REL_PREFIX = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"p": PML_NS, "pr": REL_NS}


def _emu(inches: float) -> int:
    return int(Inches(inches))


def _remove_children(parent, local_names: tuple[str, ...]) -> None:
    for local_name in local_names:
        child = parent.find(qn(f"a:{local_name}"))
        if child is not None:
            parent.remove(child)


def _configure_text_body(
    text_frame,
    *,
    wrap: str,
    autofit: str | None,
    autofit_attrs: dict[str, str] | None = None,
    anchor: str | None = None,
) -> None:
    """Set bodyPr values that python-pptx does not expose losslessly."""
    body_pr = text_frame._txBody.find(qn("a:bodyPr"))
    if body_pr is None:
        raise RuntimeError("text frame has no a:bodyPr")

    body_pr.set("wrap", wrap)
    if anchor is not None:
        body_pr.set("anchor", anchor)
    _remove_children(body_pr, ("noAutofit", "normAutofit", "spAutoFit"))
    if autofit is not None:
        etree.SubElement(body_pr, qn(f"a:{autofit}"), **(autofit_attrs or {}))


def _replace_spacing_value(paragraph, container_name: str, value_name: str, value: int) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    old = p_pr.find(qn(f"a:{container_name}"))
    if old is not None:
        p_pr.remove(old)
    container = etree.SubElement(p_pr, qn(f"a:{container_name}"))
    etree.SubElement(container, qn(f"a:{value_name}"), val=str(value))


def _set_cjk_run_style(
    run,
    *,
    font_name: str = "Microsoft YaHei",
    font_size_pt: int = 28,
    bold: bool = False,
    spacing: int | None = None,
) -> None:
    run.font.name = font_name
    run.font.size = Pt(font_size_pt)
    run.font.bold = bold
    r_pr = run._r.get_or_add_rPr()
    r_pr.set("lang", "zh-CN")
    if spacing is not None:
        r_pr.set("spc", str(spacing))
    for script in ("latin", "ea"):
        typeface = r_pr.find(qn(f"a:{script}"))
        if typeface is None:
            typeface = etree.SubElement(r_pr, qn(f"a:{script}"))
        typeface.set("typeface", font_name)


def _add_cjk_run(paragraph, text: str, **style):
    run = paragraph.add_run()
    run.text = text
    _set_cjk_run_style(run, **style)
    return run


def _set_cjk_paragraph_text(paragraph, text: str, **style) -> None:
    """Set paragraph text so vertical tabs become OOXML soft line breaks."""
    paragraph.text = text
    for run in paragraph.runs:
        _set_cjk_run_style(run, **style)


def _add_cjk_textbox(
    prs: Presentation,
    *,
    width: float = 8.5,
    height: float = 3.0,
    left: float = 1.0,
    top: float = 1.0,
):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    shape = slide.shapes.add_textbox(_emu(left), _emu(top), _emu(width), _emu(height))
    text_frame = shape.text_frame
    text_frame.clear()
    text_frame.word_wrap = True
    text_frame.margin_left = Inches(0.12)
    text_frame.margin_right = Inches(0.12)
    text_frame.margin_top = Inches(0.08)
    text_frame.margin_bottom = Inches(0.08)
    return slide, shape, text_frame


def _rels_path(part_name: str) -> str:
    directory, filename = posixpath.split(part_name)
    return posixpath.join(directory, "_rels", f"{filename}.rels")


def _resolve_part_target(part_name: str, target: str) -> str:
    return posixpath.normpath(posixpath.join(posixpath.dirname(part_name), target))


def _relationship_target(zf: ZipFile, part_name: str, rel_suffix: str) -> str | None:
    root = etree.fromstring(zf.read(_rels_path(part_name)))
    for rel in root.xpath(".//pr:Relationship", namespaces=NS):
        rel_type = rel.get("Type", "")
        target = rel.get("Target")
        if target and rel_type == f"{PML_REL_PREFIX}{rel_suffix}":
            return _resolve_part_target(part_name, target)
    return None


def _read_pptx_entries(pptx_path: Path) -> tuple[list[tuple], dict[str, bytes]]:
    with ZipFile(pptx_path, "r") as zf:
        entries = [(info, zf.read(info.filename)) for info in zf.infolist()]
    return entries, {info.filename: data for info, data in entries}


def _replace_pptx_entries(pptx_path: Path, entries: list[tuple], patched: dict[str, bytes]) -> None:
    tmp_path = pptx_path.with_name(f"{pptx_path.name}.tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    with ZipFile(tmp_path, "w", ZIP_DEFLATED) as out:
        for info, data in entries:
            out.writestr(info, patched.get(info.filename, data))
    tmp_path.replace(pptx_path)


def _patch_placeholder_idx_inheritance_case(pptx_path: Path) -> None:
    """Make slide placeholders inherit type through idx, matching real OOXML edge cases."""
    slide_part = "ppt/slides/slide1.xml"

    with ZipFile(pptx_path, "r") as zf:
        entries, data_by_name = _read_pptx_entries(pptx_path)
        layout_part = _relationship_target(zf, slide_part, "/slideLayout")
        if layout_part is None:
            raise RuntimeError("placeholder inheritance case slide has no slideLayout relationship")

        slide_root = etree.fromstring(data_by_name[slide_part])
        layout_root = etree.fromstring(data_by_name[layout_part])

    slide_title_ph = slide_root.xpath(".//p:ph[@type='title']", namespaces=NS)
    if not slide_title_ph:
        raise RuntimeError("placeholder inheritance case has no slide title placeholder")
    slide_title_ph[0].attrib.pop("type", None)
    slide_title_ph[0].set("idx", "0")

    slide_body_ph = slide_root.xpath(".//p:ph[@idx='1']", namespaces=NS)
    if not slide_body_ph:
        raise RuntimeError("placeholder inheritance case has no slide body placeholder")
    slide_body_ph[0].attrib.pop("type", None)

    layout_title_ph = layout_root.xpath(".//p:ph[@type='title']", namespaces=NS)
    if not layout_title_ph:
        raise RuntimeError("placeholder inheritance case has no layout title placeholder")
    layout_title_ph[0].set("idx", "0")

    patched = {
        slide_part: etree.tostring(slide_root, encoding="UTF-8", xml_declaration=True),
        layout_part: etree.tostring(layout_root, encoding="UTF-8", xml_declaration=True),
    }
    _replace_pptx_entries(pptx_path, entries, patched)


def _patch_connector_tail_arrows(pptx_path: Path) -> None:
    """Add OOXML tail arrowheads to generated connectors where python-pptx has no API."""
    slide_part = "ppt/slides/slide1.xml"
    entries, data_by_name = _read_pptx_entries(pptx_path)
    slide_root = etree.fromstring(data_by_name[slide_part])
    ns = {"p": PML_NS, "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}

    for ln in slide_root.xpath(".//p:cxnSp/p:spPr/a:ln", namespaces=ns):
        if ln.find(qn("a:tailEnd")) is not None:
            continue
        tail = etree.SubElement(ln, qn("a:tailEnd"))
        tail.set("type", "triangle")
        tail.set("w", "med")
        tail.set("len", "med")

    _replace_pptx_entries(
        pptx_path,
        entries,
        {slide_part: etree.tostring(slide_root, encoding="UTF-8", xml_declaration=True)},
    )


def _patch_layered_transparency_case(pptx_path: Path) -> None:
    """Apply alpha modifiers to named overlap shapes for translucent-layer regressions."""
    slide_part = "ppt/slides/slide1.xml"
    entries, data_by_name = _read_pptx_entries(pptx_path)
    slide_root = etree.fromstring(data_by_name[slide_part])
    ns = {"p": PML_NS, "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}

    for sp in slide_root.xpath(".//p:sp", namespaces=ns):
        name = (sp.xpath("string(p:nvSpPr/p:cNvPr/@name)", namespaces=ns) or "").lower()
        if "alpha layer" not in name:
            continue
        srgb = sp.find(".//a:solidFill/a:srgbClr", namespaces=ns)
        if srgb is None or srgb.find(qn("a:alpha")) is not None:
            continue
        alpha = etree.SubElement(srgb, qn("a:alpha"))
        alpha.set("val", "45000")

    _replace_pptx_entries(
        pptx_path,
        entries,
        {slide_part: etree.tostring(slide_root, encoding="UTF-8", xml_declaration=True)},
    )


def _patch_scaled_group_diagram_case(pptx_path: Path) -> None:
    """Append a valid p:grpSp with non-identity chExt/ext scaling."""
    slide_part = "ppt/slides/slide1.xml"
    entries, data_by_name = _read_pptx_entries(pptx_path)
    slide_root = etree.fromstring(data_by_name[slide_part])
    sp_tree = slide_root.find(".//{%s}spTree" % PML_NS)
    if sp_tree is None:
        raise RuntimeError("scaled group case slide has no spTree")

    group_xml = f"""
      <p:grpSp xmlns:p="{PML_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvGrpSpPr>
          <p:cNvPr id="501" name="Scaled pipeline group"/>
          <p:cNvGrpSpPr/>
          <p:nvPr/>
        </p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="914400" y="914400"/>
            <a:ext cx="9144000" cy="3657600"/>
            <a:chOff x="0" y="0"/>
            <a:chExt cx="4572000" cy="1828800"/>
          </a:xfrm>
        </p:grpSpPr>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="502" name="Group Parse"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="228600"/><a:ext cx="1219200" cy="685800"/></a:xfrm>
            <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="2F5597"/></a:solidFill>
          </p:spPr>
          <p:txBody>
            <a:bodyPr anchor="ctr"/><a:lstStyle/>
            <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Parse</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
        <p:cxnSp>
          <p:nvCxnSpPr><p:cNvPr id="503" name="Group Arrow 1"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
          <p:spPr>
            <a:xfrm><a:off x="1371600" y="571500"/><a:ext cx="457200" cy="0"/></a:xfrm>
            <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
            <a:ln w="25400"><a:solidFill><a:srgbClr val="5B9BD5"/></a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln>
          </p:spPr>
        </p:cxnSp>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="504" name="Group Model"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="1828800" y="0"/><a:ext cx="1219200" cy="1143000"/></a:xfrm>
            <a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="70AD47"/></a:solidFill>
          </p:spPr>
          <p:txBody>
            <a:bodyPr anchor="ctr"/><a:lstStyle/>
            <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Model</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
        <p:cxnSp>
          <p:nvCxnSpPr><p:cNvPr id="505" name="Group Arrow 2"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
          <p:spPr>
            <a:xfrm><a:off x="3200400" y="571500"/><a:ext cx="457200" cy="0"/></a:xfrm>
            <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
            <a:ln w="25400"><a:solidFill><a:srgbClr val="5B9BD5"/></a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln>
          </p:spPr>
        </p:cxnSp>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="506" name="Group Render"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="3657600" y="228600"/><a:ext cx="914400" cy="685800"/></a:xfrm>
            <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="ED7D31"/></a:solidFill>
          </p:spPr>
          <p:txBody>
            <a:bodyPr anchor="ctr"/><a:lstStyle/>
            <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Render</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      </p:grpSp>
    """
    sp_tree.append(etree.fromstring(group_xml))

    _replace_pptx_entries(
        pptx_path,
        entries,
        {slide_part: etree.tostring(slide_root, encoding="UTF-8", xml_declaration=True)},
    )


# ---------------------------------------------------------------------------
# P0: Rich text cases
# ---------------------------------------------------------------------------

def _build_text_cases() -> list[CaseDef]:
    cases: list[CaseDef] = []
    seq = 0

    def _add(slug: str, build_fn, postprocess_fn=None, coverage=None):
        nonlocal seq
        seq += 1
        case = {
            "name": f"oracle-pypptx-text-{seq:04d}-{slug}",
            "build_fn": build_fn,
        }
        if postprocess_fn is not None:
            case["postprocess_fn"] = postprocess_fn
        if coverage is not None:
            case["coverage"] = coverage
        cases.append(case)

    # --- Font families ---
    font_families = [
        ("Arial", "arial"),
        ("Times New Roman", "times-new-roman"),
        ("Calibri", "calibri"),
        ("Courier New", "courier-new"),
        ("Georgia", "georgia"),
        ("Verdana", "verdana"),
        ("Impact", "impact"),
        ("Comic Sans MS", "comic-sans"),
    ]
    for font_name, slug in font_families:
        def _build(prs, _fn=font_name):
            sld = prs.slides.add_slide(prs.slide_layouts[6])  # blank
            txbox = sld.shapes.add_textbox(_emu(1), _emu(1), _emu(8), _emu(2))
            tf = txbox.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            run = p.add_run()
            run.text = f"The quick brown fox jumps over the lazy dog — {_fn}"
            run.font.name = _fn
            run.font.size = Pt(28)
        _add(f"font-{slug}", _build)

    # --- Font sizes ---
    for pt_size in [10, 14, 18, 24, 36, 48, 72]:
        def _build(prs, _sz=pt_size):
            sld = prs.slides.add_slide(prs.slide_layouts[6])
            txbox = sld.shapes.add_textbox(_emu(1), _emu(1), _emu(10), _emu(3))
            tf = txbox.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            run = p.add_run()
            run.text = f"Font size {_sz}pt sample text"
            run.font.size = Pt(_sz)
            run.font.name = "Calibri"
        _add(f"size-{pt_size}pt", _build)

    # --- Bold / Italic / Underline combos ---
    style_combos = [
        ("bold", True, False, False),
        ("italic", False, True, False),
        ("underline", False, False, True),
        ("bold-italic", True, True, False),
        ("bold-underline", True, False, True),
        ("bold-italic-underline", True, True, True),
    ]
    for slug, bold, italic, underline in style_combos:
        def _build(prs, _b=bold, _i=italic, _u=underline, _s=slug):
            sld = prs.slides.add_slide(prs.slide_layouts[6])
            txbox = sld.shapes.add_textbox(_emu(1), _emu(1), _emu(8), _emu(2))
            tf = txbox.text_frame
            p = tf.paragraphs[0]
            run = p.add_run()
            run.text = f"Style: {_s} — The quick brown fox"
            run.font.name = "Calibri"
            run.font.size = Pt(24)
            run.font.bold = _b
            run.font.italic = _i
            run.font.underline = _u
        _add(f"style-{slug}", _build)

    # --- Alignment ---
    alignments = [
        ("left", PP_ALIGN.LEFT),
        ("center", PP_ALIGN.CENTER),
        ("right", PP_ALIGN.RIGHT),
        ("justify", PP_ALIGN.JUSTIFY),
    ]
    for slug, align in alignments:
        def _build(prs, _a=align, _s=slug):
            sld = prs.slides.add_slide(prs.slide_layouts[6])
            txbox = sld.shapes.add_textbox(_emu(1), _emu(1), _emu(8), _emu(4))
            tf = txbox.text_frame
            tf.word_wrap = True
            for i in range(3):
                p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                p.text = f"Paragraph {i+1} aligned {_s}. Lorem ipsum dolor sit amet."
                p.alignment = _a
                p.font.size = Pt(18)
                p.font.name = "Calibri"
        _add(f"align-{slug}", _build)

    # --- Font colors ---
    colors = [
        ("red", RGBColor(0xFF, 0x00, 0x00)),
        ("green", RGBColor(0x00, 0xB0, 0x50)),
        ("blue", RGBColor(0x00, 0x70, 0xC0)),
        ("orange", RGBColor(0xFF, 0xC0, 0x00)),
        ("purple", RGBColor(0x7B, 0x2D, 0x8E)),
    ]
    for slug, color in colors:
        def _build(prs, _c=color, _s=slug):
            sld = prs.slides.add_slide(prs.slide_layouts[6])
            txbox = sld.shapes.add_textbox(_emu(1), _emu(1), _emu(8), _emu(2))
            tf = txbox.text_frame
            p = tf.paragraphs[0]
            run = p.add_run()
            run.text = f"Color: {_s} text sample"
            run.font.name = "Calibri"
            run.font.size = Pt(28)
            run.font.color.rgb = _c
        _add(f"color-{slug}", _build)

    # --- Multi-paragraph with mixed formatting ---
    def _build_mixed(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        txbox = sld.shapes.add_textbox(_emu(1), _emu(0.5), _emu(10), _emu(6))
        tf = txbox.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.alignment = PP_ALIGN.LEFT
        r1 = p1.add_run()
        r1.text = "Title in Bold 36pt"
        r1.font.name = "Arial"
        r1.font.size = Pt(36)
        r1.font.bold = True

        p2 = tf.add_paragraph()
        p2.alignment = PP_ALIGN.LEFT
        r2 = p2.add_run()
        r2.text = "Subtitle in italic 24pt — "
        r2.font.name = "Georgia"
        r2.font.size = Pt(24)
        r2.font.italic = True
        r3 = p2.add_run()
        r3.text = "with colored segment"
        r3.font.name = "Georgia"
        r3.font.size = Pt(24)
        r3.font.color.rgb = RGBColor(0x00, 0x70, 0xC0)

        p3 = tf.add_paragraph()
        r4 = p3.add_run()
        r4.text = "Body text in Calibri 18pt. Lorem ipsum dolor sit amet, consectetur adipiscing elit."
        r4.font.name = "Calibri"
        r4.font.size = Pt(18)
    _add("mixed-formatting", _build_mixed)

    # --- Bullet list ---
    def _build_bullets(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        txbox = sld.shapes.add_textbox(_emu(1), _emu(1), _emu(8), _emu(5))
        tf = txbox.text_frame
        tf.word_wrap = True
        items = [
            (0, "First level item A"),
            (1, "Second level item A.1"),
            (1, "Second level item A.2"),
            (0, "First level item B"),
            (1, "Second level item B.1"),
            (2, "Third level item B.1.a"),
            (0, "First level item C"),
        ]
        for i, (level, text) in enumerate(items):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.text = text
            p.level = level
            p.font.size = Pt(18)
            p.font.name = "Calibri"
    _add("bullet-list", _build_bullets)

    # --- Vertical text (East Asian) ---
    def _build_vertical(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        txbox = sld.shapes.add_textbox(_emu(4), _emu(0.5), _emu(3), _emu(6))
        tf = txbox.text_frame
        tf.word_wrap = True
        txBody = tf._txBody
        bodyPr = txBody.find(qn("a:bodyPr"))
        bodyPr.set("vert", "eaVert")
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = "垂直文本テスト Vertical Text 수직 텍스트"
        run.font.size = Pt(24)
        run.font.name = "Microsoft YaHei"
    _add("vertical-east-asian", _build_vertical)

    # --- Vertical text (wordArtVert) ---
    def _build_vertical_word(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        txbox = sld.shapes.add_textbox(_emu(4), _emu(0.5), _emu(2), _emu(6))
        tf = txbox.text_frame
        tf.word_wrap = True
        bodyPr = tf._txBody.find(qn("a:bodyPr"))
        bodyPr.set("vert", "wordArtVert")
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = "VERTICAL STACKED TEXT"
        run.font.size = Pt(24)
        run.font.name = "Arial"
    _add("vertical-stacked", _build_vertical_word)

    # --- Text anchor (top / middle / bottom) ---
    _ANCHOR_XML = {"top": "t", "middle": "ctr", "bottom": "b"}
    for anchor_slug in ["top", "middle", "bottom"]:
        def _build(prs, _s=anchor_slug, _xml=_ANCHOR_XML[anchor_slug]):
            sld = prs.slides.add_slide(prs.slide_layouts[6])
            shp = sld.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, _emu(2), _emu(1), _emu(6), _emu(4))
            tf = shp.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            run = p.add_run()
            run.text = f"Anchor: {_s}"
            run.font.size = Pt(24)
            run.font.name = "Calibri"
            run.font.bold = True
            p.alignment = PP_ALIGN.CENTER
            bodyPr = tf._txBody.find(qn("a:bodyPr"))
            bodyPr.set("anchor", _xml)
        _add(f"anchor-{anchor_slug}", _build)

    # --- Line spacing ---
    def _build_spacing(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        txbox = sld.shapes.add_textbox(_emu(1), _emu(0.5), _emu(10), _emu(6))
        tf = txbox.text_frame
        tf.word_wrap = True
        for i in range(5):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.text = f"Line {i+1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit."
            p.font.size = Pt(18)
            p.font.name = "Calibri"
            p.space_after = Pt(12)
            p.space_before = Pt(6)
    _add("line-spacing", _build_spacing)

    # --- Placeholder idx-only inheritance (slide ph idx -> layout/master ph type) ---
    def _build_placeholder_idx_inheritance(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[1])  # Title and Content

        sld.shapes.title.text = "Placeholder Inheritance Title"

        body = sld.placeholders[1]
        tf = body.text_frame
        tf.clear()
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = "Body placeholder inherits bullet and master text size"

        p2 = tf.add_paragraph()
        p2.text = "Second line also inherits body placeholder style"
        p2.level = 0
    _add(
        "placeholder-idx-inheritance",
        _build_placeholder_idx_inheritance,
        _patch_placeholder_idx_inheritance_case,
    )

    # --- CJK layout interaction matrix (issue #23 follow-up) ---
    # Keep these as focused one-feature variants. Their PPTX/PDF outputs stay local and
    # ignored; the definitions make the matrix reproducible across native PowerPoint hosts.
    cjk_wrap_text = "坚守问题导向，持续提升复杂演示文稿的渲染质量与一致性。"

    def _cjk_coverage(*features: str) -> dict:
        return {
            "oracle": "native-powerpoint",
            "requiredFonts": ["Microsoft YaHei"],
            "features": ["text.cjk", *features],
        }

    def _build_cjk_wrap_square_no_autofit(prs):
        _, _, tf = _add_cjk_textbox(prs, width=5.6, height=1.8)
        _configure_text_body(tf, wrap="square", autofit="noAutofit")
        _add_cjk_run(tf.paragraphs[0], cjk_wrap_text, font_size_pt=30)
    _add(
        "cjk-wrap-square-no-autofit",
        _build_cjk_wrap_square_no_autofit,
        coverage=_cjk_coverage("bodyPr.wrap=square", "bodyPr.noAutofit"),
    )

    def _build_cjk_wrap_square_implicit(prs):
        _, _, tf = _add_cjk_textbox(prs, width=5.6, height=1.8)
        _configure_text_body(tf, wrap="square", autofit=None)
        _add_cjk_run(tf.paragraphs[0], cjk_wrap_text, font_size_pt=30)
    _add(
        "cjk-wrap-square-implicit-autofit",
        _build_cjk_wrap_square_implicit,
        coverage=_cjk_coverage("bodyPr.wrap=square", "bodyPr.autofit=omitted"),
    )

    def _build_cjk_wrap_none_no_autofit(prs):
        _, _, tf = _add_cjk_textbox(prs, width=5.6, height=1.4)
        _configure_text_body(tf, wrap="none", autofit="noAutofit")
        _add_cjk_run(tf.paragraphs[0], cjk_wrap_text, font_size_pt=30)
    _add(
        "cjk-wrap-none-no-autofit",
        _build_cjk_wrap_none_no_autofit,
        coverage=_cjk_coverage("bodyPr.wrap=none", "bodyPr.noAutofit"),
    )

    def _build_cjk_sp_autofit(prs):
        _, _, tf = _add_cjk_textbox(prs, width=4.8, height=1.2)
        _configure_text_body(tf, wrap="square", autofit="spAutoFit")
        _add_cjk_run(tf.paragraphs[0], cjk_wrap_text, font_size_pt=30)
    _add(
        "cjk-sp-autofit-narrow",
        _build_cjk_sp_autofit,
        coverage=_cjk_coverage("bodyPr.wrap=square", "bodyPr.spAutoFit", "layout.narrow"),
    )

    def _build_cjk_norm_autofit(prs):
        _, _, tf = _add_cjk_textbox(prs, width=4.8, height=1.35)
        _configure_text_body(
            tf,
            wrap="square",
            autofit="normAutofit",
            autofit_attrs={"fontScale": "85000", "lnSpcReduction": "10000"},
        )
        _add_cjk_run(tf.paragraphs[0], cjk_wrap_text, font_size_pt=30)
    _add(
        "cjk-norm-autofit-scaled",
        _build_cjk_norm_autofit,
        coverage=_cjk_coverage(
            "bodyPr.wrap=square",
            "bodyPr.normAutofit",
            "normAutofit.fontScale=85000",
            "normAutofit.lnSpcReduction=10000",
        ),
    )

    multiline_cjk = "第一行：统一字体测量\v第二行：核对中文行距\v第三行：观察基线位置"

    def _build_cjk_line_spacing(prs, value_name: str, value: int):
        _, _, tf = _add_cjk_textbox(prs, width=9.0, height=4.2)
        _configure_text_body(tf, wrap="square", autofit="noAutofit")
        paragraph = tf.paragraphs[0]
        _set_cjk_paragraph_text(paragraph, multiline_cjk, font_size_pt=28)
        _replace_spacing_value(paragraph, "lnSpc", value_name, value)

    _add(
        "cjk-line-spacing-100pct",
        lambda prs: _build_cjk_line_spacing(prs, "spcPct", 100000),
        coverage=_cjk_coverage("paragraph.manualBreaks", "lnSpc.spcPct=100000"),
    )
    _add(
        "cjk-line-spacing-130pct",
        lambda prs: _build_cjk_line_spacing(prs, "spcPct", 130000),
        coverage=_cjk_coverage("paragraph.manualBreaks", "lnSpc.spcPct=130000"),
    )
    _add(
        "cjk-line-spacing-28pt",
        lambda prs: _build_cjk_line_spacing(prs, "spcPts", 2800),
        coverage=_cjk_coverage("paragraph.manualBreaks", "lnSpc.spcPts=2800"),
    )

    def _build_cjk_paragraph_spacing(prs, value_name: str, before: int, after: int):
        _, _, tf = _add_cjk_textbox(prs, width=9.0, height=4.8)
        _configure_text_body(tf, wrap="square", autofit="noAutofit")
        texts = [
            "第一段：段前段后间距需要遵循演示文稿定义。",
            "第二段：浏览器默认外边距不能参与布局。",
            "第三段：末段外边距需要保持 PowerPoint 语义。",
        ]
        for index, text in enumerate(texts):
            paragraph = tf.paragraphs[0] if index == 0 else tf.add_paragraph()
            _add_cjk_run(paragraph, text, font_size_pt=26)
            _replace_spacing_value(paragraph, "spcBef", value_name, before)
            _replace_spacing_value(paragraph, "spcAft", value_name, after)

    _add(
        "cjk-paragraph-spacing-points",
        lambda prs: _build_cjk_paragraph_spacing(prs, "spcPts", 600, 1000),
        coverage=_cjk_coverage("paragraph.multiple", "spcBef.spcPts", "spcAft.spcPts"),
    )
    _add(
        "cjk-paragraph-spacing-percent",
        lambda prs: _build_cjk_paragraph_spacing(prs, "spcPct", 30000, 50000),
        coverage=_cjk_coverage("paragraph.multiple", "spcBef.spcPct", "spcAft.spcPct"),
    )

    def _build_cjk_mixed_run_spacing(prs):
        _, _, tf = _add_cjk_textbox(prs, width=9.2, height=2.2)
        _configure_text_body(tf, wrap="square", autofit="noAutofit")
        paragraph = tf.paragraphs[0]
        _add_cjk_run(paragraph, "字距放宽", font_size_pt=32, bold=True, spacing=180)
        _add_cjk_run(paragraph, "｜正常字距｜", font_size_pt=32)
        _add_cjk_run(paragraph, "字距收紧", font_size_pt=32, bold=True, spacing=-120)
    _add(
        "cjk-mixed-run-character-spacing",
        _build_cjk_mixed_run_spacing,
        coverage=_cjk_coverage("runs.adjacent", "run.spacing=positive-negative"),
    )

    def _build_cjk_rounded_shape(prs):
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        shape = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            _emu(2.0),
            _emu(1.2),
            _emu(8.5),
            _emu(4.2),
        )
        shape.fill.solid()
        shape.fill.fore_color.rgb = RGBColor(0xE9, 0xF2, 0xFF)
        shape.line.color.rgb = RGBColor(0x2F, 0x55, 0x97)
        tf = shape.text_frame
        tf.clear()
        tf.word_wrap = True
        tf.margin_left = Inches(0.3)
        tf.margin_right = Inches(0.3)
        tf.margin_top = Inches(0.2)
        tf.margin_bottom = Inches(0.2)
        _configure_text_body(
            tf,
            wrap="square",
            autofit="noAutofit",
            anchor="ctr",
        )
        paragraph = tf.paragraphs[0]
        paragraph.alignment = PP_ALIGN.CENTER
        _set_cjk_paragraph_text(
            paragraph,
            "容器内第一行\v容器内第二行\v居中与行距共同生效",
            font_size_pt=28,
            bold=True,
        )
        _replace_spacing_value(paragraph, "lnSpc", "spcPct", 120000)
    _add(
        "cjk-rounded-shape-centered-spacing",
        _build_cjk_rounded_shape,
        coverage=_cjk_coverage(
            "container.roundedRect",
            "bodyPr.anchor=ctr",
            "paragraph.alignment=center",
            "paragraph.manualBreaks",
            "lnSpc.spcPct=120000",
        ),
    )

    return cases


# ---------------------------------------------------------------------------
# P1: Shape adjustment variants
# ---------------------------------------------------------------------------

def _build_shape_adj_cases() -> list[CaseDef]:
    cases: list[CaseDef] = []
    seq = 0

    def _add(slug: str, build_fn):
        nonlocal seq
        seq += 1
        cases.append({
            "name": f"oracle-pypptx-shape-adj-{seq:04d}-{slug}",
            "build_fn": build_fn,
        })

    # Shapes with meaningful adjustments: (MSO_SHAPE, slug, [(adj_index, value), ...])
    adj_configs = [
        # roundRect: corner radius
        (MSO_SHAPE.ROUNDED_RECTANGLE, "round-rect-small-radius", [(0, 0.05)]),
        (MSO_SHAPE.ROUNDED_RECTANGLE, "round-rect-large-radius", [(0, 0.45)]),
        # chevron: point depth
        (MSO_SHAPE.CHEVRON, "chevron-shallow", [(0, 0.15)]),
        (MSO_SHAPE.CHEVRON, "chevron-deep", [(0, 0.45)]),
        # right arrow: head width and depth
        (MSO_SHAPE.RIGHT_ARROW, "arrow-thin", [(0, 0.2), (1, 0.3)]),
        (MSO_SHAPE.RIGHT_ARROW, "arrow-wide-head", [(0, 0.1), (1, 0.6)]),
        # star 5-point: inner radius
        (MSO_SHAPE.STAR_5_POINT, "star5-thin", [(0, 0.15)]),
        (MSO_SHAPE.STAR_5_POINT, "star5-fat", [(0, 0.45)]),
        # donut: ring thickness
        (MSO_SHAPE.DONUT, "donut-thin-ring", [(0, 0.1)]),
        (MSO_SHAPE.DONUT, "donut-thick-ring", [(0, 0.45)]),
        # cross: arm thickness
        (MSO_SHAPE.CROSS, "cross-thin", [(0, 0.15)]),
        (MSO_SHAPE.CROSS, "cross-thick", [(0, 0.45)]),
        # trapezoid
        (MSO_SHAPE.TRAPEZOID, "trapezoid-narrow-top", [(0, 0.15)]),
        (MSO_SHAPE.TRAPEZOID, "trapezoid-wide-top", [(0, 0.45)]),
        # block arc
        (MSO_SHAPE.BLOCK_ARC, "block-arc-narrow", [(0, 0.1)]),
        (MSO_SHAPE.BLOCK_ARC, "block-arc-wide", [(0, 0.4)]),
        # folded corner
        (MSO_SHAPE.FOLDED_CORNER, "folded-corner-small", [(0, 0.1)]),
        (MSO_SHAPE.FOLDED_CORNER, "folded-corner-large", [(0, 0.4)]),
        # bevel
        (MSO_SHAPE.BEVEL, "bevel-thin", [(0, 0.05)]),
        (MSO_SHAPE.BEVEL, "bevel-thick", [(0, 0.35)]),
        # isosceles triangle: peak offset
        (MSO_SHAPE.ISOSCELES_TRIANGLE, "triangle-left-peak", [(0, 0.1)]),
        (MSO_SHAPE.ISOSCELES_TRIANGLE, "triangle-right-peak", [(0, 0.9)]),
        # pentagon
        (MSO_SHAPE.PENTAGON, "pentagon-shallow", [(0, 0.15)]),
        (MSO_SHAPE.PENTAGON, "pentagon-deep", [(0, 0.45)]),
        # can (cylinder): top ellipse height
        (MSO_SHAPE.CAN, "can-flat-top", [(0, 0.1)]),
        (MSO_SHAPE.CAN, "can-tall-top", [(0, 0.4)]),
        # heart
        (MSO_SHAPE.HEART, "heart-default", []),
        # moon
        (MSO_SHAPE.MOON, "moon-thin-crescent", [(0, 0.15)]),
        (MSO_SHAPE.MOON, "moon-wide-crescent", [(0, 0.7)]),
        # left brace
        (MSO_SHAPE.LEFT_BRACE, "left-brace-sharp", [(0, 0.05)]),
        (MSO_SHAPE.LEFT_BRACE, "left-brace-round", [(0, 0.3)]),
    ]

    for shape_type, slug, adjs in adj_configs:
        def _build(prs, _st=shape_type, _adjs=adjs):
            sld = prs.slides.add_slide(prs.slide_layouts[6])
            shp = sld.shapes.add_shape(_st, _emu(2), _emu(1), _emu(5), _emu(4))
            for idx, val in _adjs:
                try:
                    shp.adjustments[idx] = val
                except (IndexError, ValueError) as exc:
                    print(f"    WARN: adj[{idx}]={val} failed on {_st}: {exc}", flush=True)
        _add(slug, _build)

    return cases


# ---------------------------------------------------------------------------
# P2: Composite (multi-component) cases
# ---------------------------------------------------------------------------

def _build_composite_cases() -> list[CaseDef]:
    cases: list[CaseDef] = []
    seq = 0

    def _add(slug: str, build_fn, postprocess_fn=None):
        nonlocal seq
        seq += 1
        case = {
            "name": f"oracle-pypptx-composite-{seq:04d}-{slug}",
            "build_fn": build_fn,
        }
        if postprocess_fn is not None:
            case["postprocess_fn"] = postprocess_fn
        cases.append(case)

    def _style_shape_text(shp, text: str, size: int = 16, color=RGBColor(0xFF, 0xFF, 0xFF)):
        tf = shp.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = text
        p.alignment = PP_ALIGN.CENTER
        p.font.name = "Calibri"
        p.font.size = Pt(size)
        p.font.bold = True
        p.font.color.rgb = color

    # --- Two shapes side by side ---
    def _build_two_shapes(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        sld.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, _emu(1), _emu(1.5), _emu(4), _emu(3))
        sld.shapes.add_shape(MSO_SHAPE.OVAL, _emu(6.5), _emu(1.5), _emu(4), _emu(3))
    _add("two-shapes-side-by-side", _build_two_shapes)

    # --- Shape with text inside ---
    def _build_shape_with_text(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        shp = sld.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, _emu(2), _emu(1), _emu(6), _emu(4))
        tf = shp.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = "Text inside a rounded rectangle"
        p.alignment = PP_ALIGN.CENTER
        p.font.size = Pt(24)
        p.font.name = "Calibri"
        p.font.bold = True
    _add("shape-with-centered-text", _build_shape_with_text)

    # --- Shape + Textbox overlay ---
    def _build_shape_textbox_overlay(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        sld.shapes.add_shape(MSO_SHAPE.RECTANGLE, _emu(1.5), _emu(1), _emu(7), _emu(5))
        txbox = sld.shapes.add_textbox(_emu(2), _emu(2), _emu(6), _emu(3))
        tf = txbox.text_frame
        tf.word_wrap = True
        p1 = tf.paragraphs[0]
        p1.text = "Overlaid Title"
        p1.alignment = PP_ALIGN.CENTER
        p1.font.size = Pt(32)
        p1.font.bold = True
        p2 = tf.add_paragraph()
        p2.text = "Body text overlaid on a rectangle shape"
        p2.alignment = PP_ALIGN.CENTER
        p2.font.size = Pt(18)
    _add("shape-textbox-overlay", _build_shape_textbox_overlay)

    # --- Multiple shapes (grid) ---
    def _build_shape_grid(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        shapes = [MSO_SHAPE.RECTANGLE, MSO_SHAPE.OVAL, MSO_SHAPE.DIAMOND,
                  MSO_SHAPE.HEXAGON, MSO_SHAPE.STAR_5_POINT, MSO_SHAPE.HEART,
                  MSO_SHAPE.CROSS, MSO_SHAPE.RIGHT_ARROW, MSO_SHAPE.DONUT]
        for i, st in enumerate(shapes):
            row, col = divmod(i, 3)
            left = _emu(1 + col * 3.5)
            top = _emu(0.5 + row * 2.2)
            sld.shapes.add_shape(st, left, top, _emu(2.5), _emu(1.8))
    _add("shape-grid-3x3", _build_shape_grid)

    # --- Table + textbox ---
    def _build_table_textbox(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        # Title textbox
        txbox = sld.shapes.add_textbox(_emu(1), _emu(0.3), _emu(8), _emu(0.8))
        p = txbox.text_frame.paragraphs[0]
        p.text = "Quarterly Results"
        p.font.size = Pt(28)
        p.font.bold = True
        p.font.name = "Calibri"
        # Table
        tbl_shape = sld.shapes.add_table(4, 4, _emu(1), _emu(1.5), _emu(8), _emu(4))
        tbl = tbl_shape.table
        headers = ["Quarter", "Revenue", "Cost", "Profit"]
        data = [
            ["Q1", "$120K", "$85K", "$35K"],
            ["Q2", "$145K", "$92K", "$53K"],
            ["Q3", "$132K", "$88K", "$44K"],
        ]
        for j, h in enumerate(headers):
            cell = tbl.cell(0, j)
            cell.text = h
            for p in cell.text_frame.paragraphs:
                p.font.bold = True
                p.font.size = Pt(14)
        for i, row in enumerate(data):
            for j, val in enumerate(row):
                tbl.cell(i + 1, j).text = val
    _add("table-with-title", _build_table_textbox)

    # --- Chart + title textbox ---
    def _build_chart_title(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        txbox = sld.shapes.add_textbox(_emu(1), _emu(0.3), _emu(8), _emu(0.8))
        p = txbox.text_frame.paragraphs[0]
        p.text = "Sales Overview"
        p.font.size = Pt(28)
        p.font.bold = True
        chart_data = CategoryChartData()
        chart_data.categories = ["Q1", "Q2", "Q3", "Q4"]
        chart_data.add_series("Product A", (45, 52, 48, 61))
        chart_data.add_series("Product B", (32, 38, 41, 35))
        sld.shapes.add_chart(
            XL_CHART_TYPE.COLUMN_CLUSTERED,
            _emu(1), _emu(1.5), _emu(8), _emu(5),
            chart_data,
        )
    _add("chart-with-title", _build_chart_title)

    # --- Multiple textboxes with different styles ---
    def _build_multi_text(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        configs = [
            (_emu(0.5), _emu(0.5), _emu(4), _emu(2), "Arial", 20, True, PP_ALIGN.LEFT, "Left-aligned Arial Bold"),
            (_emu(5.5), _emu(0.5), _emu(5), _emu(2), "Georgia", 20, False, PP_ALIGN.RIGHT, "Right-aligned Georgia Italic"),
            (_emu(0.5), _emu(3), _emu(10), _emu(2), "Calibri", 16, False, PP_ALIGN.CENTER, "Centered Calibri — Lorem ipsum dolor sit amet, consectetur adipiscing elit."),
            (_emu(0.5), _emu(5.5), _emu(10), _emu(1.5), "Courier New", 14, False, PP_ALIGN.LEFT, "Monospace: code_sample = function(x) { return x * 2; }"),
        ]
        for left, top, w, h, font, size, bold, align, text in configs:
            txbox = sld.shapes.add_textbox(left, top, w, h)
            tf = txbox.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.text = text
            p.alignment = align
            p.font.name = font
            p.font.size = Pt(size)
            p.font.bold = bold
            if font == "Georgia":
                p.font.italic = True
    _add("multi-textbox-styles", _build_multi_text)

    # --- Two charts side by side ---
    def _build_two_charts(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd1 = CategoryChartData()
        cd1.categories = ["Jan", "Feb", "Mar"]
        cd1.add_series("Sales", (120, 135, 148))
        sld.shapes.add_chart(XL_CHART_TYPE.LINE, _emu(0.5), _emu(0.5), _emu(5.5), _emu(6), cd1)

        cd2 = CategoryChartData()
        cd2.categories = ["A", "B", "C", "D"]
        cd2.add_series("Share", (35, 25, 22, 18))
        sld.shapes.add_chart(XL_CHART_TYPE.PIE, _emu(6.5), _emu(0.5), _emu(5.5), _emu(6), cd2)
    _add("two-charts-line-pie", _build_two_charts)

    # --- Shapes with different fills + text ---
    def _build_colored_shapes_text(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        configs = [
            (MSO_SHAPE.ROUNDED_RECTANGLE, _emu(0.5), _emu(1), RGBColor(0x00, 0x70, 0xC0), "Blue Box"),
            (MSO_SHAPE.OVAL, _emu(4.5), _emu(1), RGBColor(0xFF, 0x40, 0x40), "Red Oval"),
            (MSO_SHAPE.HEXAGON, _emu(8.5), _emu(1), RGBColor(0x00, 0xB0, 0x50), "Green Hex"),
        ]
        for st, left, top, color, text in configs:
            shp = sld.shapes.add_shape(st, left, top, _emu(3.5), _emu(4))
            shp.fill.solid()
            shp.fill.fore_color.rgb = color
            tf = shp.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.CENTER
            run = p.add_run()
            run.text = text
            run.font.size = Pt(22)
            run.font.bold = True
            run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    _add("colored-shapes-with-text", _build_colored_shapes_text)

    # --- Table + chart + text ---
    def _build_dashboard(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        # Title
        txbox = sld.shapes.add_textbox(_emu(0.5), _emu(0.2), _emu(12), _emu(0.7))
        p = txbox.text_frame.paragraphs[0]
        p.text = "Dashboard: Monthly KPIs"
        p.font.size = Pt(28)
        p.font.bold = True
        p.alignment = PP_ALIGN.CENTER
        # Small table (left)
        tbl_shape = sld.shapes.add_table(3, 2, _emu(0.5), _emu(1.2), _emu(4), _emu(2.5))
        tbl = tbl_shape.table
        for j, h in enumerate(["Metric", "Value"]):
            tbl.cell(0, j).text = h
        tbl.cell(1, 0).text = "Users"
        tbl.cell(1, 1).text = "12,450"
        tbl.cell(2, 0).text = "Revenue"
        tbl.cell(2, 1).text = "$89K"
        # Chart (right)
        cd = CategoryChartData()
        cd.categories = ["Mon", "Tue", "Wed", "Thu", "Fri"]
        cd.add_series("Visits", (850, 920, 780, 1050, 990))
        sld.shapes.add_chart(
            XL_CHART_TYPE.COLUMN_CLUSTERED,
            _emu(5), _emu(1.2), _emu(7.5), _emu(5.5), cd,
        )
    _add("dashboard-table-chart", _build_dashboard)

    # --- Process flow with arrowed connectors and callouts ---
    def _build_process_flow_connectors(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        title = sld.shapes.add_textbox(_emu(0.5), _emu(0.25), _emu(12), _emu(0.5))
        p = title.text_frame.paragraphs[0]
        p.text = "Pipeline with connectors, labels, and callouts"
        p.font.size = Pt(24)
        p.font.bold = True
        p.alignment = PP_ALIGN.CENTER

        steps = [
            ("Ingest", 0x2F5597),
            ("Parse", 0x70AD47),
            ("Model", 0xFFC000),
            ("Render", 0xED7D31),
        ]
        boxes = []
        for idx, (label, color) in enumerate(steps):
            shp = sld.shapes.add_shape(
                MSO_SHAPE.ROUNDED_RECTANGLE,
                _emu(0.8 + idx * 3.1),
                _emu(2.2),
                _emu(2.2),
                _emu(1.0),
            )
            shp.fill.solid()
            shp.fill.fore_color.rgb = RGBColor((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF)
            shp.line.color.rgb = RGBColor(0x2F, 0x2F, 0x2F)
            _style_shape_text(shp, label, 18)
            boxes.append(shp)

        for idx in range(len(boxes) - 1):
            x1 = _emu(3.0 + idx * 3.1)
            x2 = _emu(3.85 + idx * 3.1)
            conn = sld.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, x1, _emu(2.7), x2, _emu(2.7))
            conn.line.width = Pt(2.25)
            conn.line.color.rgb = RGBColor(0x5B, 0x9B, 0xD5)

        callout = sld.shapes.add_shape(MSO_SHAPE.CLOUD_CALLOUT, _emu(4.3), _emu(4.2), _emu(4.5), _emu(1.3))
        callout.fill.solid()
        callout.fill.fore_color.rgb = RGBColor(0xFF, 0xF2, 0xCC)
        callout.line.color.rgb = RGBColor(0xBF, 0x90, 0x00)
        _style_shape_text(callout, "Connectors should stay stroke-only with arrowheads", 14, RGBColor(0, 0, 0))
    _add("process-flow-connectors", _build_process_flow_connectors, _patch_connector_tail_arrows)

    # --- Merged table with adjacent callouts and direct cell styling ---
    def _build_merged_table_callouts(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        tbl_shape = sld.shapes.add_table(5, 4, _emu(0.8), _emu(1.0), _emu(7.2), _emu(4.7))
        tbl = tbl_shape.table
        tbl.cell(0, 0).merge(tbl.cell(0, 3))
        tbl.cell(0, 0).text = "Merged table header"
        for p in tbl.cell(0, 0).text_frame.paragraphs:
            p.font.bold = True
            p.font.size = Pt(16)
            p.alignment = PP_ALIGN.CENTER
        for r in range(1, 5):
            tbl.cell(r, 0).text = f"Phase {r}"
            tbl.cell(r, 1).text = f"{70 + r * 4}%"
            tbl.cell(r, 2).text = "OK" if r % 2 else "Review"
            tbl.cell(r, 3).text = f"T+{r}"
        tbl.cell(2, 2).merge(tbl.cell(3, 2))
        tbl.cell(2, 2).text = "Merged\nstatus"

        for col, color in [(0, RGBColor(0xD9, 0xE2, 0xF3)), (3, RGBColor(0xE2, 0xF0, 0xD9))]:
            for r in range(1, 5):
                cell = tbl.cell(r, col)
                cell.fill.solid()
                cell.fill.fore_color.rgb = color

        note = sld.shapes.add_shape(MSO_SHAPE.LINE_CALLOUT_2, _emu(8.4), _emu(1.35), _emu(3.8), _emu(2.2))
        note.fill.solid()
        note.fill.fore_color.rgb = RGBColor(0xF2, 0xF2, 0xF2)
        note.line.color.rgb = RGBColor(0x7F, 0x7F, 0x7F)
        _style_shape_text(note, "Merged cells plus callout geometry", 14, RGBColor(0, 0, 0))
    _add("merged-table-callouts", _build_merged_table_callouts)

    # --- Rotated text and shapes mixed with curved connectors ---
    def _build_rotated_text_and_shapes(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        left = sld.shapes.add_shape(MSO_SHAPE.TRAPEZOID, _emu(1.0), _emu(1.1), _emu(3.2), _emu(1.7))
        left.rotation = -12
        left.fill.solid()
        left.fill.fore_color.rgb = RGBColor(0x44, 0x72, 0xC4)
        _style_shape_text(left, "Rotated shape", 18)

        middle = sld.shapes.add_textbox(_emu(4.7), _emu(0.9), _emu(2.2), _emu(3.1))
        middle.rotation = 90
        p = middle.text_frame.paragraphs[0]
        p.text = "Vertical rotated label"
        p.font.size = Pt(20)
        p.font.bold = True
        p.alignment = PP_ALIGN.CENTER

        right = sld.shapes.add_shape(MSO_SHAPE.CAN, _emu(8.2), _emu(1.2), _emu(3.2), _emu(2.3))
        right.rotation = 18
        right.fill.solid()
        right.fill.fore_color.rgb = RGBColor(0x70, 0xAD, 0x47)
        _style_shape_text(right, "Cylinder", 18)

        conn = sld.shapes.add_connector(MSO_CONNECTOR.CURVE, _emu(3.9), _emu(4.6), _emu(9.8), _emu(4.6))
        conn.line.width = Pt(3)
        conn.line.dash_style = MSO_LINE_DASH_STYLE.DASH
        conn.line.color.rgb = RGBColor(0xED, 0x7D, 0x31)
    _add("rotated-text-and-shapes", _build_rotated_text_and_shapes, _patch_connector_tail_arrows)

    # --- Chart + table + shape callout overlay ---
    def _build_chart_table_callout_overlay(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        chart_data = CategoryChartData()
        chart_data.categories = ["North", "South", "East", "West"]
        chart_data.add_series("Actual", (42, 58, 49, 66))
        chart_data.add_series("Plan", (50, 55, 52, 60))
        sld.shapes.add_chart(
            XL_CHART_TYPE.COLUMN_CLUSTERED,
            _emu(0.7),
            _emu(0.8),
            _emu(7.1),
            _emu(4.6),
            chart_data,
        )

        tbl_shape = sld.shapes.add_table(3, 2, _emu(8.2), _emu(1.0), _emu(3.9), _emu(1.8))
        tbl = tbl_shape.table
        tbl.cell(0, 0).text = "Metric"
        tbl.cell(0, 1).text = "Value"
        tbl.cell(1, 0).text = "Delta"
        tbl.cell(1, 1).text = "+8%"
        tbl.cell(2, 0).text = "Risk"
        tbl.cell(2, 1).text = "Low"

        callout = sld.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, _emu(8.1), _emu(3.25), _emu(4.0), _emu(1.55))
        callout.fill.solid()
        callout.fill.fore_color.rgb = RGBColor(0x1F, 0x4E, 0x79)
        callout.line.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        _style_shape_text(callout, "Overlay label should not hide chart/table text", 14)
    _add("chart-table-callout-overlay", _build_chart_table_callout_overlay)

    # --- Translucent overlapping shapes with foreground labels ---
    def _build_layered_transparent_shapes(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        palette = [
            (MSO_SHAPE.OVAL, _emu(1.4), _emu(1.1), RGBColor(0x44, 0x72, 0xC4), "Alpha Layer Blue"),
            (MSO_SHAPE.OVAL, _emu(3.2), _emu(1.1), RGBColor(0xED, 0x7D, 0x31), "Alpha Layer Orange"),
            (MSO_SHAPE.OVAL, _emu(2.3), _emu(2.7), RGBColor(0x70, 0xAD, 0x47), "Alpha Layer Green"),
        ]
        for st, left, top, color, name in palette:
            shp = sld.shapes.add_shape(st, left, top, _emu(3.2), _emu(2.4))
            shp.name = name
            shp.fill.solid()
            shp.fill.fore_color.rgb = color
            shp.line.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        label = sld.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, _emu(6.8), _emu(2.0), _emu(4.6), _emu(1.4))
        label.fill.solid()
        label.fill.fore_color.rgb = RGBColor(0x26, 0x26, 0x26)
        _style_shape_text(label, "Alpha overlap + z-order + foreground text", 15)
    _add("layered-transparent-shapes", _build_layered_transparent_shapes, _patch_layered_transparency_case)

    # --- Dense CJK bullet cards with mixed paragraph levels ---
    def _build_dense_cjk_bullet_cards(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cards = [
            ("知识采集", ["多源接入", "权限继承", "增量同步"]),
            ("智能解析", ["版式识别", "表格抽取", "图片理解"]),
            ("精准检索", ["语义召回", "重排优化", "引用追踪"]),
            ("安全应用", ["租户隔离", "审计留痕", "策略管控"]),
        ]
        for idx, (title, bullets) in enumerate(cards):
            row, col = divmod(idx, 2)
            card = sld.shapes.add_shape(
                MSO_SHAPE.ROUNDED_RECTANGLE,
                _emu(0.8 + col * 6.1),
                _emu(0.8 + row * 3.0),
                _emu(5.4),
                _emu(2.3),
            )
            card.fill.solid()
            card.fill.fore_color.rgb = RGBColor(0xF8, 0xF9, 0xFB)
            card.line.color.rgb = RGBColor(0xB4, 0xC7, 0xE7)
            tf = card.text_frame
            tf.word_wrap = True
            p0 = tf.paragraphs[0]
            p0.text = title
            p0.font.name = "Microsoft YaHei"
            p0.font.size = Pt(17)
            p0.font.bold = True
            for bullet in bullets:
                p = tf.add_paragraph()
                p.text = bullet
                p.level = 1
                p.font.name = "Microsoft YaHei"
                p.font.size = Pt(12)
    _add("dense-cjk-bullet-cards", _build_dense_cjk_bullet_cards)

    # --- Valid grouped diagram with non-identity child coordinate space ---
    def _build_scaled_group_diagram(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        title = sld.shapes.add_textbox(_emu(0.8), _emu(0.35), _emu(10.5), _emu(0.5))
        p = title.text_frame.paragraphs[0]
        p.text = "Scaled group diagram"
        p.font.size = Pt(24)
        p.font.bold = True
    _add("scaled-group-diagram", _build_scaled_group_diagram, _patch_scaled_group_diagram_case)

    # --- Vertical side label next to a dense table ---
    def _build_vertical_text_with_table(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        side = sld.shapes.add_textbox(_emu(0.45), _emu(1.0), _emu(0.8), _emu(5.2))
        body_pr = side.text_frame._txBody.find(qn("a:bodyPr"))
        body_pr.set("vert", "eaVert")
        p = side.text_frame.paragraphs[0]
        p.text = "纵向标签"
        p.font.name = "Microsoft YaHei"
        p.font.size = Pt(22)
        p.font.bold = True

        tbl_shape = sld.shapes.add_table(6, 5, _emu(1.6), _emu(0.9), _emu(10.5), _emu(5.5))
        tbl = tbl_shape.table
        headers = ["能力", "输入", "处理", "输出", "状态"]
        for c, header in enumerate(headers):
            tbl.cell(0, c).text = header
        for r in range(1, 6):
            tbl.cell(r, 0).text = f"模块 {r}"
            tbl.cell(r, 1).text = "PPTX/XML"
            tbl.cell(r, 2).text = "解析 + 渲染"
            tbl.cell(r, 3).text = "HTML/SVG"
            tbl.cell(r, 4).text = "覆盖"
    _add("vertical-text-with-table", _build_vertical_text_with_table)

    # --- Mixed straight, elbow, curve connectors with dash styles ---
    def _build_mixed_dash_connectors(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        coords = [(1.0, 1.0), (5.2, 1.0), (9.2, 1.0), (5.2, 4.5)]
        labels = ["Source", "Transform", "Decision", "Output"]
        for (x, y), label in zip(coords, labels):
            shp = sld.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, _emu(x), _emu(y), _emu(2.2), _emu(0.9))
            shp.fill.solid()
            shp.fill.fore_color.rgb = RGBColor(0xDA, 0xE8, 0xFC)
            shp.line.color.rgb = RGBColor(0x6C, 0x8E, 0xB5)
            _style_shape_text(shp, label, 14, RGBColor(0, 0, 0))
        connectors = [
            (MSO_CONNECTOR.STRAIGHT, 3.2, 1.45, 5.2, 1.45, MSO_LINE_DASH_STYLE.SOLID),
            (MSO_CONNECTOR.ELBOW, 7.4, 1.45, 9.2, 1.45, MSO_LINE_DASH_STYLE.DASH),
            (MSO_CONNECTOR.CURVE, 6.3, 1.9, 6.3, 4.5, MSO_LINE_DASH_STYLE.DASH_DOT),
        ]
        for ctype, x1, y1, x2, y2, dash in connectors:
            conn = sld.shapes.add_connector(ctype, _emu(x1), _emu(y1), _emu(x2), _emu(y2))
            conn.line.width = Pt(2.25)
            conn.line.dash_style = dash
            conn.line.color.rgb = RGBColor(0xC0, 0x00, 0x00)
    _add("mixed-dash-connectors", _build_mixed_dash_connectors, _patch_connector_tail_arrows)

    # --- Compact report mixing chart, table, connectors, callouts, and CJK text ---
    def _build_mini_report_all_systems(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        title = sld.shapes.add_textbox(_emu(0.5), _emu(0.2), _emu(12.3), _emu(0.55))
        p = title.text_frame.paragraphs[0]
        p.text = "Mini report: text, table, chart, shapes, and connectors"
        p.font.size = Pt(22)
        p.font.bold = True
        p.alignment = PP_ALIGN.CENTER

        chart_data = CategoryChartData()
        chart_data.categories = ["T1", "T2", "T3"]
        chart_data.add_series("Pass", (88, 92, 95))
        chart_data.add_series("Fail", (12, 8, 5))
        sld.shapes.add_chart(XL_CHART_TYPE.BAR_STACKED, _emu(0.7), _emu(1.0), _emu(5.5), _emu(3.8), chart_data)

        tbl_shape = sld.shapes.add_table(4, 3, _emu(6.7), _emu(1.0), _emu(5.7), _emu(2.4))
        tbl = tbl_shape.table
        for c, header in enumerate(["Area", "Risk", "Owner"]):
            tbl.cell(0, c).text = header
        for r, row in enumerate([("Text", "Low", "A"), ("Chart", "Med", "B"), ("Group", "High", "C")], 1):
            for c, value in enumerate(row):
                tbl.cell(r, c).text = value

        alert = sld.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, _emu(6.9), _emu(4.35), _emu(2.8), _emu(0.85))
        alert.fill.solid()
        alert.fill.fore_color.rgb = RGBColor(0xC0, 0x00, 0x00)
        _style_shape_text(alert, "Review", 15)

        cjk = sld.shapes.add_textbox(_emu(9.9), _emu(4.05), _emu(2.5), _emu(1.35))
        tf = cjk.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = "组合场景覆盖"
        p.font.name = "Microsoft YaHei"
        p.font.size = Pt(18)
        p.font.bold = True

        conn = sld.shapes.add_connector(MSO_CONNECTOR.ELBOW, _emu(6.2), _emu(3.0), _emu(7.2), _emu(4.35))
        conn.line.width = Pt(2)
        conn.line.color.rgb = RGBColor(0x70, 0xAD, 0x47)
    _add("mini-report-all-systems", _build_mini_report_all_systems, _patch_connector_tail_arrows)

    return cases


# ---------------------------------------------------------------------------
# P3: Chart data variants (2D types only — ECharts renderable)
# ---------------------------------------------------------------------------

def _build_chart_cases() -> list[CaseDef]:
    cases: list[CaseDef] = []
    seq = 0

    def _add(slug: str, build_fn):
        nonlocal seq
        seq += 1
        cases.append({
            "name": f"oracle-pypptx-chart-{seq:04d}-{slug}",
            "build_fn": build_fn,
        })

    # --- Column/Bar variants ---
    def _build_col_multi_series(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Q1", "Q2", "Q3", "Q4"]
        cd.add_series("Product A", (45, 52, 48, 61))
        cd.add_series("Product B", (32, 38, 41, 35))
        cd.add_series("Product C", (28, 31, 36, 42))
        sld.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("column-clustered-3series", _build_col_multi_series)

    def _build_col_negative(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
        cd.add_series("Profit/Loss", (15, -8, 22, -12, 5, -3))
        sld.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("column-negative-values", _build_col_negative)

    def _build_col_stacked(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["2021", "2022", "2023", "2024"]
        cd.add_series("Hardware", (120, 135, 142, 158))
        cd.add_series("Software", (85, 102, 118, 131))
        cd.add_series("Services", (45, 52, 68, 79))
        sld.shapes.add_chart(XL_CHART_TYPE.COLUMN_STACKED, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("column-stacked-3series", _build_col_stacked)

    def _build_col_100_stacked(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["A", "B", "C"]
        cd.add_series("X", (30, 40, 25))
        cd.add_series("Y", (50, 35, 45))
        cd.add_series("Z", (20, 25, 30))
        sld.shapes.add_chart(XL_CHART_TYPE.COLUMN_STACKED_100, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("column-100-stacked", _build_col_100_stacked)

    def _build_bar_clustered(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Engineering", "Sales", "Marketing", "Support", "HR"]
        cd.add_series("Headcount", (45, 32, 18, 25, 8))
        sld.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("bar-clustered-single", _build_bar_clustered)

    def _build_bar_stacked(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Dept A", "Dept B", "Dept C"]
        cd.add_series("FY23", (120, 95, 80))
        cd.add_series("FY24", (135, 110, 92))
        sld.shapes.add_chart(XL_CHART_TYPE.BAR_STACKED, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("bar-stacked-2series", _build_bar_stacked)

    # --- Line variants ---
    def _build_line_multi(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
        cd.add_series("Website", (1200, 1350, 1100, 1450, 1380, 1520))
        cd.add_series("Mobile", (800, 920, 850, 1050, 1100, 1180))
        cd.add_series("API", (300, 350, 380, 420, 460, 510))
        sld.shapes.add_chart(XL_CHART_TYPE.LINE, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("line-3series", _build_line_multi)

    def _build_line_markers(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"]
        cd.add_series("Actual", (82, 85, 79, 91, 88, 94, 87, 96))
        cd.add_series("Target", (85, 85, 85, 85, 90, 90, 90, 90))
        sld.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("line-with-markers", _build_line_markers)

    def _build_line_stacked(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Mon", "Tue", "Wed", "Thu", "Fri"]
        cd.add_series("Email", (120, 132, 101, 134, 90))
        cd.add_series("Chat", (220, 182, 191, 234, 290))
        sld.shapes.add_chart(XL_CHART_TYPE.LINE_STACKED, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("line-stacked", _build_line_stacked)

    # --- Pie / Doughnut ---
    def _build_pie_many(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Chrome", "Safari", "Firefox", "Edge", "Other"]
        cd.add_series("Browser Share", (64, 19, 4, 5, 8))
        sld.shapes.add_chart(XL_CHART_TYPE.PIE, _emu(2), _emu(0.5), _emu(8), _emu(6), cd)
    _add("pie-5-categories", _build_pie_many)

    def _build_pie_exploded(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["A", "B", "C", "D"]
        cd.add_series("Sales", (40, 25, 20, 15))
        sld.shapes.add_chart(XL_CHART_TYPE.PIE_EXPLODED, _emu(2), _emu(0.5), _emu(8), _emu(6), cd)
    _add("pie-exploded", _build_pie_exploded)

    def _build_doughnut(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Complete", "In Progress", "Not Started"]
        cd.add_series("Status", (65, 20, 15))
        sld.shapes.add_chart(XL_CHART_TYPE.DOUGHNUT, _emu(2), _emu(0.5), _emu(8), _emu(6), cd)
    _add("doughnut-3-categories", _build_doughnut)

    def _build_doughnut_exploded(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["A", "B", "C"]
        cd.add_series("Values", (50, 30, 20))
        sld.shapes.add_chart(XL_CHART_TYPE.DOUGHNUT_EXPLODED, _emu(2), _emu(0.5), _emu(8), _emu(6), cd)
    _add("doughnut-exploded", _build_doughnut_exploded)

    # --- Area ---
    def _build_area(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["2020", "2021", "2022", "2023", "2024"]
        cd.add_series("Revenue", (80, 95, 110, 125, 148))
        cd.add_series("Cost", (60, 68, 75, 82, 91))
        sld.shapes.add_chart(XL_CHART_TYPE.AREA, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("area-2series", _build_area)

    def _build_area_stacked(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Q1", "Q2", "Q3", "Q4"]
        cd.add_series("Product", (45, 52, 48, 55))
        cd.add_series("Service", (30, 35, 42, 38))
        cd.add_series("Support", (15, 18, 20, 22))
        sld.shapes.add_chart(XL_CHART_TYPE.AREA_STACKED, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("area-stacked-3series", _build_area_stacked)

    # --- Scatter ---
    def _build_scatter(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = XyChartData()
        s1 = cd.add_series("Cluster A")
        for x, y in [(1.2, 3.1), (2.4, 4.2), (3.1, 2.8), (1.8, 3.6), (2.9, 4.8)]:
            s1.add_data_point(x, y)
        s2 = cd.add_series("Cluster B")
        for x, y in [(5.1, 1.2), (6.3, 2.1), (5.8, 1.8), (7.1, 2.5), (6.0, 0.9)]:
            s2.add_data_point(x, y)
        sld.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("scatter-2-clusters", _build_scatter)

    def _build_scatter_smooth(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = XyChartData()
        s = cd.add_series("Curve")
        for i in range(20):
            x = i * 0.5
            y = math.sin(x) * 3 + 5
            s.add_data_point(x, y)
        sld.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER_SMOOTH, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("scatter-smooth-sine", _build_scatter_smooth)

    # --- Radar ---
    def _build_radar(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Speed", "Power", "Agility", "Defense", "Stamina"]
        cd.add_series("Player A", (85, 70, 90, 65, 75))
        cd.add_series("Player B", (70, 85, 65, 80, 90))
        sld.shapes.add_chart(XL_CHART_TYPE.RADAR, _emu(2), _emu(0.5), _emu(8), _emu(6), cd)
    _add("radar-2series", _build_radar)

    def _build_radar_filled(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = ["Math", "Science", "English", "History", "Art"]
        cd.add_series("Student", (92, 85, 78, 88, 95))
        sld.shapes.add_chart(XL_CHART_TYPE.RADAR_FILLED, _emu(2), _emu(0.5), _emu(8), _emu(6), cd)
    _add("radar-filled-single", _build_radar_filled)

    # --- Bubble ---
    def _build_bubble(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = BubbleChartData()
        s = cd.add_series("Markets")
        s.add_data_point(1.5, 2.5, 10)
        s.add_data_point(3.0, 4.0, 25)
        s.add_data_point(5.0, 1.5, 15)
        s.add_data_point(2.5, 3.5, 30)
        sld.shapes.add_chart(XL_CHART_TYPE.BUBBLE, _emu(1), _emu(0.5), _emu(10), _emu(6), cd)
    _add("bubble-4-points", _build_bubble)

    # --- Large dataset ---
    def _build_line_large(prs):
        sld = prs.slides.add_slide(prs.slide_layouts[6])
        cd = CategoryChartData()
        cd.categories = [str(i) for i in range(1, 25)]
        random.seed(42)
        base = 100
        vals = []
        for _ in range(24):
            base += random.randint(-10, 15)
            vals.append(base)
        cd.add_series("Monthly Trend", vals)
        sld.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, _emu(0.5), _emu(0.5), _emu(11), _emu(6), cd)
    _add("line-24-month-trend", _build_line_large)

    return cases


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def _build_all_case_defs() -> list[CaseDef]:
    all_cases: list[CaseDef] = []
    all_cases.extend(_build_text_cases())
    all_cases.extend(_build_shape_adj_cases())
    all_cases.extend(_build_composite_cases())
    all_cases.extend(_build_chart_cases())
    return all_cases


def _select_case_defs(case_defs: list[CaseDef], patterns: list[str] | None) -> list[CaseDef]:
    """Select case definitions by repeatable exact or shell-style glob patterns."""
    if not patterns:
        return list(case_defs)
    return [
        case_def
        for case_def in case_defs
        if any(fnmatch.fnmatchcase(case_def["name"], pattern) for pattern in patterns)
    ]


def _file_fingerprint(path: Path) -> dict | None:
    if not path.exists() or not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"size_bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def _case_artifact_record(
    name: str,
    status: str,
    pptx_path: Path,
    pdf_path: Path,
    slides_dir: Path,
) -> dict:
    pngs = []
    if slides_dir.is_dir():
        for png_path in sorted(slides_dir.glob("slide*.png")):
            if fingerprint := _file_fingerprint(png_path):
                pngs.append({"name": png_path.name, **fingerprint})
    return {
        "case": name,
        "status": status,
        "source_pptx": _file_fingerprint(pptx_path),
        "ground_truth_pdf": _file_fingerprint(pdf_path),
        "ground_truth_pngs": pngs,
    }


def _generate_pptx(case_def: CaseDef, output_path: str | Path) -> None:
    """Generate a single PPTX file using python-pptx."""
    output_path = Path(output_path)
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    case_def["build_fn"](prs)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(output_path))
    if postprocess_fn := case_def.get("postprocess_fn"):
        postprocess_fn(output_path)


def _write_case_json(case_def: CaseDef, cases_dir: Path) -> Path:
    """Write a minimal case JSON for eval script discovery."""
    name = case_def["name"]
    payload = {
        "name": name,
        "generator": "python-pptx",
        "slides": [{"nodes": [{"kind": "pypptx-generated"}]}],
    }
    if coverage := case_def.get("coverage"):
        payload["coverage"] = coverage
    out = cases_dir / f"{name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate ground truth cases using python-pptx + PowerPoint PDF export.",
    )
    parser.add_argument("--cases-dir", type=Path, default=CASES_DIR)
    parser.add_argument("--testdata-dir", type=Path, default=TESTDATA_DIR)
    parser.add_argument("--report-path", type=Path, default=REPORT_PATH)
    parser.add_argument("--pptx-only", action="store_true",
                        help="Only generate PPTX files (skip PDF export). Works on any platform.")
    parser.add_argument("--export-png", action="store_true", default=True,
                        help="Export each slide as PNG (default: enabled, Windows only).")
    parser.add_argument("--no-export-png", action="store_false", dest="export_png",
                        help="Skip PNG export.")
    parser.add_argument("--png-width", type=int, default=0, metavar="PX",
                        help="PNG export width in pixels (0 = PowerPoint default).")
    parser.add_argument("--png-height", type=int, default=0, metavar="PX",
                        help="PNG export height in pixels (0 = PowerPoint default).")
    parser.add_argument("--no-reuse", action="store_true",
                        help="Force regeneration even if files exist.")
    parser.add_argument(
        "--case",
        action="append",
        dest="case_patterns",
        default=[],
        metavar="PATTERN",
        help="Generate only matching case names; repeat for more exact/glob patterns.",
    )
    args = parser.parse_args()

    cases_dir = args.cases_dir.resolve()
    testdata_dir = args.testdata_dir.resolve()
    report_path = args.report_path.resolve()

    all_cases = _build_all_case_defs()
    selected_cases = _select_case_defs(all_cases, args.case_patterns)
    print(f"Total case definitions: {len(all_cases)}; selected: {len(selected_cases)}")
    if args.case_patterns and not selected_cases:
        print(f"ERROR: no cases matched: {args.case_patterns}", file=sys.stderr)
        return 2

    generated: list[str] = []
    failures: list[dict] = []
    artifacts: list[dict] = []
    skipped = 0

    do_png = args.export_png and not args.pptx_only and sys.platform == "win32"

    # Import ground truth export only if needed (per-case native PowerPoint session for stability).
    export_fn = None
    if not args.pptx_only:
        if sys.platform not in {"darwin", "win32"}:
            print(
                "ERROR: PDF export requires macOS or Windows with Microsoft PowerPoint. "
                "Use --pptx-only on other platforms.",
                file=sys.stderr,
            )
            return 1
        from oracle.powerpoint_oracle import export_pptx_ground_truth
        export_fn = export_pptx_ground_truth
        if args.export_png and sys.platform == "darwin":
            print("macOS PowerPoint export is PDF-only; skipping per-slide PNG export.")

    for i, case_def in enumerate(selected_cases, 1):
        name = case_def["name"]
        case_d = testdata_dir / "cases" / name
        pptx_path = case_d / "source.pptx"
        pdf_path = case_d / "ground-truth.pdf"
        slides_d = case_d / "slides"

        # Keep the tracked case index aligned even when ignored binary ground truth is reused.
        _write_case_json(case_def, cases_dir)

        # Reuse check
        if not args.no_reuse:
            if args.pptx_only and pptx_path.exists():
                skipped += 1
                artifacts.append(
                    _case_artifact_record(name, "reused", pptx_path, pdf_path, slides_d)
                )
                continue
            if not args.pptx_only and pptx_path.exists() and pdf_path.exists():
                # If PNG export requested but slide1.png missing, regenerate
                if do_png and not (slides_d / "slide1.png").exists():
                    pass  # fall through
                else:
                    skipped += 1
                    artifacts.append(
                        _case_artifact_record(name, "reused", pptx_path, pdf_path, slides_d)
                    )
                    continue

        print(f"  [{i}/{len(selected_cases)}] {name} ...", end=" ", flush=True)

        try:
            # Generate PPTX via python-pptx
            _generate_pptx(case_def, pptx_path)

            # Export PDF + PNG via independent PowerPoint COM session (one per case)
            if export_fn is not None:
                export_fn(
                    pptx_path, pdf_path,
                    slides_png_dir=slides_d if do_png else None,
                    png_width=args.png_width,
                    png_height=args.png_height,
                )

            generated.append(name)
            artifacts.append(
                _case_artifact_record(name, "generated", pptx_path, pdf_path, slides_d)
            )
            print("OK")
        except Exception as exc:
            failures.append({"case": name, "error": str(exc)})
            print(f"FAIL: {exc}")

    print(f"\nResults: {len(generated)} generated, {skipped} reused, {len(failures)} failed")

    report = {
        "generator": "python-pptx",
        "schema_version": 2,
        "platform": sys.platform,
        "pptx_only": args.pptx_only,
        "export_png": do_png,
        "png_width": args.png_width,
        "png_height": args.png_height,
        "total_definitions": len(all_cases),
        "selected_definitions": len(selected_cases),
        "case_patterns": args.case_patterns,
        "generated_count": len(generated),
        "skipped_reused": skipped,
        "failed_count": len(failures),
        "generated_cases": generated,
        "failed_cases": failures,
        "artifacts": artifacts,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Report: {report_path}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
