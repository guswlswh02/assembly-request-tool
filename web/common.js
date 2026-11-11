(function initializeCommon(root) {
  "use strict";
  const STORAGE_KEY = "a-department-request-cases-v1";
  const API_URL = "/api/app";
  const SERVER_MODE = root.location?.hostname?.endsWith(".vercel.app") || false;
  let historyRows = null;
  let revealObserver = null;
  const emptyDb = () => ({ version: 1, cases: [], log: [] });

  function parseCsv(text) {
    if (root.Papa?.parse) {
      const result = root.Papa.parse(String(text).replace(/^\uFEFF/, ""), {
        header: true, skipEmptyLines: "greedy", transformHeader: (header) => header.trim(),
      });
      if (result.errors.length) throw new Error(`CSV를 읽지 못했습니다: ${result.errors[0].message}`);
      return result.data;
    }
    const source = String(text).replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
      else field += char;
    }
    if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
    const [headers, ...dataRows] = rows;
    if (!headers) return [];
    return dataRows.filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(
      headers.map((header, index) => [header.trim(), values[index] ?? ""]),
    ));
  }

  async function loadText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`자료를 읽지 못했습니다: ${url} (${response.status})`);
    return response.text();
  }
  const loadCsv = async (url) => parseCsv(await loadText(url));

  function loadLocalDb() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(value)) return { version: 1, cases: value, log: [] };
      if (value && Array.isArray(value.cases) && Array.isArray(value.log)) return value;
      return emptyDb();
    } catch { return emptyDb(); }
  }
  const saveLocalDb = (db) => localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

  async function requestApi(method, body) {
    const response = await fetch(API_URL, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({ error: "서버 응답을 읽지 못했습니다." }));
    if (!response.ok) {
      const error = new Error(data.error || `서버 요청 실패 (${response.status})`);
      error.statusCode = response.status;
      throw error;
    }
    return data;
  }

  const loadDb = async () => SERVER_MODE ? requestApi("GET") : loadLocalDb();
  async function saveDb(db) {
    if (SERVER_MODE) throw new Error("서버 저장은 상태 작업을 통해서만 할 수 있습니다.");
    saveLocalDb(db);
    return db;
  }
  async function applyAction(request, organization) {
    if (SERVER_MODE) {
      const response = await requestApi("POST", request);
      return { item: response.문항, db: null };
    }
    if (!root.RequestFlow) throw new Error("공통 상태 엔진을 불러오지 못했습니다.");
    const result = root.RequestFlow.apply(loadLocalDb(), request, organization);
    saveLocalDb(result.db);
    return result;
  }
  async function recommendAI(requestText) {
    if (!SERVER_MODE) throw new Error("AI 추천은 Vercel 배포 화면에서만 사용할 수 있습니다.");
    return requestApi("POST", { 작업: "AI추천", 요구내용: requestText });
  }
  async function clearDb() {
    if (SERVER_MODE) throw new Error("서버 저장 자료는 화면에서 전체 초기화할 수 없습니다.");
    localStorage.removeItem(STORAGE_KEY);
  }

  async function loadHistory() {
    if (!historyRows) historyRows = await loadCsv("data/접수대장.csv");
    return historyRows;
  }
  function historyFor(item, rows = historyRows || []) {
    const keyword = String(item?.후보?.[0]?.근거키워드 || "").trim();
    if (!keyword) return { keyword: "", count: 0, mainDepartment: "", recent: [] };
    const matches = rows.filter((row) => String(row.요구내용 || "").includes(keyword));
    const counts = new Map();
    matches.forEach((row) => counts.set(row.배분과, (counts.get(row.배분과) || 0) + 1));
    const mainDepartment = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))[0]?.[0] || "";
    const recent = [...matches].sort((a, b) => String(b.접수일).localeCompare(String(a.접수일))).slice(0, 5);
    return { keyword, count: matches.length, mainDepartment, recent };
  }

  const storageLabel = () => SERVER_MODE ? "서버 공동 저장 · Vercel Blob" : "이 브라우저에만 저장";
  function renderStorageMode(target = "#storageMode") {
    const element = typeof target === "string" ? document.querySelector(target) : target;
    if (!element) return;
    element.textContent = storageLabel();
    element.dataset.mode = SERVER_MODE ? "server" : "browser";
    element.title = SERVER_MODE ? "여러 사용자가 같은 서버 기록을 봅니다." : "이 주소와 브라우저에서만 기록을 볼 수 있습니다.";
  }
  function initializeReveal() {
    const elements = document.querySelectorAll("[data-reveal]");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("show"));
      return;
    }
    revealObserver ||= new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("show");
      revealObserver.unobserve(entry.target);
    }), { threshold: 0.12 });
    elements.forEach((element) => {
      if (!element.classList.contains("show")) revealObserver.observe(element);
    });
  }

  root.AppCommon = {
    API_URL, SERVER_MODE, STORAGE_KEY, applyAction, clearDb, historyFor, initializeReveal,
    loadCsv, loadDb, loadHistory, loadText, parseCsv, renderStorageMode, saveDb, storageLabel,
    recommendAI,
  };
})(globalThis);
