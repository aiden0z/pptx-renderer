"""
Extract structural ground truth from raw PPTX XML using zipfile + lxml.
No python-pptx dependency — reads the XML directly for maximum fidelity.
"""

import re
import zipfile
from pathlib import Path

from lxml import etree

from models import (
    CellData,
    NodeData,
    Position,
    PresentationStructure,
    RowData,
    Size,
    SlideData,
    TextBody,
    TextParagraph,
)

# ---------------------------------------------------------------------------
# Namespace map
# ---------------------------------------------------------------------------

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

# EMU to pixels at 96 DPI — matches TS emuToPx
EMU_PER_INCH = 914400
DPI = 96


def emu_to_px(emu: int | float) -> float:
    return (emu / EMU_PER_INCH) * DPI


def angle_to_deg(angle: int | float) -> float:
    return angle / 60000


# ---------------------------------------------------------------------------
# XML Helpers
# ---------------------------------------------------------------------------

def _find(el: etree._Element, xpath: str) -> etree._Element | None:
    return el.find(xpath, NS)


def _findall(el: etree._Element, xpath: str) -> list[etree._Element]:
    return el.findall(xpath, NS)


def _attr(el: etree._Element | None, name: str, default: str = "") -> str:
    if el is None:
        return default
    return el.get(name, default)


def _num_attr(el: etree._Element | None, name: str, default: float = 0) -> float:
    val = _attr(el, name, "")
    if val == "":
        return default
    try:
        return float(val)
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# Non-visual properties
# ---------------------------------------------------------------------------

_NV_WRAPPERS = [
    "p:nvSpPr", "p:nvPicPr", "p:nvGrpSpPr",
    "p:nvGraphicFramePr", "p:nvCxnSpPr",
]


def _get_cNvPr(el: etree._Element) -> etree._Element | None:
    for wrapper_tag in _NV_WRAPPERS:
        wrapper = _find(el, wrapper_tag)
        if wrapper is not None:
            return _find(wrapper, "p:cNvPr")
    return None


# ---------------------------------------------------------------------------
# Transform
# ---------------------------------------------------------------------------

def _get_xfrm(el: etree._Element) -> etree._Element | None:
    """Find xfrm in spPr, grpSpPr, or direct child."""
    for prop_tag in ["p:spPr", "p:grpSpPr"]:
        prop = _find(el, prop_tag)
        if prop is not None:
            xfrm = _find(prop, "a:xfrm")
            if xfrm is not None:
                return xfrm
    # Direct xfrm (graphicFrame)
    xfrm = _find(el, "p:xfrm")
    return xfrm


def _parse_position_size(xfrm: etree._Element | None) -> tuple[Position, Size]:
    if xfrm is None:
        return Position(), Size()
    off = _find(xfrm, "a:off")
    ext = _find(xfrm, "a:ext")
    pos = Position(
        x=emu_to_px(_num_attr(off, "x")),
        y=emu_to_px(_num_attr(off, "y")),
    )
    size = Size(
        w=emu_to_px(_num_attr(ext, "cx")),
        h=emu_to_px(_num_attr(ext, "cy")),
    )
    return pos, size


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

def _parse_text_body(txBody: etree._Element | None) -> TextBody | None:
    if txBody is None:
        return None
    paragraphs = []
    for p_el in _findall(txBody, "a:p"):
        pPr = _find(p_el, "a:pPr")
        level = int(_attr(pPr, "lvl", "0")) if pPr is not None else 0
        # Collect text from runs (a:r), line breaks (a:br), fields (a:fld)
        parts = []
        for child in p_el:
            tag = etree.QName(child).localname
            if tag == "r":
                t_el = _find(child, "a:t")
                if t_el is not None and t_el.text:
                    parts.append(t_el.text)
            elif tag == "br":
                parts.append("\n")
            elif tag == "fld":
                t_el = _find(child, "a:t")
                if t_el is not None and t_el.text:
                    parts.append(t_el.text)
        text = "".join(parts)
        paragraphs.append(TextParagraph(level=level, text=text))

    total_text = "\n".join(p.text for p in paragraphs)
    if not total_text.strip():
        return None
    return TextBody(paragraphs=paragraphs, total_text=total_text)


