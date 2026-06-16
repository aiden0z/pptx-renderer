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
            first_slide_ms=12.3,
            render_ms=40.5,
            two_raf_ms=5.6,
            heap_used_bytes=4096,
            media_bytes=2048,
            media_count=2,
            blob_urls_created=3,
            blob_urls_revoked=3,
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
    assert (
        "| tiny | full | no | 2 | 12 | 1.0 KiB | 1.2 | 2.3 | 3.4 | 12.3 | 40.5 | 5.6 | "
        "4.0 KiB | 2.0 KiB | 3/3 | 300 | 2 |"
    ) in markdown


def test_results_to_json_payload_is_stable_and_records_source_paths(tmp_path: Path) -> None:
    source = tmp_path / "source.pptx"
    source.write_bytes(b"pptx")
    results = [
        BenchmarkResult(
            case_name="tiny",
            strategy="windowed",
            lazy_media=True,
            bytes=4,
            slides=1,
            nodes=3,
            fetch_ms=0.1,
            parse_ms=0.2,
            build_ms=0.3,
            first_slide_ms=0.35,
            render_ms=0.4,
            two_raf_ms=0.5,
            heap_used_bytes=1234,
            media_bytes=4321,
            media_count=2,
            blob_urls_created=4,
            blob_urls_revoked=3,
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
    assert payload["results"][0]["lazyMedia"] is True
    assert payload["results"][0]["firstSlideMs"] == 0.35
    assert payload["results"][0]["heapUsedBytes"] == 1234
    assert payload["results"][0]["mediaBytes"] == 4321
    assert payload["results"][0]["mediaCount"] == 2
    assert payload["results"][0]["blobUrlsCreated"] == 4
    assert payload["results"][0]["blobUrlsRevoked"] == 3
    assert payload["results"][0]["renderMs"] == 0.4


def test_compare_results_reports_render_delta_percent() -> None:
    before = [
        BenchmarkResult(
            case_name="tiny",
            strategy="full",
            first_slide_ms=100.0,
            render_ms=200.0,
            heap_used_bytes=4096,
            element_count=1000,
        ),
        BenchmarkResult(
            case_name="tiny",
            strategy="windowed",
            first_slide_ms=25.0,
            render_ms=50.0,
            heap_used_bytes=2048,
            element_count=100,
        ),
    ]
    after = [
        BenchmarkResult(
            case_name="tiny",
            strategy="full",
            first_slide_ms=60.0,
            render_ms=150.0,
            heap_used_bytes=3072,
            element_count=700,
        ),
        BenchmarkResult(
            case_name="tiny",
            strategy="windowed",
            first_slide_ms=20.0,
            render_ms=40.0,
            heap_used_bytes=1024,
            element_count=90,
        ),
    ]

    rows = compare_results(before, after)

    assert rows == [
        {
            "caseName": "tiny",
            "strategy": "full",
            "beforeFirstSlideMs": 100.0,
            "afterFirstSlideMs": 60.0,
            "firstSlideDeltaMs": -40.0,
            "firstSlideDeltaPct": -40.0,
            "beforeRenderMs": 200.0,
            "afterRenderMs": 150.0,
            "renderDeltaMs": -50.0,
            "renderDeltaPct": -25.0,
            "beforeHeapUsedBytes": 4096,
            "afterHeapUsedBytes": 3072,
            "heapDeltaBytes": -1024,
            "beforeMediaBytes": 0,
            "afterMediaBytes": 0,
            "mediaDeltaBytes": 0,
            "beforeElementCount": 1000,
            "afterElementCount": 700,
            "elementDelta": -300,
        },
        {
            "caseName": "tiny",
            "strategy": "windowed",
            "beforeFirstSlideMs": 25.0,
            "afterFirstSlideMs": 20.0,
            "firstSlideDeltaMs": -5.0,
            "firstSlideDeltaPct": -20.0,
            "beforeRenderMs": 50.0,
            "afterRenderMs": 40.0,
            "renderDeltaMs": -10.0,
            "renderDeltaPct": -20.0,
            "beforeHeapUsedBytes": 2048,
            "afterHeapUsedBytes": 1024,
            "heapDeltaBytes": -1024,
            "beforeMediaBytes": 0,
            "afterMediaBytes": 0,
            "mediaDeltaBytes": 0,
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
            "beforeFirstSlideMs": 100.0,
            "afterFirstSlideMs": 60.0,
            "firstSlideDeltaMs": -40.0,
            "firstSlideDeltaPct": -40.0,
            "beforeRenderMs": 200.0,
            "afterRenderMs": 150.0,
            "renderDeltaMs": -50.0,
            "renderDeltaPct": -25.0,
            "beforeHeapUsedBytes": 4096,
            "afterHeapUsedBytes": 3072,
            "heapDeltaBytes": -1024,
            "beforeMediaBytes": 2048,
            "afterMediaBytes": 1024,
            "mediaDeltaBytes": -1024,
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
    assert (
        "| tiny | full | 100.0 | 60.0 | -40.0 | -40.0% | 200.0 | 150.0 | -50.0 | "
        "-25.0% | 4.0 KiB | 3.0 KiB | -1.0 KiB | 2.0 KiB | 1.0 KiB | -1.0 KiB | "
        "1000 | 700 | -300 |"
    ) in markdown
