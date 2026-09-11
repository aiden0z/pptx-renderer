from __future__ import annotations

import importlib.util
import sys
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


def test_cjk_text_layout_matrix_is_registered():
    generator = _load_generator_module()
    case_defs = generator._build_all_case_defs()
    text_names = [
        case["name"] for case in case_defs if case["name"].startswith("oracle-pypptx-text-")
    ]

    expected_names = {
        "oracle-pypptx-text-0040-cjk-wrap-square-no-autofit",
        "oracle-pypptx-text-0041-cjk-wrap-square-implicit-autofit",
        "oracle-pypptx-text-0042-cjk-wrap-none-no-autofit",
        "oracle-pypptx-text-0043-cjk-sp-autofit-narrow",
        "oracle-pypptx-text-0044-cjk-norm-autofit-scaled",
        "oracle-pypptx-text-0045-cjk-line-spacing-100pct",
        "oracle-pypptx-text-0046-cjk-line-spacing-130pct",
        "oracle-pypptx-text-0047-cjk-line-spacing-28pt",
        "oracle-pypptx-text-0048-cjk-paragraph-spacing-points",
        "oracle-pypptx-text-0049-cjk-paragraph-spacing-percent",
        "oracle-pypptx-text-0050-cjk-mixed-run-character-spacing",
        "oracle-pypptx-text-0051-cjk-rounded-shape-centered-spacing",
    }

    assert expected_names.issubset(text_names)
    assert len(text_names) == 51


def test_cjk_text_layout_matrix_serializes_autofit_and_spacing_ooxml(tmp_path: Path):
    generator = _load_generator_module()
    case_defs = generator._build_all_case_defs()
    wanted = {
        "oracle-pypptx-text-0040-cjk-wrap-square-no-autofit",
        "oracle-pypptx-text-0044-cjk-norm-autofit-scaled",
        "oracle-pypptx-text-0046-cjk-line-spacing-130pct",
        "oracle-pypptx-text-0049-cjk-paragraph-spacing-percent",
        "oracle-pypptx-text-0050-cjk-mixed-run-character-spacing",
        "oracle-pypptx-text-0051-cjk-rounded-shape-centered-spacing",
    }
    ns = {
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    }
    roots = {}

    for case in case_defs:
        if case["name"] not in wanted:
            continue
        pptx_path = tmp_path / case["name"] / "source.pptx"
        generator._generate_pptx(case, pptx_path)
        with ZipFile(pptx_path) as zf:
            roots[case["name"]] = etree.fromstring(zf.read("ppt/slides/slide1.xml"))

    no_autofit = roots["oracle-pypptx-text-0040-cjk-wrap-square-no-autofit"]
    assert no_autofit.xpath("boolean(.//a:bodyPr[@wrap='square']/a:noAutofit)", namespaces=ns)

    norm_autofit = roots["oracle-pypptx-text-0044-cjk-norm-autofit-scaled"]
    assert norm_autofit.xpath(
        "boolean(.//a:normAutofit[@fontScale='85000'][@lnSpcReduction='10000'])",
        namespaces=ns,
    )

    line_spacing = roots["oracle-pypptx-text-0046-cjk-line-spacing-130pct"]
    assert line_spacing.xpath(
        "boolean(.//a:pPr/a:lnSpc/a:spcPct[@val='130000'])",
        namespaces=ns,
    )
    assert len(line_spacing.xpath(".//a:p/a:br", namespaces=ns)) == 2
    assert all(
        "_x000B_" not in text
        for text in line_spacing.xpath(".//a:p/a:r/a:t/text()", namespaces=ns)
    )

    centered_shape = roots["oracle-pypptx-text-0051-cjk-rounded-shape-centered-spacing"]
    assert len(centered_shape.xpath(".//a:p/a:br", namespaces=ns)) == 2
    assert all(
        "_x000B_" not in text
        for text in centered_shape.xpath(".//a:p/a:r/a:t/text()", namespaces=ns)
    )

    paragraph_spacing = roots["oracle-pypptx-text-0049-cjk-paragraph-spacing-percent"]
    assert paragraph_spacing.xpath(
        "boolean(.//a:pPr/a:spcBef/a:spcPct[@val='30000'])",
        namespaces=ns,
    )
    assert paragraph_spacing.xpath(
        "boolean(.//a:pPr/a:spcAft/a:spcPct[@val='50000'])",
        namespaces=ns,
    )

    mixed_runs = roots["oracle-pypptx-text-0050-cjk-mixed-run-character-spacing"]
    assert mixed_runs.xpath("boolean(.//a:rPr[@spc='180'])", namespaces=ns)
    assert mixed_runs.xpath("boolean(.//a:rPr[@spc='-120'])", namespaces=ns)


