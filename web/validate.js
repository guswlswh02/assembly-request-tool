(function initializeValidator(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RequestValidator = api;
})(typeof globalThis === "undefined" ? this : globalThis, function createValidator() {
  "use strict";

  const text = (value) => value === undefined || value === null ? "" : String(value).trim();
  const number = (value) => {
    const normalized = text(value).replace(/,/g, "").replace(/[^0-9.+-]/g, "");
    return normalized && Number.isFinite(Number(normalized)) ? Number(normalized) : null;
  };
  const issue = (종류, 내용, extra = {}) => ({ 종류, 내용, ...extra });
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const isTotalRow = (row) => Object.values(row || {}).some((value) => /^(합계|총계|계)$/i.test(text(value)));

  function expectedRecentYears(requestText, referenceYear = new Date().getFullYear()) {
    const match = text(requestText).match(/최근\s*(\d+)\s*년/);
    if (!match) return [];
    const count = Number(match[1]);
    if (!Number.isInteger(count) || count < 1 || count > 100) return [];
    return Array.from({ length: count }, (_, index) => referenceYear - count + 1 + index);
  }

  function rowsFromMatrix(matrix) {
    const source = Array.isArray(matrix) ? matrix.map((row) => Array.isArray(row) ? [...row] : []) : [];
    const headers = (source[1] || []).map(text);
    const rows = source.slice(2).filter((row) => row.some((value) => text(value))).map((row) => Object.fromEntries(
      headers.map((header, index) => [header || `열${index + 1}`, row[index] ?? ""]),
    ));
    return { headers, rows };
  }

  function validateReply(matrix, options = {}) {
    const source = Array.isArray(matrix) ? matrix.map((row) => Array.isArray(row) ? [...row] : []) : [];
    const requestText = text(options.요구내용 || options.requestText);
    const referenceYear = Number(options.기준연도 || options.referenceYear) || new Date().getFullYear();
    const issues = [];
    const firstRow = (source[0] || []).map(text).filter(Boolean).join(" ");
    if (!firstRow) issues.push(issue("양식", "1행에 요구 표시가 없습니다.", { 행: 1 }));
    else if (requestText && !firstRow.includes(requestText) && !requestText.includes(firstRow)) {
      issues.push(issue("양식", "1행 요구 표시가 현재 문항의 요구내용과 일치하는지 확인해야 합니다.", { 행: 1 }));
    }
    const { headers, rows } = rowsFromMatrix(source);
    const required = ["연도", "예산(천원)", "집행액(천원)", "비고"];
    if (!headers.some(Boolean)) issues.push(issue("양식", "2행에 머리글이 없습니다.", { 행: 2 }));
    required.filter((header) => !headers.includes(header)).forEach((header) => {
      issues.push(issue("양식", `2행 머리글에 '${header}' 열이 없습니다.`, { 행: 2, 열: header }));
    });

    const dataRows = rows.filter((row) => !isTotalRow(row));
    const years = new Set(dataRows.map((row) => number(row.연도)).filter((value) => Number.isInteger(value)));
    expectedRecentYears(requestText, referenceYear).filter((year) => !years.has(year)).forEach((year) => {
      issues.push(issue("연도누락", `${year}년 자료가 없습니다.`, { 열: "연도" }));
    });

    rows.forEach((row, index) => {
      if (isTotalRow(row)) return;
      const budget = number(row["예산(천원)"]);
      const spent = number(row["집행액(천원)"]);
      if (budget !== null && spent !== null && spent > budget && !text(row.비고)) {
        issues.push(issue("집행초과", `집행액 ${spent}이 예산 ${budget}보다 크지만 비고가 없습니다.`, { 행: index + 3, 열: "비고" }));
      }
    });

    const totalIndex = rows.findIndex(isTotalRow);
    if (totalIndex >= 0) {
      const totalRow = rows[totalIndex];
      headers.filter((header) => header && !["연도", "비고"].includes(header)).forEach((header) => {
        const stated = number(totalRow[header]);
        if (stated === null) return;
        const calculated = rows.slice(0, totalIndex).reduce((sum, row) => sum + (number(row[header]) || 0), 0);
        if (Math.abs(stated - calculated) > 0.000001) {
          issues.push(issue("합계불일치", `${header} 합계 ${stated}이 데이터 합 ${calculated}과 다릅니다.`, { 행: totalIndex + 3, 열: header }));
        }
      });
    }
    return { 원본: source, 머리글: headers, 행: rows, 확인필요: issues };
  }

  function validateRegistry(rows, departments) {
    const source = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
    const allowed = new Set((Array.isArray(departments) ? departments : []).map(text).filter(Boolean));
    const issues = [];
    const seen = new Set();
    const required = ["접수번호", "접수일", "국회구분", "위원회", "요구의원", "요구유형", "문항번호", "요구내용", "요구기간_시작", "요구기간_끝", "제출기한", "제출형식", "배분구분", "배분과", "처리상태"];
    source.forEach((row, index) => {
      const rowNumber = index + 2;
      required.filter((key) => !text(row[key])).forEach((key) => issues.push(issue("공백", `${key} 값이 비어 있습니다.`, { 행: rowNumber, 열: key })));
      const department = text(row.배분과);
      if (department && allowed.size && !allowed.has(department)) issues.push(issue("조직도불일치", `${department}는 조직도에 없는 과입니다.`, { 행: rowNumber, 열: "배분과" }));
      const start = number(row.요구기간_시작);
      const end = number(row.요구기간_끝);
      if (start !== null && end !== null && start > end) issues.push(issue("기간역전", `요구기간 시작 ${start}이 끝 ${end}보다 늦습니다.`, { 행: rowNumber }));
      ["접수일", "제출기한"].forEach((key) => {
        if (text(row[key]) && !datePattern.test(text(row[key]))) issues.push(issue("날짜형식", `${key}은 YYYY-MM-DD 형식이어야 합니다.`, { 행: rowNumber, 열: key }));
      });
      if (datePattern.test(text(row.접수일)) && datePattern.test(text(row.제출기한)) && text(row.제출기한) < text(row.접수일)) {
        issues.push(issue("기한역전", "제출기한이 접수일보다 빠릅니다.", { 행: rowNumber, 열: "제출기한" }));
      }
      const receipt = text(row.접수번호);
      if (receipt) {
        if (seen.has(receipt)) issues.push(issue("중복접수", `${receipt} 접수번호가 중복되었습니다.`, { 행: rowNumber, 열: "접수번호" }));
        seen.add(receipt);
      }
    });
    return { 행: source, 확인필요: issues };
  }

  return { expectedRecentYears, rowsFromMatrix, validateReply, validateRegistry };
});
