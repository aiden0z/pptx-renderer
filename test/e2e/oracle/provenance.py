from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
from functools import lru_cache
from pathlib import Path


def _resolve_within(root: Path, relative_path: str, label: str) -> Path:
    if not relative_path or "\x00" in relative_path:
        raise ValueError(f"{label} is empty or invalid")
    root = root.resolve()
    # Validate the configured path lexically, while allowing an ignored testdata
    # symlink to point at a locally installed/licensed font outside the repository.
    resolved = Path(os.path.abspath(root / relative_path))
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"{label} resolves outside testdata: {relative_path}") from exc
    return resolved


@lru_cache(maxsize=512)
def _sha256_file_for_stat(path_value: str, size: int, mtime_ns: int) -> str:
    del size, mtime_ns
    digest = hashlib.sha256()
    with Path(path_value).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_file(path: Path) -> str:
    stat = path.stat()
    return _sha256_file_for_stat(str(path.resolve()), stat.st_size, stat.st_mtime_ns)


def fingerprint_file(path: Path, project_root: Path) -> dict:
    logical_path = Path(os.path.abspath(path))
    logical_root = Path(os.path.abspath(project_root))
    try:
        display_path = logical_path.relative_to(logical_root).as_posix()
    except ValueError:
        display_path = logical_path.name
    resolved_path = logical_path.resolve()
    return {
        "path": display_path,
        "sizeBytes": resolved_path.stat().st_size,
        "sha256": _sha256_file(resolved_path),
    }


def load_font_profile(testdata_dir: Path, profile_ref: str) -> dict:
    profile_path = _resolve_within(testdata_dir, profile_ref, "font profile")
    if not profile_path.is_file():
        raise ValueError(f"font profile does not exist: {profile_ref}")
    try:
        payload = json.loads(profile_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"font profile is not valid JSON: {profile_ref}") from exc
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise ValueError("font profile requires version=1")
    profile_id = payload.get("id")
    faces = payload.get("fontFaces")
    if not isinstance(profile_id, str) or not profile_id.strip():
        raise ValueError("font profile requires a non-empty id")
    if not isinstance(faces, list) or not faces:
        raise ValueError("font profile requires at least one font face")

    resolved_faces = []
    for face in faces:
        if not isinstance(face, dict):
            raise ValueError("font profile face must be an object")
        family = face.get("family")
        font_ref = face.get("path")
        if not isinstance(family, str) or not family.strip() or not isinstance(font_ref, str):
            raise ValueError("font profile face requires family and path")
        font_path = _resolve_within(testdata_dir, font_ref, "font face path")
        if not font_path.is_file():
            raise ValueError(f"font face does not exist: {font_ref}")
        resolved_faces.append(
            {
                "family": family.strip(),
                "descriptors": face.get("descriptors") or {},
                "file": {
                    "path": font_ref,
                    "sizeBytes": font_path.stat().st_size,
                    "sha256": _sha256_file(font_path),
                },
            }
        )

    return {
        "id": profile_id.strip(),
        "manifest": {
            "path": profile_ref,
            "sizeBytes": profile_path.stat().st_size,
            "sha256": _sha256_file(profile_path),
        },
        "faces": resolved_faces,
    }


def detect_renderer_git_state(project_root: Path) -> tuple[str | None, bool | None]:
    try:
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=project_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        dirty = bool(
            subprocess.run(
                ["git", "status", "--porcelain", "--untracked-files=no"],
                cwd=project_root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        )
        return revision or None, dirty
    except (OSError, subprocess.CalledProcessError):
        return None, None


def collect_evaluation_provenance(
    *,
    project_root: Path,
    testdata_dir: Path,
    pptx_path: Path,
    ground_truth_paths: list[Path],
    ground_truth_kind: str,
    browser_name: str,
    browser_version: str,
    font_profile_ref: str | None,
    renderer_revision: str | None = None,
    renderer_dirty: bool | None = None,
) -> dict:
    if renderer_revision is None and renderer_dirty is None:
        renderer_revision, renderer_dirty = detect_renderer_git_state(project_root)

    ground_truth_files = [
        fingerprint_file(path, project_root) for path in ground_truth_paths if path.is_file()
    ]
    combined_digest = hashlib.sha256()
    for entry in ground_truth_files:
        combined_digest.update(entry["sha256"].encode("ascii"))

    font_profile = (
        load_font_profile(testdata_dir, font_profile_ref) if font_profile_ref else None
    )
    return {
        "schemaVersion": 1,
        "inputs": {
            "sourcePptx": fingerprint_file(pptx_path, project_root),
            "groundTruth": {
                "kind": ground_truth_kind,
                "combinedSha256": combined_digest.hexdigest(),
                "files": ground_truth_files,
            },
        },
        "renderer": {
            "revision": renderer_revision,
            "dirty": renderer_dirty,
        },
        "runtime": {
            "platform": platform.platform(),
            "python": sys.version.split()[0],
            "browser": {
                "name": browser_name,
                "version": browser_version,
            },
            "fontProfile": font_profile,
        },
    }
