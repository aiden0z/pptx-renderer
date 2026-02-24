"""
Shared pytest fixtures for e2e tests.
Provides: dev server, Playwright browser, parametrized test files.
"""

import json
import os
import signal
import subprocess
import time
from pathlib import Path

import pytest
import requests
from playwright.sync_api import sync_playwright

import testdata_paths as tdp

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TESTDATA_DIR = Path(__file__).resolve().parent / "testdata"
BASELINES_DIR = Path(__file__).resolve().parent / "baselines"
REPORTS_DIR = Path(__file__).resolve().parent / "reports"

DEV_SERVER_PORT = 5173
DEV_SERVER_URL = f"http://localhost:{DEV_SERVER_PORT}"

# Python dev server (serves static files + proxies to Vite + evaluation APIs)
PYTHON_SERVER_PORT = 8080
PYTHON_SERVER_URL = f"http://localhost:{PYTHON_SERVER_PORT}"

# E2E test cases: all case stems under testdata/cases/ that have source.pptx + ground-truth.pdf
AVAILABLE_TEST_FILES = tdp.list_cases_with_ground_truth()

# Timeouts
PAGE_TIMEOUT_MS = 120_000  # 120s for large PPTX fetch + parse
SERVER_STARTUP_TIMEOUT = 30  # seconds


# ---------------------------------------------------------------------------
# CLI Options
# ---------------------------------------------------------------------------

def pytest_addoption(parser):
    parser.addoption(
        "--update-baselines",
        action="store_true",
        default=False,
        help="Update stored baselines instead of comparing against them",
    )
    parser.addoption(
        "--dev-server-url",
        default=DEV_SERVER_URL,
        help=f"URL of running dev server (default: {DEV_SERVER_URL})",
    )
    parser.addoption(
        "--oracle-macro-host",
        default="",
        help="Path to macro-enabled .pptm used by PowerPoint oracle smoke tests",
    )
    parser.addoption(
        "--oracle-macro-name",
        default="GenerateProbeDeck_Default",
        help="VBA macro name for oracle smoke tests",
    )


# ---------------------------------------------------------------------------
# Dev Server Fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def dev_server_url(request):
    """Start Vite dev server if not already running, return its URL."""
    url = request.config.getoption("--dev-server-url")

    # Check if server is already running
    try:
        resp = requests.get(url, timeout=3)
        if resp.status_code == 200:
            yield url
            return
    except requests.ConnectionError:
        pass

    # Start dev server
    proc = subprocess.Popen(
        ["npx", "vite", "--port", str(DEV_SERVER_PORT)],
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        preexec_fn=os.setsid,
    )

    # Wait for server to be ready
    deadline = time.time() + SERVER_STARTUP_TIMEOUT
    while time.time() < deadline:
        try:
            resp = requests.get(url, timeout=2)
            if resp.status_code == 200:
                break
        except requests.ConnectionError:
            time.sleep(0.5)
    else:
        proc.terminate()
        raise RuntimeError(f"Dev server failed to start within {SERVER_STARTUP_TIMEOUT}s")

    yield url

    # Teardown: kill the process group
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass


# ---------------------------------------------------------------------------
# Playwright Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def browser():
    """Launch a Playwright Chromium browser for the test session."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture(scope="function")
def page(browser, dev_server_url):
    """Create a new browser page for each test."""
    ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
    pg = ctx.new_page()
    pg.set_default_timeout(PAGE_TIMEOUT_MS)
    yield pg
    pg.close()
    ctx.close()


# ---------------------------------------------------------------------------
# Model Export Fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def _export_cache():
    """Session-level cache for exported presentation JSON."""
    return {}


@pytest.fixture(scope="function")
def export_presentation(browser, dev_server_url, _export_cache):
    """
    Returns a callable that exports a PPTX file's serialized model via Playwright.
    Results are cached per test file for the session.
    """
    def _export(test_file: str) -> dict:
        if test_file in _export_cache:
            return _export_cache[test_file]

        ctx = browser.new_context()
        pg = ctx.new_page()
        pg.set_default_timeout(PAGE_TIMEOUT_MS)

        url = f"{dev_server_url}/test/pages/export.html?file=testdata/cases/{test_file}/source.pptx"
        pg.goto(url)

        # Wait for export to complete
        pg.wait_for_function(
            "() => window.__exportResult !== undefined || window.__exportError !== undefined",
            timeout=PAGE_TIMEOUT_MS,
        )

        error = pg.evaluate("() => window.__exportError")
        if error:
            pg.close()
            ctx.close()
            raise RuntimeError(f"Export failed for {test_file}: {error}")

        result = pg.evaluate("() => JSON.stringify(window.__exportResult)")
        pg.close()
        ctx.close()

        data = json.loads(result)
        _export_cache[test_file] = data
        return data

    return _export


# ---------------------------------------------------------------------------
# Parametrization Helpers
# ---------------------------------------------------------------------------

def pytest_generate_tests(metafunc):
    """Parametrize tests that request 'test_file' fixture."""
    if "test_file" in metafunc.fixturenames:
        metafunc.parametrize("test_file", AVAILABLE_TEST_FILES)


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def ensure_directories():
    """Ensure output directories exist."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    BASELINES_DIR.mkdir(parents=True, exist_ok=True)


@pytest.fixture(scope="session")
def oracle_macro_host(request) -> Path | None:
    cli = request.config.getoption("--oracle-macro-host")
    env = os.getenv("PPTX_ORACLE_MACRO_HOST", "")
    value = cli or env
    if value:
        return Path(value).expanduser().resolve()

    default_host = TESTDATA_DIR / "pptx-macro-host.pptm"
    if default_host.exists():
        return default_host.resolve()
    return None


@pytest.fixture(scope="session")
def oracle_macro_name(request) -> str:
    env = os.getenv("PPTX_ORACLE_MACRO_NAME", "")
    return env or request.config.getoption("--oracle-macro-name")


@pytest.fixture(scope="session")
def oracle_runtime_dir() -> Path:
    # Keep runtime path fixed to avoid repeated macOS directory authorization prompts.
    base = (TESTDATA_DIR / "oracle-runtime").resolve()
    base.mkdir(parents=True, exist_ok=True)
    return base
