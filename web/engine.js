(function initialize(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    const fs = require("node:fs");
    const path = require("node:path");
    const dataDir = path.resolve(__dirname, "data");
    const rulesText = fs.readFileSync(
      path.join(dataDir, "배분기준표_보강.csv"),
      "utf8",
    );
    const organizationText = fs.readFileSync(
      path.join(dataDir, "A부_조직도_26개과.csv"),
      "utf8",
    );

    api.initializeFromCsv(rulesText, organizationText);
    api.ready = Promise.resolve(api);
    module.exports = api;
    return;
  }

  root.RequestClassifier = api;
  api.ready = Promise.all([
    fetch("data/배분기준표_보강.csv").then((response) => {
      if (!response.ok) throw new Error(`배분기준표를 읽지 못했습니다: ${response.status}`);
      return response.text();
    }),
    fetch("data/A부_조직도_26개과.csv").then((response) => {
      if (!response.ok) throw new Error(`조직도를 읽지 못했습니다: ${response.status}`);
      return response.text();
    }),
  ]).then(([rulesText, organizationText]) => {
    api.initializeFromCsv(rulesText, organizationText);
    return api;
  });
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  let engine = null;

  function parseCsv(text) {
    if (typeof globalThis !== "undefined" && globalThis.Papa?.parse) {
      const result = globalThis.Papa.parse(String(text).replace(/^\uFEFF/, ""), {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.trim(),
      });
      if (result.errors.length) throw new Error(`CSV를 읽지 못했습니다: ${result.errors[0].message}`);
      return result.data;
    }

    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const source = String(text).replace(/^\uFEFF/, "");

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];

      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
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

    const [headers, ...dataRows] = rows;
    if (!headers) return [];

    return dataRows
      .filter((values) => values.some((value) => value.trim() !== ""))
      .map((values) => Object.fromEntries(
        headers.map((header, index) => [header.trim(), values[index] ?? ""]),
      ));
  }

  function buildEngine(ruleRows, organizationRows) {
    const allowedDepartments = new Set(
      organizationRows.map((row) => row.과.trim()).filter(Boolean),
    );
    const rules = ruleRows.map((row, index) => ({
      order: index,
      department: row.과.trim(),
      keyword: row.키워드.trim(),
      exclusions: row.제외어
        .split("|")
        .map((word) => word.trim())
        .filter(Boolean),
      priority: Number(row.우선순위),
    })).filter((rule) => (
      allowedDepartments.has(rule.department)
      && rule.keyword
      && Number.isFinite(rule.priority)
    ));

    return function classify(requestText) {
      const text = String(requestText ?? "").trim();
      if (!text) return [];

      const bestByDepartment = new Map();

      for (const rule of rules) {
        if (!text.includes(rule.keyword)) continue;
        if (rule.exclusions.some((word) => text.includes(word))) continue;

        const score = rule.priority + Array.from(rule.keyword).length / 10;
        const previous = bestByDepartment.get(rule.department);
        if (
          !previous
          || score > previous.점수
          || (score === previous.점수 && rule.order < previous.order)
        ) {
          bestByDepartment.set(rule.department, {
            과: rule.department,
            점수: score,
            근거키워드: rule.keyword,
            order: rule.order,
          });
        }
      }

      return [...bestByDepartment.values()]
        .sort((left, right) => (
          right.점수 - left.점수
          || left.order - right.order
          || left.과.localeCompare(right.과, "ko")
        ))
        .slice(0, 3)
        .map(({ order, ...candidate }) => candidate);
    };
  }

  function initializeFromCsv(rulesText, organizationText) {
    const ruleRows = parseCsv(rulesText);
    const organizationRows = parseCsv(organizationText);
    engine = buildEngine(ruleRows, organizationRows);
  }

  function classify(requestText) {
    if (!engine) {
      throw new Error("엔진 준비가 끝나지 않았습니다. 브라우저에서는 ready를 먼저 기다리세요.");
    }
    return engine(requestText);
  }

  return {
    classify,
    initializeFromCsv,
    parseCsv,
    ready: null,
  };
});
