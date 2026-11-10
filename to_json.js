const fs = require("node:fs");
const path = require("node:path");

const inputPath = path.join(__dirname, "data", "A부_조직도_26개과.csv");
const outputPath = path.join(__dirname, "org.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

const csvText = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const [headers, ...dataRows] = parseCsv(csvText);
const column = Object.fromEntries(headers.map((header, index) => [header, index]));

for (const required of ["실국", "과", "대표키워드"]) {
  if (!(required in column)) {
    throw new Error(`필수 열이 없습니다: ${required}`);
  }
}

const organization = dataRows
  .filter((row) => row.some((value) => value.trim() !== ""))
  .map((row) => ({
    실국: row[column.실국].trim(),
    과: row[column.과].trim(),
    대표키워드: row[column.대표키워드]
      .split("|")
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  }));

fs.writeFileSync(outputPath, `${JSON.stringify(organization, null, 2)}\n`, "utf8");

console.log(`원소 수: ${organization.length}`);
console.log("첫 원소:");
console.log(JSON.stringify(organization[0], null, 2));
