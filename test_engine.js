const fs = require("node:fs");
const path = require("node:path");

const engine = require("./web/engine.js");

const testPath = path.join(__dirname, "data", "시험_요구문항_40건.csv");
const testRows = engine.parseCsv(fs.readFileSync(testPath, "utf8"));

let firstPlaceCorrect = 0;
let topThreeCorrect = 0;
const wrongRows = [];

for (const test of testRows) {
  const candidates = engine.classify(test.요구내용);
  const departments = candidates.map((candidate) => candidate.과);
  const firstCorrect = departments[0] === test.정답_배분과;
  const topThreeContainsAnswer = departments.includes(test.정답_배분과);

  if (firstCorrect) firstPlaceCorrect += 1;
  if (topThreeContainsAnswer) topThreeCorrect += 1;
  if (!firstCorrect) {
    wrongRows.push({
      시험번호: test.시험번호,
      요구내용: test.요구내용,
      정답: test.정답_배분과,
      "엔진 결과": candidates.length
        ? candidates.map((candidate) => `${candidate.과}(${candidate.점수.toFixed(1)}, ${candidate.근거키워드})`).join(" / ")
        : "후보 없음",
    });
  }
}

console.log(`1순위 정답 ${firstPlaceCorrect}/${testRows.length} · 3순위 안 ${topThreeCorrect}/${testRows.length}`);
console.log("틀린 문항:");
if (wrongRows.length === 0) {
  console.log("없음");
} else {
  console.table(wrongRows);
}
