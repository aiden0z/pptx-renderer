from __future__ import annotations

import server


def test_vite_proxy_headers_forward_accept_for_stylesheets():
    headers = server._vite_proxy_headers(
        {
            "accept": "text/css,*/*;q=0.1",
            "host": "127.0.0.1:8080",
            "connection": "keep-alive",
        }
    )

    assert headers == {"accept": "text/css,*/*;q=0.1"}


def test_oracle_page_mismatch_requires_low_current_and_better_neighbor():
    mismatch = server._classify_oracle_page_mismatch(
        current_score=0.22,
        pdf_page_idx=70,
        candidate_scores={69: 0.91, 71: 0.24},
    )

    assert mismatch == {
        "currentPdfPage": 70,
        "currentSsim": 0.22,
        "candidatePdfPage": 69,
        "candidateSsim": 0.91,
    }


def test_oracle_page_mismatch_ignores_normal_renderer_differences():
    assert (
        server._classify_oracle_page_mismatch(
            current_score=0.72,
            pdf_page_idx=70,
            candidate_scores={69: 0.86},
        )
        is None
    )
    assert (
        server._classify_oracle_page_mismatch(
            current_score=0.22,
            pdf_page_idx=70,
            candidate_scores={69: 0.35},
        )
        is None
    )