# ---------------------------------------------------------------------------
# Shape parsers
# ---------------------------------------------------------------------------

def _parse_base(el: etree._Element) -> dict:
    """Parse common base properties from a shape element."""
    cNvPr = _get_cNvPr(el)
    xfrm = _get_xfrm(el)
    pos, size = _parse_position_size(xfrm)
    rotation = angle_to_deg(_num_attr(xfrm, "rot")) if xfrm is not None else 0
    flip_h = _attr(xfrm, "flipH") in ("1", "true") if xfrm is not None else False
    flip_v = _attr(xfrm, "flipV") in ("1", "true") if xfrm is not None else False

    return dict(
        id=_attr(cNvPr, "id"),
        name=_attr(cNvPr, "name"),
        position=pos,
        size=size,
        rotation=rotation,
        flip_h=flip_h,
        flip_v=flip_v,
    )


def _parse_shape(el: etree._Element) -> NodeData:
    """Parse p:sp or p:cxnSp."""
    base = _parse_base(el)
    spPr = _find(el, "p:spPr")
    prstGeom = _find(spPr, "a:prstGeom") if spPr is not None else None
    preset = _attr(prstGeom, "prst") if prstGeom is not None else None

    txBody = _find(el, "p:txBody")
    text_body = _parse_text_body(txBody)

    return NodeData(
        **base,
        node_type="shape",
        preset_geometry=preset or None,
        text_body=text_body,
    )


def _parse_pic(el: etree._Element) -> NodeData:
    """Parse p:pic."""
    base = _parse_base(el)
    return NodeData(**base, node_type="picture")


def _parse_table(el: etree._Element) -> NodeData:
    """Parse p:graphicFrame containing a:tbl."""
    base = _parse_base(el)
    tbl = _find(el, "a:graphic/a:graphicData/a:tbl")
    if tbl is None:
        return NodeData(**base, node_type="table")

    # Columns
    tblGrid = _find(tbl, "a:tblGrid")
    columns = []
    if tblGrid is not None:
        for gc in _findall(tblGrid, "a:gridCol"):
            columns.append(emu_to_px(_num_attr(gc, "w")))

    # Rows
    rows = []
    for tr in _findall(tbl, "a:tr"):
        height = emu_to_px(_num_attr(tr, "h"))
        cells = []
        for tc in _findall(tr, "a:tc"):
            grid_span = int(_attr(tc, "gridSpan", "1"))
            row_span = int(_attr(tc, "rowSpan", "1"))
            txBody = _find(tc, "a:txBody")
            text_body = _parse_text_body(txBody)
            cell_text = text_body.total_text if text_body else ""
            cells.append(CellData(text=cell_text, grid_span=grid_span, row_span=row_span))
        rows.append(RowData(height=height, cells=cells))

    # Table style
    tblPr = _find(tbl, "a:tblPr")
    table_style_id = None
    if tblPr is not None:
        tsid = _find(tblPr, "a:tableStyleId")
        if tsid is not None and tsid.text:
            table_style_id = tsid.text
        else:
            tblStyle = _find(tblPr, "a:tblStyle")
            if tblStyle is not None:
                table_style_id = _attr(tblStyle, "val") or tblStyle.text or None
            else:
                table_style_id = _attr(tblPr, "tblStyle") or None

    return NodeData(
        **base,
        node_type="table",
        columns=columns,
        rows=rows,
        table_style_id=table_style_id,
    )


def _parse_group(el: etree._Element) -> NodeData:
    """Parse p:grpSp."""
    base = _parse_base(el)
    children = []
    for child in el:
        tag = etree.QName(child).localname
        node = _dispatch_child(child, tag)
        if node is not None:
            children.append(node)
    return NodeData(**base, node_type="group", children=children)


def _is_table_frame(el: etree._Element) -> bool:
    tbl = _find(el, "a:graphic/a:graphicData/a:tbl")
    return tbl is not None


