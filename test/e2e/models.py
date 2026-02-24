"""
Canonical data classes for structural comparison between
ground truth (PPTX XML) and renderer output (serialized JSON).
"""

from dataclasses import dataclass, field


@dataclass
class Position:
    x: float = 0.0
    y: float = 0.0


@dataclass
class Size:
    w: float = 0.0
    h: float = 0.0


@dataclass
class TextParagraph:
    level: int = 0
    text: str = ""


@dataclass
class TextBody:
    paragraphs: list[TextParagraph] = field(default_factory=list)
    total_text: str = ""


@dataclass
class CellData:
    text: str = ""
    grid_span: int = 1
    row_span: int = 1


@dataclass
class RowData:
    height: float = 0.0
    cells: list[CellData] = field(default_factory=list)


@dataclass
class NodeData:
    id: str = ""
    name: str = ""
    node_type: str = ""
    position: Position = field(default_factory=Position)
    size: Size = field(default_factory=Size)
    rotation: float = 0.0
    flip_h: bool = False
    flip_v: bool = False
    preset_geometry: str | None = None
    text_body: TextBody | None = None
    columns: list[float] | None = None
    rows: list[RowData] | None = None
    table_style_id: str | None = None
    children: list["NodeData"] | None = None


@dataclass
class SlideData:
    index: int = 0
    nodes: list[NodeData] = field(default_factory=list)
    hidden: bool = False


@dataclass
class PresentationStructure:
    width: float = 0.0
    height: float = 0.0
    slide_count: int = 0
    slides: list[SlideData] = field(default_factory=list)
