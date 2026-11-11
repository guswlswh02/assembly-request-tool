const assert = require("node:assert/strict");
const fs = require("node:fs");
const validator = require("./web/validate.js");

function parseCsv(source) {
  const records = []; let row = [], field = "", quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); records.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field || row.length) { row.push(field); records.push(row); }
  const [headers, ...data] = records;
  return data.filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, "").trim(), values[index] || ""])));
}

const valid = [
  ["가상 최근 3년 사업 실적"],
  ["연도", "항목명", "예산(천원)", "집행액(천원)", "비고"],
  [2024, "가", 100, 90, ""],
  [2025, "나", 200, 210, "추가 재원"],
  [2026, "다", 300, 300, ""],
  ["합계", "", 600, 600, ""],
];
const validResult = validator.validateReply(valid, { 요구내용: "가상 최근 3년 사업 실적", 기준연도: 2026 });
assert.deepEqual(validResult.확인필요, []);
assert.equal(validResult.행.length, 4);

const invalid = [
  ["다른 요구"],
  ["연도", "항목명", "예산(천원)", "집행액(천원)", "비고"],
  [2024, "가", 100, 120, ""],
  [2026, "나", 200, 190, ""],
  ["합계", "", 999, 310, ""],
];
const invalidResult = validator.validateReply(invalid, { 요구내용: "가상 최근 3년 사업 실적", 기준연도: 2026 });
assert(invalidResult.확인필요.some((entry) => entry.종류 === "양식"));
assert(invalidResult.확인필요.some((entry) => entry.종류 === "연도누락" && entry.내용.includes("2025")));
assert(invalidResult.확인필요.some((entry) => entry.종류 === "집행초과"));
assert(invalidResult.확인필요.some((entry) => entry.종류 === "합계불일치"));

const registry = [
  { 접수번호: "2026-1", 접수일: "2026-10-01", 국회구분: "국감", 위원회: "행안위", 요구의원: "의원A", 요구유형: "자료요구", 문항번호: "1", 요구내용: "가상", 요구기간_시작: "2026", 요구기간_끝: "2025", 제출기한: "2026/09/30", 배분과: "없는과", 처리상태: "접수" },
  { 접수번호: "2026-1", 접수일: "2026-10-02", 국회구분: "", 위원회: "행안위", 요구의원: "의원B", 요구유형: "자료요구", 문항번호: "2", 요구내용: "가상", 요구기간_시작: "2025", 요구기간_끝: "2026", 제출기한: "2026-10-01", 배분과: "안전정책과", 처리상태: "접수" },
];
const registryResult = validator.validateRegistry(registry, ["안전정책과"]);
["조직도불일치", "기간역전", "날짜형식", "기한역전", "중복접수", "공백"].forEach((type) => {
  assert(registryResult.확인필요.some((entry) => entry.종류 === type), `${type} 검사가 없습니다.`);
});
assert.deepEqual(registryResult.행, registry, "원본 접수대장 값이 바뀌면 안 됩니다.");

const actualRows = parseCsv(fs.readFileSync("data/검증용_접수대장_120건.csv", "utf8"));
const actualDepartments = JSON.parse(fs.readFileSync("api/org.json", "utf8")).departments.map((row) => row.department);
const actualResult = validator.validateRegistry(actualRows, actualDepartments);
assert.equal(actualRows.length, 120);

console.table([
  { 시험: "정상 회신", 결과: `${validResult.확인필요.length}건`, 판정: "통과" },
  { 시험: "회신 이상 4종", 결과: `${invalidResult.확인필요.length}건`, 판정: "통과" },
  { 시험: "접수대장 이상 6종", 결과: `${registryResult.확인필요.length}건`, 판정: "통과" },
  { 시험: "검증용 접수대장 120건", 결과: `확인필요 ${actualResult.확인필요.length}건`, 판정: "통과" },
]);