def _dispatch_child(child: etree._Element, tag: str) -> NodeData | None:
    if tag in ("sp", "cxnSp"):
        return _parse_shape(child)
    elif tag == "pic":
        return _parse_pic(child)
    elif tag == "grpSp":
        return _parse_group(child)
    elif tag == "graphicFrame":
        if _is_table_frame(child):
            return _parse_table(child)
    return None


# ---------------------------------------------------------------------------
# Slide parser
# ---------------------------------------------------------------------------

def _parse_slide_xml(slide_xml: bytes, index: int) -> SlideData:
    """Parse a single slide XML file."""
    root = etree.fromstring(slide_xml)

    # Detect hidden slides (show="0" on p:sld element)
    hidden = root.get("show") == "0"

    cSld = _find(root, "p:cSld")
    if cSld is None:
        return SlideData(index=index, hidden=hidden)

    spTree = _find(cSld, "p:spTree")
    if spTree is None:
        return SlideData(index=index, hidden=hidden)

    nodes = []
    for child in spTree:
        tag = etree.QName(child).localname
        node = _dispatch_child(child, tag)
        if node is not None:
            nodes.append(node)

    return SlideData(index=index, nodes=nodes, hidden=hidden)


# ---------------------------------------------------------------------------
# Main extractor
# ---------------------------------------------------------------------------

def extract_ground_truth(pptx_path: str | Path) -> PresentationStructure:
    """
    Extract structural ground truth from a PPTX file.
    Uses zipfile + lxml to parse raw XML directly.
    """
    pptx_path = Path(pptx_path)
    with zipfile.ZipFile(pptx_path, "r") as zf:
        # --- Presentation dimensions and slide ordering ---
        pres_xml = zf.read("ppt/presentation.xml")
        pres_root = etree.fromstring(pres_xml)

        sldSz = _find(pres_root, "p:sldSz")
        width = emu_to_px(_num_attr(sldSz, "cx", 9144000))
        height = emu_to_px(_num_attr(sldSz, "cy", 6858000))

        # Read presentation rels to resolve slide ordering
        pres_rels_xml = zf.read("ppt/_rels/presentation.xml.rels")
        pres_rels_root = etree.fromstring(pres_rels_xml)

        # Build rId -> target map
        rid_to_target = {}
        for rel in pres_rels_root:
            rid = rel.get("Id", "")
            target = rel.get("Target", "")
            rel_type = rel.get("Type", "")
            if "slide" in rel_type.lower() and "slideLayout" not in rel_type and "slideMaster" not in rel_type:
                rid_to_target[rid] = target

        # Get slide order from sldIdLst
        sldIdLst = _find(pres_root, "p:sldIdLst")
        ordered_targets = []
        if sldIdLst is not None:
            for sldId in _findall(sldIdLst, "p:sldId"):
                rid = sldId.get(f"{{{NS['r']}}}id", "")
                if rid and rid in rid_to_target:
                    target = rid_to_target[rid]
                    # Normalize path
                    if not target.startswith("ppt/"):
                        target = "ppt/" + target.lstrip("/")
                    ordered_targets.append(target)

        # Fallback: sort by slide number
        if not ordered_targets:
            slide_files = sorted(
                rid_to_target.values(),
                key=lambda t: int(re.search(r"(\d+)", t).group(1)) if re.search(r"(\d+)", t) else 0,
            )
            for target in slide_files:
                if not target.startswith("ppt/"):
                    target = "ppt/" + target.lstrip("/")
                ordered_targets.append(target)

        # --- Parse each slide ---
        slides = []
        for i, target in enumerate(ordered_targets):
            try:
                slide_xml = zf.read(target)
                slide_data = _parse_slide_xml(slide_xml, i)
                slides.append(slide_data)
            except KeyError:
                # Slide file not found in zip
                slides.append(SlideData(index=i))

    return PresentationStructure(
        width=width,
        height=height,
        slide_count=len(slides),
        slides=slides,
    )
