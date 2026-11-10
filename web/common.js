(function initializeCommon(root) {
  const STORAGE_KEY = "a-department-request-cases-v1";

  function parseCsv(text) {
    const source = String(text).replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

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

    if (field.length || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }

    const [headers, ...dataRows] = rows;
    if (!headers) return [];
    return dataRows
      .filter((values) => values.some((value) => value.trim()))
      .map((values) => Object.fromEntries(
        headers.map((header, index) => [header.trim(), values[index] ?? ""]),
      ));
  }

  async function loadText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`자료를 읽지 못했습니다: ${url} (${response.status})`);
    return response.text();
  }

  async function loadCsv(url) {
    return parseCsv(await loadText(url));
  }

  function loadCases() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveCases(cases) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  }

  function clearCases() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function addCases(newCases) {
    const cases = [...loadCases(), ...newCases];
    saveCases(cases);
    return cases;
  }

  function initializeReveal() {
    const elements = document.querySelectorAll("[data-reveal]");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("show"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("show");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    elements.forEach((element) => observer.observe(element));
  }

  root.AppCommon = {
    STORAGE_KEY,
    addCases,
    clearCases,
    initializeReveal,
    loadCases,
    loadCsv,
    loadText,
    parseCsv,
    saveCases,
  };
})(globalThis);
