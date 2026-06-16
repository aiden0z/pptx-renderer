#!/usr/bin/env python3
"""Headless render benchmark for pptx-renderer.

The benchmark expects a Vite dev server serving this repository. Start one with:

    pnpm dev --host 127.0.0.1

Then run:

    test/e2e/.venv/bin/python3 test/perf/render_benchmark.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.request import urlopen

DEFAULT_CASES = ("opentelemetry", "ai-computing", "model-platform")
DEFAULT_STRATEGIES = ("full", "windowed")
DEFAULT_SERVER_URL = "http://127.0.0.1:5173"
DEFAULT_OUTPUT_DIR = Path("docs/agent-tmp/perf-baseline")


@dataclass
class BenchmarkResult:
    case_name: str = ""
    strategy: str = ""
    bytes: int = 0
    slides: int = 0
    nodes: int = 0
    fetch_ms: float = 0.0
    parse_ms: float = 0.0
    build_ms: float = 0.0
    render_ms: float = 0.0
    two_raf_ms: float = 0.0
    element_count: int = 0
    list_items: int = 0
    mounted_slides: int = 0
    svg_count: int = 0
    path_count: int = 0
    img_count: int = 0
    canvas_count: int = 0
    text_spans: int = 0
    source_path: str = ""

    @classmethod
    def from_browser_payload(cls, payload: dict[str, Any]) -> "BenchmarkResult":
        return cls(
            case_name=str(payload.get("caseName", "")),
            strategy=str(payload.get("strategy", "")),
            bytes=int(payload.get("bytes", 0)),
            slides=int(payload.get("slides", 0)),
            nodes=int(payload.get("nodes", 0)),
            fetch_ms=float(payload.get("fetchMs", 0)),
            parse_ms=float(payload.get("parseMs", 0)),
            build_ms=float(payload.get("buildMs", 0)),
            render_ms=float(payload.get("renderMs", 0)),
            two_raf_ms=float(payload.get("twoRafMs", 0)),
            element_count=int(payload.get("elementCount", 0)),
            list_items=int(payload.get("listItems", 0)),
            mounted_slides=int(payload.get("mountedSlides", 0)),
            svg_count=int(payload.get("svgCount", 0)),
            path_count=int(payload.get("pathCount", 0)),
            img_count=int(payload.get("imgCount", 0)),
            canvas_count=int(payload.get("canvasCount", 0)),
            text_spans=int(payload.get("textSpans", 0)),
            source_path=str(payload.get("sourcePath", "")),
        )


def _round_ms(value: float) -> float:
    return round(float(value), 1)


def format_bytes(num_bytes: int) -> str:
    value = float(num_bytes)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024 or unit == "GiB":
            if unit == "B":
                return f"{int(value)} B"
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GiB"


def _result_to_json(result: BenchmarkResult) -> dict[str, Any]:
    raw = asdict(result)
    return {
        "caseName": raw.pop("case_name"),
        "strategy": raw.pop("strategy"),
        "bytes": raw.pop("bytes"),
        "slides": raw.pop("slides"),
        "nodes": raw.pop("nodes"),
        "fetchMs": raw.pop("fetch_ms"),
        "parseMs": raw.pop("parse_ms"),
        "buildMs": raw.pop("build_ms"),
        "renderMs": raw.pop("render_ms"),
        "twoRafMs": raw.pop("two_raf_ms"),
        "elementCount": raw.pop("element_count"),
        "listItems": raw.pop("list_items"),
        "mountedSlides": raw.pop("mounted_slides"),
        "svgCount": raw.pop("svg_count"),
        "pathCount": raw.pop("path_count"),
        "imgCount": raw.pop("img_count"),
        "canvasCount": raw.pop("canvas_count"),
        "textSpans": raw.pop("text_spans"),
        "sourcePath": raw.pop("source_path"),
    }


def results_to_json_payload(
    results: Iterable[BenchmarkResult],
    *,
    server_url: str,
) -> dict[str, Any]:
    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "serverUrl": server_url,
        "results": [_result_to_json(result) for result in results],
    }


def build_markdown_report(results: Iterable[BenchmarkResult], *, server_url: str) -> str:
    rows = sorted(results, key=lambda item: (item.case_name, item.strategy))
    lines = [
        "# PPTX Renderer Performance Benchmark",
        "",
        f"- Generated: {datetime.now().isoformat(timespec='seconds')}",
        f"- Server: `{server_url}`",
        "",
        "| Case | Strategy | Slides | Nodes | PPTX Size | Fetch ms | Parse ms | Build ms | Render ms | 2x RAF ms | DOM Elements | Mounted |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    item.case_name,
                    item.strategy,
                    str(item.slides),
                    str(item.nodes),
                    format_bytes(item.bytes),
                    f"{item.fetch_ms:.1f}",
                    f"{item.parse_ms:.1f}",
                    f"{item.build_ms:.1f}",
                    f"{item.render_ms:.1f}",
                    f"{item.two_raf_ms:.1f}",
                    str(item.element_count),
                    str(item.mounted_slides),
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "Secondary counts:",
            "",
            "| Case | Strategy | List Items | SVG | Path | IMG | Canvas | Text Spans |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for item in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    item.case_name,
                    item.strategy,
                    str(item.list_items),
                    str(item.svg_count),
                    str(item.path_count),
                    str(item.img_count),
                    str(item.canvas_count),
                    str(item.text_spans),
                ]
            )
            + " |"
        )
    lines.append("")
    return "\n".join(lines)


def compare_results(
    before: Iterable[BenchmarkResult],
    after: Iterable[BenchmarkResult],
) -> list[dict[str, Any]]:
    before_map = {(item.case_name, item.strategy): item for item in before}
    after_map = {(item.case_name, item.strategy): item for item in after}
    rows: list[dict[str, Any]] = []
    for key in sorted(before_map.keys() & after_map.keys()):
        before_item = before_map[key]
        after_item = after_map[key]
        render_delta_ms = _round_ms(after_item.render_ms - before_item.render_ms)
        render_delta_pct = (
            _round_ms((render_delta_ms / before_item.render_ms) * 100)
            if before_item.render_ms
            else 0.0
        )
        rows.append(
            {
                "caseName": key[0],
                "strategy": key[1],
                "beforeRenderMs": before_item.render_ms,
                "afterRenderMs": after_item.render_ms,
                "renderDeltaMs": render_delta_ms,
                "renderDeltaPct": render_delta_pct,
                "beforeElementCount": before_item.element_count,
                "afterElementCount": after_item.element_count,
                "elementDelta": after_item.element_count - before_item.element_count,
            }
        )
    return rows


def build_comparison_markdown_report(
    rows: Iterable[dict[str, Any]],
    *,
    before_label: str,
    after_label: str,
) -> str:
    sorted_rows = sorted(rows, key=lambda item: (item["caseName"], item["strategy"]))
    lines = [
        "# PPTX Renderer Performance Comparison",
        "",
        f"- Generated: {datetime.now().isoformat(timespec='seconds')}",
        f"- Before: `{before_label}`",
        f"- After: `{after_label}`",
        "",
        "| Case | Strategy | Before Render ms | After Render ms | Delta ms | Delta % | Before DOM | After DOM | DOM Delta |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in sorted_rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    str(item["caseName"]),
                    str(item["strategy"]),
                    f"{float(item['beforeRenderMs']):.1f}",
                    f"{float(item['afterRenderMs']):.1f}",
                    f"{float(item['renderDeltaMs']):.1f}",
                    f"{float(item['renderDeltaPct']):.1f}%",
                    str(item["beforeElementCount"]),
                    str(item["afterElementCount"]),
                    str(item["elementDelta"]),
                ]
            )
            + " |"
        )
    lines.append("")
    return "\n".join(lines)


def load_results_json(path: Path) -> list[BenchmarkResult]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [BenchmarkResult.from_browser_payload(item) for item in payload.get("results", [])]


async def run_browser_benchmark(
    *,
    server_url: str,
    cases: Iterable[str],
    strategies: Iterable[str],
    viewport_width: int,
    viewport_height: int,
) -> list[BenchmarkResult]:
    try:
        from playwright.async_api import async_playwright
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Python Playwright is required. Use test/e2e/.venv/bin/python3 or install playwright."
        ) from exc

    results: list[BenchmarkResult] = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": viewport_width, "height": viewport_height})
        for case_name in cases:
            for strategy in strategies:
                list_options = (
                    {"windowed": True, "batchSize": 4, "initialSlides": 2, "overscanViewport": 2}
                    if strategy == "windowed"
                    else {}
                )
                payload = await run_single_browser_case(
                    page,
                    server_url=server_url,
                    case_name=case_name,
                    list_options=list_options,
                    viewport_width=viewport_width,
                    viewport_height=viewport_height,
                )
                result = BenchmarkResult.from_browser_payload(payload)
                results.append(result)
                print(json.dumps(_result_to_json(result), ensure_ascii=False), flush=True)
        await browser.close()
    return results


async def run_single_browser_case(
    page: Any,
    *,
    server_url: str,
    case_name: str,
    list_options: dict[str, Any],
    viewport_width: int,
    viewport_height: int,
) -> dict[str, Any]:
    await page.goto(f"{server_url}/test/pages/index.html")
    return await page.evaluate(
        """
        async ({ caseName, listOptions, viewportWidth, viewportHeight }) => {
          const mod = await import('/src/index.ts');
          document.body.innerHTML = '';
          document.body.style.margin = '0';
          const sourcePath = `/test/e2e/testdata/cases/${caseName}/source.pptx`;
          const t0 = performance.now();
          const resp = await fetch(sourcePath);
          if (!resp.ok) throw new Error(`Failed to fetch ${sourcePath}: ${resp.status}`);
          const buffer = await resp.arrayBuffer();
          const tFetch = performance.now();
          const files = await mod.parseZip(buffer, mod.RECOMMENDED_ZIP_LIMITS);
          const tParse = performance.now();
          const pres = mod.buildPresentation(files);
          const tBuild = performance.now();

          const container = document.createElement('div');
          container.style.cssText = [
            'position:relative',
            `width:${viewportWidth}px`,
            `min-height:${viewportHeight}px`,
            'overflow:visible',
            'background:white',
          ].join(';');
          document.body.appendChild(container);

          const viewer = new mod.PptxViewer(container, { fitMode: 'none', pdfjs: false });
          viewer.load(pres);
          await viewer.renderList(listOptions);
          const tRender = performance.now();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const tAfterRaf = performance.now();

          const result = {
            caseName,
            strategy: listOptions.windowed ? 'windowed' : 'full',
            sourcePath,
            bytes: buffer.byteLength,
            slides: pres.slides.length,
            nodes: pres.slides.reduce((sum, slide) => sum + slide.nodes.length, 0),
            fetchMs: Math.round((tFetch - t0) * 10) / 10,
            parseMs: Math.round((tParse - tFetch) * 10) / 10,
            buildMs: Math.round((tBuild - tParse) * 10) / 10,
            renderMs: Math.round((tRender - tBuild) * 10) / 10,
            twoRafMs: Math.round((tAfterRaf - tRender) * 10) / 10,
            elementCount: container.querySelectorAll('*').length,
            listItems: container.querySelectorAll('[data-slide-index]').length,
            mountedSlides: container.querySelectorAll('[data-mounted="1"]').length,
            svgCount: container.querySelectorAll('svg').length,
            pathCount: container.querySelectorAll('path').length,
            imgCount: container.querySelectorAll('img').length,
            canvasCount: container.querySelectorAll('canvas').length,
            textSpans: container.querySelectorAll('span').length,
          };
          viewer.destroy();
          container.remove();
          return result;
        }
        """,
        {
            "caseName": case_name,
            "listOptions": list_options,
            "viewportWidth": viewport_width,
            "viewportHeight": viewport_height,
        },
    )


def _server_ready(url: str) -> bool:
    try:
        with urlopen(url, timeout=1) as response:
            return response.status < 500
    except Exception:
        return False


def wait_for_server(url: str, timeout_s: float = 15.0) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if _server_ready(url):
            return
        time.sleep(0.25)
    raise SystemExit(f"Server did not become ready: {url}")


def start_vite_server(server_url: str) -> subprocess.Popen[str]:
    port = server_url.rstrip("/").split(":")[-1]
    proc = subprocess.Popen(
        ["pnpm", "dev", "--host", "127.0.0.1", "--port", port, "--strictPort"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    wait_for_server(server_url)
    return proc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-url", default=DEFAULT_SERVER_URL)
    parser.add_argument("--case", action="append", dest="cases", choices=DEFAULT_CASES)
    parser.add_argument("--strategy", choices=("full", "windowed", "both"), default="both")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--label", default=datetime.now().strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--viewport-width", type=int, default=1440)
    parser.add_argument("--viewport-height", type=int, default=900)
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--compare-before", type=Path)
    parser.add_argument("--compare-after", type=Path)
    parser.add_argument("--compare-output", type=Path)
    return parser.parse_args()


async def async_main() -> None:
    args = parse_args()
    if args.compare_before or args.compare_after:
        if not args.compare_before or not args.compare_after:
            raise SystemExit("--compare-before and --compare-after must be provided together")
        before = load_results_json(args.compare_before)
        after = load_results_json(args.compare_after)
        rows = compare_results(before, after)
        output_path = args.compare_output or (
            args.output_dir / f"compare-{args.compare_before.stem}-vs-{args.compare_after.stem}.md"
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            build_comparison_markdown_report(
                rows,
                before_label=str(args.compare_before),
                after_label=str(args.compare_after),
            ),
            encoding="utf-8",
        )
        print(f"Wrote {output_path}")
        return

    cases = tuple(args.cases or DEFAULT_CASES)
    strategies = DEFAULT_STRATEGIES if args.strategy == "both" else (args.strategy,)
    server_proc: subprocess.Popen[str] | None = None
    try:
        if args.start_server:
            server_proc = start_vite_server(args.server_url)
        else:
            wait_for_server(args.server_url, timeout_s=3.0)

        results = await run_browser_benchmark(
            server_url=args.server_url,
            cases=cases,
            strategies=strategies,
            viewport_width=args.viewport_width,
            viewport_height=args.viewport_height,
        )

        args.output_dir.mkdir(parents=True, exist_ok=True)
        json_path = args.output_dir / f"{args.label}.json"
        md_path = args.output_dir / f"{args.label}.md"
        json_path.write_text(
            json.dumps(results_to_json_payload(results, server_url=args.server_url), indent=2),
            encoding="utf-8",
        )
        md_path.write_text(build_markdown_report(results, server_url=args.server_url), encoding="utf-8")
        print(f"Wrote {json_path}")
        print(f"Wrote {md_path}")
    finally:
        if server_proc:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server_proc.kill()


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
