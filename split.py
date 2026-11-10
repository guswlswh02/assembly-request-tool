import csv
import re
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader


BASE_DIR = Path(__file__).resolve().parent
SOURCE_DIR = BASE_DIR / "원문"
OUTPUT_PATH = BASE_DIR / "data" / "문항목록.csv"
FIELDS = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"]


def clean_line(line):
    return re.sub(r"\s+", " ", line).strip()


def append_text(item, field, text):
    separator = " / " if field == "세부항목" else " "
    item[field] = f"{item[field]}{separator}{text}" if item[field] else text


def parse_pdf(pdf_path):
    text = "\n".join(page.extract_text() or "" for page in PdfReader(pdf_path).pages)
    lines = [clean_line(line) for line in text.splitlines() if clean_line(line)]

    committee = ""
    member = ""
    deadline = ""
    for line in lines:
        header = re.search(r"(.+?위원회)\s+(.+?\s*의원)실\s+자료요구서", line)
        if header:
            committee = header.group(1).strip()
            member = re.sub(r"\s*의원$", "", header.group(2)).strip()
        if "제출기한:" in line:
            date_match = re.search(r"제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.", line)
            if date_match:
                deadline = datetime(*map(int, date_match.groups())).strftime("%Y-%m-%d")

    if not committee or not member or not deadline:
        raise ValueError(f"머리말 정보를 찾지 못했습니다: {pdf_path.name}")

    items = []
    current = None
    active_field = "요구내용"
    for line in lines:
        if line.startswith("수신:") or line.startswith("담당 보좌관:") or line == "끝.":
            continue
        number_match = re.match(r"^(\d+)\.\s*(.*)$", line)
        if number_match:
            current = {
                "파일명": pdf_path.name,
                "위원회": committee,
                "의원": member,
                "제출기한": deadline,
                "문항번호": int(number_match.group(1)),
                "요구내용": number_match.group(2).strip(),
                "세부항목": "",
                "비고": "",
            }
            items.append(current)
            active_field = "요구내용"
            continue
        if current is None:
            continue
        if re.match(r"^[가-힣]\.\s*", line):
            active_field = "세부항목"
            append_text(current, active_field, line)
        elif line.startswith("※"):
            active_field = "비고"
            append_text(current, active_field, line.removeprefix("※").strip())
        else:
            append_text(current, active_field, line)

    return items


def main():
    pdf_paths = sorted(SOURCE_DIR.glob("*.pdf"))
    if len(pdf_paths) != 3:
        raise ValueError(f"원문 PDF가 3건이어야 합니다: 현재 {len(pdf_paths)}건")

    rows = []
    for pdf_path in pdf_paths:
        rows.extend(parse_pdf(pdf_path))

    if OUTPUT_PATH.exists():
        raise FileExistsError(f"새 파일만 만들 수 있습니다: {OUTPUT_PATH}")
    with OUTPUT_PATH.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    for pdf_path in pdf_paths:
        file_rows = [row for row in rows if row["파일명"] == pdf_path.name]
        expected_match = re.search(r"_(\d+)문항\.pdf$", pdf_path.name)
        expected = int(expected_match.group(1)) if expected_match else None
        numbers = [row["문항번호"] for row in file_rows]
        continuous = numbers == list(range(1, len(numbers) + 1))
        matched = expected == len(file_rows) and continuous and numbers[-1] == expected
        print(f"{pdf_path.name}\t{expected}\t{len(file_rows)}\t{numbers[-1]}\t{'O' if continuous else 'X'}\t{'O' if matched else 'X'}")


if __name__ == "__main__":
    main()
