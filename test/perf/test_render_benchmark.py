from pathlib import Path

from render_benchmark import (
    BenchmarkResult,
    build_comparison_markdown_report,
    build_markdown_report,
    compare_results,
    results_to_json_payload,
)


def test_build_markdown_report_groups_results_by_case_and_strategy() -> None:
    results = [
        BenchmarkResult(
            case_name="tiny",
            strategy="full",
            bytes=1024,
            slides=2,
            nodes=12,
            fetch_ms=1.2,
            parse_ms=2.3,
            build_ms=3.4,
            render_ms=40.5,
            two_raf_ms=5.6,
            element_count=300,
            list_items=2,
            mounted_slides=2,
            svg_count=20,
            path_count=21,
            img_count=3,
            canvas_count=0,
            text_spans=50,
        )
    ]

    markdown = build_markdown_report(results, server_url="http://127.0.0.1:5173")

    assert "# PPTX Renderer Performance Benchmark" in markdown
    assert "`http://127.0.0.1:5173`" in markdown
    assert "| tiny | full | 2 | 12 | 1.0 KiB | 1.2 | 2.3 | 3.4 | 40.5 | 5.6 | 300 | 2 |" in markdown


def test_results_to_json_payload_is_stable_and_records_source_paths(tmp_path: Path) -> None:
    source = tmp_path / "source.pptx"
    source.write_bytes(b"pptx")
    results = [
        BenchmarkResult(
            case_name="tiny",
            strategy="windowed",
            bytes=4,
            slides=1,
            nodes=3,
            fetch_ms=0.1,
            parse_ms=0.2,
            build_ms=0.3,
            render_ms=0.4,
            two_raf_ms=0.5,
            element_count=10,
            list_items=1,
            mounted_slides=1,
            svg_count=2,
            path_count=3,
            img_count=4,
            canvas_count=5,
            text_spans=6,
            source_path=str(source),
        )
    ]

    payload = results_to_json_payload(results, server_url="http://example.test")

    assert payload["serverUrl"] == "http://example.test"
    assert payload["results"][0]["caseName"] == "tiny"
    assert payload["results"][0]["sourcePath"] == str(source)
    assert payload["results"][0]["renderMs"] == 0.4


def test_compare_results_reports_render_delta_percent() -> None:
    before = [
        BenchmarkResult(case_name="tiny", strategy="full", render_ms=200.0, element_count=1000),
        BenchmarkResult(case_name="tiny", strategy="windowed", render_ms=50.0, element_count=100),
    ]
    after = [
        BenchmarkResult(case_name="tiny", strategy="full", render_ms=150.0, element_count=700),
        BenchmarkResult(case_name="tiny", strategy="windowed", render_ms=40.0, element_count=90),
    ]

    rows = compare_results(before, after)

    assert rows == [
        {
            "caseName": "tiny",
            "strategy": "full",
            "beforeRenderMs": 200.0,
            "afterRenderMs": 150.0,
            "renderDeltaMs": -50.0,
            "renderDeltaPct": -25.0,
            "beforeElementCount": 1000,
            "afterElementCount": 700,
            "elementDelta": -300,
        },
        {
            "caseName": "tiny",
            "strategy": "windowed",
            "beforeRenderMs": 50.0,
            "afterRenderMs": 40.0,
            "renderDeltaMs": -10.0,
            "renderDeltaPct": -20.0,
            "beforeElementCount": 100,
            "afterElementCount": 90,
            "elementDelta": -10,
        },
    ]


def test_build_comparison_markdown_report_renders_before_after_rows() -> None:
    rows = [
        {
            "caseName": "tiny",
            "strategy": "full",
            "beforeRenderMs": 200.0,
            "afterRenderMs": 150.0,
            "renderDeltaMs": -50.0,
            "renderDeltaPct": -25.0,
            "beforeElementCount": 1000,
            "afterElementCount": 700,
            "elementDelta": -300,
        }
    ]

    markdown = build_comparison_markdown_report(
        rows,
        before_label="baseline",
        after_label="optimized",
    )

    assert "# PPTX Renderer Performance Comparison" in markdown
    assert "- Before: `baseline`" in markdown
    assert "- After: `optimized`" in markdown
    assert "| tiny | full | 200.0 | 150.0 | -50.0 | -25.0% | 1000 | 700 | -300 |" in markdown
