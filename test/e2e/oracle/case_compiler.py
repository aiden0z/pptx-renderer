from __future__ import annotations

import json
import sys
from pathlib import Path


SUPPORTED_NODE_KINDS = {"shape", "smartart", "textbox", "chart", "table", "connector", "fillstroke"}


def _as_num(value) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def compile_case_to_spec(
    case_json_path: Path,
    spec_output_path: Path,
    output_pptx_path: Path,
    output_pdf_path: Path,
    *,
    output_png_prefix: Path | None = None,
    png_width: int = 0,
    png_height: int = 0,
) -> Path:
    """Compile a JSON case definition into a VBA-friendly line-oriented spec file.

    Args:
        output_png_prefix: If set, VBA will export each slide as
            ``{prefix}_slide1.png``, ``{prefix}_slide2.png``, etc.
        png_width/png_height: Pixel dimensions for PNG export (0 = PowerPoint default 96 DPI).
    """
    case_path = Path(case_json_path)
    spec_path = Path(spec_output_path)

    data = json.loads(case_path.read_text(encoding="utf-8"))
    slides = data.get("slides", [])
    if not isinstance(slides, list) or not slides:
        raise ValueError("case json must contain a non-empty 'slides' array")

    lines: list[str] = [
        f"OUT_PPTX|{Path(output_pptx_path)}",
        f"OUT_PDF|{Path(output_pdf_path)}",
    ]
    if output_png_prefix is not None:
        png_parts = [str(Path(output_png_prefix))]
        if png_width > 0:
            png_parts.append(str(png_width))
        if png_height > 0:
            png_parts.append(str(png_height))
        lines.append(f"OUT_PNG|{'|'.join(png_parts)}")

    for slide in slides:
        lines.append("SLIDE")
        nodes = slide.get("nodes", [])
        if not isinstance(nodes, list):
            raise ValueError("slide.nodes must be a list")

        for node in nodes:
            kind = str(node.get("kind", "")).lower()
            if kind not in SUPPORTED_NODE_KINDS:
                raise ValueError(f"unsupported node kind: {kind}")

            if kind == "shape":
                shape_token = node.get("shapeTypeId")
                if shape_token is None:
                    shape_token = node["shape"]
                lines.append(
                    "|".join(
                        [
                            "SHAPE",
                            str(shape_token),
                            _as_num(node["left"]),
                            _as_num(node["top"]),
                            _as_num(node["width"]),
                            _as_num(node["height"]),
                        ]
                    )
                )
            elif kind == "smartart":
                lines.append(
                    "|".join(
                        [
                            "SMARTART",
                            str(node["layout"]),
                            _as_num(node["left"]),
                            _as_num(node["top"]),
                            _as_num(node["width"]),
                            _as_num(node["height"]),
                        ]
                    )
                )
            elif kind == "chart":
                lines.append(
                    "|".join(
                        [
                            "CHART",
                            str(node["chartTypeId"]),
                            _as_num(node["left"]),
                            _as_num(node["top"]),
                            _as_num(node["width"]),
                            _as_num(node["height"]),
                        ]
                    )
                )
            elif kind == "table":
                lines.append(
                    "|".join(
                        [
                            "TABLE",
                            str(node["rows"]),
                            str(node["cols"]),
                            _as_num(node["left"]),
                            _as_num(node["top"]),
                            _as_num(node["width"]),
                            _as_num(node["height"]),
                        ]
                    )
                )
            elif kind == "connector":
                lines.append(
                    "|".join(
                        [
                            "CONNECTOR",
                            str(node["connectorType"]),
                            _as_num(node["beginX"]),
                            _as_num(node["beginY"]),
                            _as_num(node["endX"]),
                            _as_num(node["endY"]),
                        ]
                    )
                )
            elif kind == "fillstroke":
                lines.append(
                    "|".join(
                        [
                            "FILLSTROKE",
                            str(node["fillKind"]),
                            str(node["strokeKind"]),
                            _as_num(node["left"]),
                            _as_num(node["top"]),
                            _as_num(node["width"]),
                            _as_num(node["height"]),
                        ]
                    )
                )
            else:
                text = str(node.get("text", "")).replace("|", "/")
                lines.append(
                    "|".join(
                        [
                            "TEXTBOX",
                            text,
                            _as_num(node["left"]),
                            _as_num(node["top"]),
                            _as_num(node["width"]),
                            _as_num(node["height"]),
                        ]
                    )
                )

    spec_path.parent.mkdir(parents=True, exist_ok=True)
    # VBA Line Input on Windows requires CRLF; macOS VBA handles both LF and CRLF.
    eol = "\r\n" if sys.platform == "win32" else "\n"
    spec_path.write_text(eol.join(lines) + eol, encoding="utf-8")
    return spec_path