def test_case_pattern_selection_supports_exact_and_glob_filters():
    generator = _load_generator_module()
    case_defs = generator._build_all_case_defs()

    selected = generator._select_case_defs(
        case_defs,
        [
            "oracle-pypptx-text-0045-cjk-line-spacing-100pct",
            "oracle-pypptx-text-004[89]-*",
        ],
    )

    assert [case["name"] for case in selected] == [
        "oracle-pypptx-text-0045-cjk-line-spacing-100pct",
        "oracle-pypptx-text-0048-cjk-paragraph-spacing-points",
        "oracle-pypptx-text-0049-cjk-paragraph-spacing-percent",
    ]


def test_case_artifact_record_fingerprints_pdf_and_slide_pngs(tmp_path: Path):
    generator = _load_generator_module()
    pptx_path = tmp_path / "source.pptx"
    pdf_path = tmp_path / "ground-truth.pdf"
    slides_dir = tmp_path / "slides"
    slides_dir.mkdir()
    pptx_path.write_bytes(b"pptx")
    pdf_path.write_bytes(b"pdf")
    (slides_dir / "slide2.png").write_bytes(b"png-2")
    (slides_dir / "slide1.png").write_bytes(b"png-1")

    record = generator._case_artifact_record(
        "sample",
        "generated",
        pptx_path,
        pdf_path,
        slides_dir,
    )

    assert record["source_pptx"]["sha256"]
    assert record["ground_truth_pdf"]["sha256"]
    assert [item["name"] for item in record["ground_truth_pngs"]] == [
        "slide1.png",
        "slide2.png",
    ]
    assert all(item["sha256"] for item in record["ground_truth_pngs"])


def test_generator_uses_one_shared_powerpoint_runtime_directory(
    tmp_path: Path,
    monkeypatch,
):
    generator = _load_generator_module()
    case = next(
        case
        for case in generator._build_all_case_defs()
        if case["name"] == "oracle-pypptx-text-0040-cjk-wrap-square-no-autofit"
    )
    captured = {}

    def fake_export(pptx_path, pdf_path, **kwargs):
        captured["runtime_dir"] = kwargs.get("runtime_dir")
        Path(pdf_path).write_bytes(b"%PDF-1.4\n")

    import oracle.powerpoint_oracle as powerpoint_oracle

    monkeypatch.setattr(generator, "_build_all_case_defs", lambda: [case])
    monkeypatch.setattr(powerpoint_oracle, "export_pptx_ground_truth", fake_export)

    cases_dir = tmp_path / "definitions"
    testdata_dir = tmp_path / "testdata"
    report_path = tmp_path / "report.json"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            str(GENERATOR_PATH),
            "--cases-dir",
            str(cases_dir),
            "--testdata-dir",
            str(testdata_dir),
            "--report-path",
            str(report_path),
            "--no-export-png",
            "--no-reuse",
        ],
    )

    assert generator.main() == 0
    assert captured["runtime_dir"] == (testdata_dir / "oracle-runtime").resolve()


def test_cjk_case_json_records_coverage_and_font_requirements(tmp_path: Path):
    generator = _load_generator_module()
    case = next(
        case
        for case in generator._build_all_case_defs()
        if case["name"] == "oracle-pypptx-text-0044-cjk-norm-autofit-scaled"
    )

    path = generator._write_case_json(case, tmp_path)
    payload = __import__("json").loads(path.read_text(encoding="utf-8"))

    assert payload["coverage"]["oracle"] == "native-powerpoint"
    assert payload["coverage"]["requiredFonts"] == ["Microsoft YaHei"]
    assert "bodyPr.normAutofit" in payload["coverage"]["features"]
    assert "normAutofit.fontScale=85000" in payload["coverage"]["features"]


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
