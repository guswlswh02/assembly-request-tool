"""국회 요구 문항의 소관 과 후보를 배분기준표에서 찾는다."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any


기본_데이터_폴더 = Path(__file__).resolve().parent / "data"


def _csv_읽기(경로: Path) -> list[dict[str, str]]:
    """UTF-8 CSV를 읽고 각 값의 앞뒤 공백을 제거한다."""
    with 경로.open("r", encoding="utf-8-sig", newline="") as 파일:
        return [
            {열: (값 or "").strip() for 열, 값 in 행.items()}
            for 행 in csv.DictReader(파일)
        ]


def 소관과_추천(
    요구내용: str,
    배분기준표: str | Path | None = None,
    조직도: str | Path | None = None,
) -> dict[str, Any]:
    """요구 문항 하나의 소관 과 후보와 판정 근거를 반환한다.

    제외어가 포함된 규칙은 먼저 버리고, 남은 일치 규칙 중 우선순위가
    가장 큰 과를 찾는다. 최고 우선순위 과가 복수이거나 일치 규칙이
    없으면 상태를 ``확인필요``로 반환한다.
    """
    if not isinstance(요구내용, str) or not 요구내용.strip():
        raise ValueError("요구내용은 비어 있지 않은 문자열이어야 합니다.")

    기준표_경로 = Path(배분기준표) if 배분기준표 else 기본_데이터_폴더 / "배분기준표_소관키워드_304건.csv"
    조직도_경로 = Path(조직도) if 조직도 else 기본_데이터_폴더 / "A부_조직도_26개과.csv"

    허용_과 = {행["과"] for 행 in _csv_읽기(조직도_경로)}
    일치_규칙: list[dict[str, Any]] = []

    for 규칙 in _csv_읽기(기준표_경로):
        키워드 = 규칙["키워드"]
        제외어들 = [값.strip() for 값 in 규칙["제외어"].split("|") if 값.strip()]
        if not 키워드 or 키워드 not in 요구내용:
            continue
        if any(제외어 in 요구내용 for 제외어 in 제외어들):
            continue
        if 규칙["과"] not in 허용_과:
            raise ValueError(f"조직도에 없는 과가 배분기준표에 있습니다: {규칙['과']}")
        일치_규칙.append({**규칙, "우선순위": int(규칙["우선순위"])})

    if not 일치_규칙:
        return {"상태": "확인필요", "추천과": [], "배분구분": None, "최고우선순위": None, "근거규칙": []}

    최고우선순위 = max(규칙["우선순위"] for 규칙 in 일치_규칙)
    최고_규칙 = [규칙 for 규칙 in 일치_규칙 if 규칙["우선순위"] == 최고우선순위]
    추천과 = list(dict.fromkeys(규칙["과"] for 규칙 in 최고_규칙))
    배분구분 = "공통" if any(규칙["유형"] == "공통(전 과 취합)" for 규칙 in 최고_규칙) else "소관"

    return {
        "상태": "추천" if len(추천과) == 1 else "확인필요",
        "추천과": 추천과,
        "배분구분": 배분구분,
        "최고우선순위": 최고우선순위,
        "근거규칙": [
            {"rule_id": 규칙["rule_id"], "과": 규칙["과"], "키워드": 규칙["키워드"], "우선순위": 규칙["우선순위"]}
            for 규칙 in 최고_규칙
        ],
    }


def _실행화면() -> None:
    """명령줄에서 요구 문항을 반복 입력받아 결과를 표시한다."""
    print("소관 과 추천기입니다. 끝내려면 빈 줄에서 Enter를 누르세요.")
    while True:
        요구내용 = input("\n요구 문항: ").strip()
        if not 요구내용:
            print("종료합니다.")
            return

        결과 = 소관과_추천(요구내용)
        print(f"상태: {결과['상태']}")
        print(f"추천 과: {', '.join(결과['추천과']) if 결과['추천과'] else '없음'}")
        print(f"배분 구분: {결과['배분구분'] or '확인필요'}")
        if 결과["근거규칙"]:
            근거 = ", ".join(
                f"{규칙['키워드']}({규칙['rule_id']}, 우선순위 {규칙['우선순위']})"
                for 규칙 in 결과["근거규칙"]
            )
            print(f"근거: {근거}")


if __name__ == "__main__":
    _실행화면()
