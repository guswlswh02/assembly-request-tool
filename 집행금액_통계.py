"""엑셀의 '실제집행금액' 열에서 기초 통계를 계산한다.

외부 패키지를 사용하지 않으며 원본 엑셀 파일을 수정하지 않는다.
"""

from pathlib import Path
from statistics import fmean, median
from xml.etree import ElementTree as ET
from zipfile import ZipFile


# Python CLI의 exec() 실행에서는 현재 폴더를, 파일 실행에서는 스크립트 폴더를 사용한다.
_스크립트_후보 = Path(globals().get("__file__", "")).resolve().parent
_기준_폴더 = _스크립트_후보 if (_스크립트_후보 / "샘플_실제집행금액_1000행.xlsx").is_file() else Path.cwd()
엑셀_파일 = _기준_폴더 / "샘플_실제집행금액_1000행.xlsx"
금액_열 = "실제집행금액"

NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def 공유문자열_읽기(압축파일):
    """엑셀의 공용 문자열 목록을 읽는다."""
    경로 = "xl/sharedStrings.xml"
    if 경로 not in 압축파일.namelist():
        return []

    루트 = ET.fromstring(압축파일.read(경로))
    문자열 = []
    for 항목 in 루트.findall("x:si", NS):
        문자열.append("".join(노드.text or "" for 노드 in 항목.iterfind(".//x:t", NS)))
    return 문자열


def 셀값(셀, 공유문자열):
    """셀의 저장 형식에 따라 실제 값을 반환한다."""
    형식 = 셀.get("t")
    if 형식 == "inlineStr":
        return "".join(노드.text or "" for 노드 in 셀.iterfind(".//x:t", NS))

    값_노드 = 셀.find("x:v", NS)
    if 값_노드 is None or 값_노드.text is None:
        return None
    if 형식 == "s":
        return 공유문자열[int(값_노드.text)]
    return 값_노드.text


def 열번호(셀주소):
    """A, B, AA 형태의 열 문자를 1부터 시작하는 번호로 바꾼다."""
    번호 = 0
    for 문자 in 셀주소:
        if not 문자.isalpha():
            break
        번호 = 번호 * 26 + ord(문자.upper()) - ord("A") + 1
    return 번호


def 금액목록_읽기(파일경로):
    with ZipFile(파일경로) as 압축파일:
        공유문자열 = 공유문자열_읽기(압축파일)
        시트 = ET.fromstring(압축파일.read("xl/worksheets/sheet1.xml"))
        행들 = 시트.findall(".//x:sheetData/x:row", NS)

        if not 행들:
            raise ValueError("엑셀 시트에 데이터가 없습니다.")

        머리글 = {
            열번호(셀.get("r", "")): 셀값(셀, 공유문자열)
            for 셀 in 행들[0].findall("x:c", NS)
        }
        대상열 = next((번호 for 번호, 이름 in 머리글.items() if 이름 == 금액_열), None)
        if 대상열 is None:
            raise ValueError(f"'{금액_열}' 열을 찾지 못했습니다. 현재 열: {list(머리글.values())}")

        금액들 = []
        제외건수 = 0
        for 행 in 행들[1:]:
            값 = None
            for 셀 in 행.findall("x:c", NS):
                if 열번호(셀.get("r", "")) == 대상열:
                    값 = 셀값(셀, 공유문자열)
                    break

            try:
                if 값 is None or str(값).strip() == "":
                    raise ValueError
                금액들.append(float(str(값).replace(",", "")))
            except ValueError:
                제외건수 += 1

    if not 금액들:
        raise ValueError("계산할 숫자 금액이 없습니다.")
    return 금액들, 제외건수


def main():
    금액들, 제외건수 = 금액목록_읽기(엑셀_파일)

    print(f"파일: {엑셀_파일.name}")
    print(f"계산 건수: {len(금액들):,}건")
    print(f"제외 건수(빈칸·숫자 아님): {제외건수:,}건")
    print(f"평균: {fmean(금액들):,.2f}원")
    print(f"중앙값: {median(금액들):,.2f}원")
    print(f"최솟값: {min(금액들):,.2f}원")
    print(f"최댓값: {max(금액들):,.2f}원")


if __name__ == "__main__":
    main()
