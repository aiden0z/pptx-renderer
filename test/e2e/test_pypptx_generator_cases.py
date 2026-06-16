from __future__ import annotations

import importlib.util
from pathlib import Path
from zipfile import ZipFile

from lxml import etree


GENERATOR_PATH = Path(__file__).resolve().parent / "scripts" / "generate_pypptx_cases.py"


def _load_generator_module():
    spec = importlib.util.spec_from_file_location("generate_pypptx_cases", GENERATOR_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _placeholder_attrs(zf: ZipFile, part: str) -> list[dict[str, str]]:
    root = etree.fromstring(zf.read(part))
    ns = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
    return [dict(ph.attrib) for ph in root.xpath(".//p:ph", namespaces=ns)]


def test_placeholder_idx_inheritance_case_generates_idx_only_slide_placeholders(
    tmp_path: Path,
):
    generator = _load_generator_module()
    case_defs = generator._build_all_case_defs()
    case = next(
        c for c in case_defs if c["name"] == "oracle-pypptx-text-0039-placeholder-idx-inheritance"
    )
    pptx_path = tmp_path / "source.pptx"

    generator._generate_pptx(case, pptx_path)

    with ZipFile(pptx_path) as zf:
        slide_placeholders = _placeholder_attrs(zf, "ppt/slides/slide1.xml")
        layout_placeholders = _placeholder_attrs(zf, "ppt/slideLayouts/slideLayout2.xml")
        master_placeholders = _placeholder_attrs(zf, "ppt/slideMasters/slideMaster1.xml")

    assert {"idx": "0"} in slide_placeholders
    assert {"idx": "1"} in slide_placeholders
    assert {"type": "title", "idx": "0"} in layout_placeholders
    assert {"type": "body", "idx": "1"} in master_placeholders


def test_complex_composite_cases_are_registered():
    generator = _load_generator_module()
    case_defs = generator._build_all_case_defs()
    names = {case["name"] for case in case_defs}

    expected_names = {
        "oracle-pypptx-composite-0011-process-flow-connectors",
        "oracle-pypptx-composite-0012-merged-table-callouts",
        "oracle-pypptx-composite-0013-rotated-text-and-shapes",
        "oracle-pypptx-composite-0014-chart-table-callout-overlay",
        "oracle-pypptx-composite-0015-layered-transparent-shapes",
        "oracle-pypptx-composite-0016-dense-cjk-bullet-cards",
        "oracle-pypptx-composite-0017-scaled-group-diagram",
        "oracle-pypptx-composite-0018-vertical-text-with-table",
        "oracle-pypptx-composite-0019-mixed-dash-connectors",
        "oracle-pypptx-composite-0020-mini-report-all-systems",
    }
    composite_names = [name for name in names if name.startswith("oracle-pypptx-composite-")]

    assert expected_names.issubset(names)
    assert len(composite_names) >= 20


def test_scaled_group_composite_case_generates_non_identity_group_space(tmp_path: Path):
    generator = _load_generator_module()
    case_defs = generator._build_all_case_defs()
    case = next(c for c in case_defs if c["name"] == "oracle-pypptx-composite-0017-scaled-group-diagram")
    pptx_path = tmp_path / "source.pptx"

    generator._generate_pptx(case, pptx_path)

    with ZipFile(pptx_path) as zf:
        root = etree.fromstring(zf.read("ppt/slides/slide1.xml"))

    ns = {
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    }
    group_xfrm = root.xpath(".//p:grpSp/p:grpSpPr/a:xfrm", namespaces=ns)
    group_children = root.xpath(".//p:grpSp/p:sp", namespaces=ns)

    assert group_xfrm
    assert len(group_children) >= 3
    assert group_xfrm[0].xpath("a:ext/@cx", namespaces=ns) != group_xfrm[0].xpath(
        "a:chExt/@cx",
        namespaces=ns,
    )
    assert group_xfrm[0].xpath("a:ext/@cy", namespaces=ns) != group_xfrm[0].xpath(
        "a:chExt/@cy",
        namespaces=ns,
    )
