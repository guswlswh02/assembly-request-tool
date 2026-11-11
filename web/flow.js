(function initializeFlow(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RequestFlow = api;
})(typeof globalThis === "undefined" ? this : globalThis, function createFlow() {
  "use strict";

  const STATUS = Object.freeze({
    RECEIVED: "접수", ASSIGNED: "배분확정", RESPONDING: "회신중",
    REPLIED: "회신완료", REASSIGNMENT_REQUESTED: "재배정요청",
    SUPPLEMENT_REQUESTED: "보완요청", CONFIRMED: "확정",
  });
  const ACTIONS = Object.freeze({
    receive: "receive", 접수: "receive", assign: "assign", 배분: "assign",
    respond: "respond", 회신: "respond",
    requestReassignment: "requestReassignment", 재배정요청: "requestReassignment",
    requestSupplement: "requestSupplement", 보완요청: "requestSupplement",
    confirm: "confirm", 확정: "confirm",
    excludeReply: "excludeReply", 회신제외: "excludeReply",
    restoreReply: "restoreReply", 회신복구: "restoreReply",
  });
  const METHODS = Object.freeze({ rule: "규칙", 규칙: "규칙", ai: "AI", AI: "AI", manual: "수정", 수정: "수정" });

  class FlowError extends Error {
    constructor(statusCode, message) {
      super(message);
      this.name = "FlowError";
      this.statusCode = statusCode;
    }
  }

  const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const cleanText = (value) => value === undefined || value === null ? "" : String(value).trim();
  function first(source, ...keys) {
    for (const key of keys) if (source[key] !== undefined) return source[key];
    return undefined;
  }
  function uniqueTexts(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(cleanText).filter(Boolean))];
  }
  function getDepartments(organization) {
    const rows = Array.isArray(organization) ? organization : organization?.departments;
    if (!Array.isArray(rows)) throw new FlowError(500, "조직도 형식이 올바르지 않습니다.");
    return new Set(rows.map((row) => cleanText(first(row, "department", "과"))).filter(Boolean));
  }
  function ensureDepartment(department, departments) {
    if (!department || !departments.has(department)) throw new FlowError(400, `${department || "빈 값"}은 조직도에 있는 과가 아닙니다.`);
  }
  function normalizeDb(db) {
    const source = db && typeof db === "object" ? db : {};
    return {
      version: Number.isInteger(source.version) ? source.version : 1,
      cases: Array.isArray(source.cases) ? copy(source.cases) : [],
      log: Array.isArray(source.log) ? copy(source.log) : [],
    };
  }
  function normalizeCandidates(value, departments) {
    return (Array.isArray(value) ? value : []).slice(0, 3).map((candidate) => {
      const source = typeof candidate === "string" ? { 과: candidate } : candidate || {};
      const department = cleanText(first(source, "department", "과"));
      ensureDepartment(department, departments);
      const normalized = { 과: department };
      const score = Number(first(source, "score", "점수"));
      const keyword = cleanText(first(source, "evidenceKeyword", "근거키워드"));
      const evidence = cleanText(first(source, "evidence", "근거"));
      const origin = cleanText(first(source, "origin", "출처"));
      if (Number.isFinite(score)) normalized.점수 = score;
      if (keyword) normalized.근거키워드 = keyword;
      if (evidence) normalized.근거 = evidence;
      if (origin === "AI" || origin === "규칙") normalized.출처 = origin;
      return normalized;
    });
  }
  function requireCase(db, id) {
    const item = db.cases.find((entry) => entry.id === id);
    if (!item) throw new FlowError(400, `문항 ${id || "빈 값"}을 찾을 수 없습니다.`);
    return item;
  }
  function assertStatus(item, allowed, actionLabel) {
    if (!allowed.includes(item.상태)) throw new FlowError(409, `${item.상태} 상태에서는 ${actionLabel} 작업을 할 수 없습니다.`);
  }
  function appendLog(db, action, item, department, timestamp) {
    const entry = { 일시: timestamp, 작업: action, 문항: item.id };
    if (department) entry.과 = department;
    db.log.push(entry);
  }

  function receive(db, request, departments, timestamp) {
    const id = cleanText(request.id);
    const requestText = cleanText(first(request, "requestText", "요구내용"));
    if (!id || !requestText) throw new FlowError(400, "접수에는 id와 요구내용이 필요합니다.");
    if (db.cases.some((entry) => entry.id === id)) throw new FlowError(409, `문항 ${id}가 이미 접수되었습니다.`);
    const item = {
      id,
      파일명: cleanText(first(request, "fileName", "파일명")), 위원회: cleanText(first(request, "committee", "위원회")),
      의원: cleanText(first(request, "legislator", "의원")), 제출기한: cleanText(first(request, "dueDate", "제출기한")),
      문항번호: cleanText(first(request, "itemNumber", "문항번호")), 요구내용: requestText,
      세부항목: cleanText(first(request, "subItems", "세부항목")), 비고: cleanText(first(request, "note", "비고")),
      상태: STATUS.RECEIVED, 주관과: "", 협조과: [], 확정방법: "",
      후보: normalizeCandidates(first(request, "candidates", "후보"), departments),
      과별회신: {}, 회신이력: [], 재배정: [], 보완: [], 확정코멘트: "", 일시: timestamp,
    };
    db.cases.push(item);
    appendLog(db, "접수", item, "", timestamp);
    return item;
  }

  function assign(db, request, departments, timestamp) {
    const item = requireCase(db, cleanText(request.id));
    assertStatus(item, [STATUS.RECEIVED, STATUS.REASSIGNMENT_REQUESTED, STATUS.ASSIGNED], "배분");
    const owner = cleanText(first(request, "ownerDepartment", "주관과"));
    const supports = uniqueTexts(first(request, "supportDepartments", "협조과"));
    const method = METHODS[cleanText(first(request, "decisionMethod", "확정방법"))];
    ensureDepartment(owner, departments);
    supports.forEach((department) => ensureDepartment(department, departments));
    if (supports.includes(owner)) throw new FlowError(400, "주관 과를 협조 과에 중복 지정할 수 없습니다.");
    if (!method) throw new FlowError(400, "확정방법은 규칙, AI, 수정 중 하나여야 합니다.");
    item.상태 = STATUS.ASSIGNED;
    item.주관과 = owner;
    item.협조과 = supports;
    item.확정방법 = method;
    item.과별회신 = {};
    item.일시 = timestamp;
    if (first(request, "candidates", "후보") !== undefined) item.후보 = normalizeCandidates(first(request, "candidates", "후보"), departments);
    appendLog(db, "배분", item, owner, timestamp);
    return item;
  }

  function respond(db, request, departments, timestamp) {
    const item = requireCase(db, cleanText(request.id));
    assertStatus(item, [STATUS.ASSIGNED, STATUS.RESPONDING, STATUS.SUPPLEMENT_REQUESTED], "회신");
    const department = cleanText(first(request, "department", "과"));
    ensureDepartment(department, departments);
    const assigned = new Set([item.주관과, ...(item.협조과 || [])]);
    if (!assigned.has(department)) throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
    const pendingSupplement = [...(item.보완 || [])].reverse().find((entry) => !entry.해결);
    if (item.상태 === STATUS.SUPPLEMENT_REQUESTED && pendingSupplement?.과 !== department) {
      throw new FlowError(403, `${department}는 현재 보완요청을 받은 과가 아닙니다.`);
    }
    const response = {};
    const fileName = cleanText(first(request, "fileName", "파일명"));
    const memo = cleanText(first(request, "memo", "메모"));
    const rows = first(request, "rows", "행");
    const issues = first(request, "issues", "확인필요");
    if (fileName) response.파일명 = fileName;
    if (Array.isArray(rows)) response.행 = copy(rows);
    if (memo) response.메모 = memo;
    if (Array.isArray(issues)) response.확인필요 = copy(issues);
    if (!fileName && !memo && !Array.isArray(rows)) throw new FlowError(400, "회신에는 파일명, 행 또는 메모가 필요합니다.");
    response.일시 = timestamp;
    item.회신이력 ||= [];
    if (item.과별회신[department]) item.회신이력.push({ 과: department, ...copy(item.과별회신[department]), 대체일시: timestamp });
    item.과별회신[department] = response;
    if (pendingSupplement?.과 === department) {
      pendingSupplement.해결 = true;
      pendingSupplement.회신일시 = timestamp;
    }
    item.상태 = [...assigned].every((name) => item.과별회신[name]) ? STATUS.REPLIED : STATUS.RESPONDING;
    item.일시 = timestamp;
    appendLog(db, "회신", item, department, timestamp);
    return item;
  }

  function requestReassignment(db, request, departments, timestamp) {
    const item = requireCase(db, cleanText(request.id));
    assertStatus(item, [STATUS.ASSIGNED, STATUS.RESPONDING, STATUS.SUPPLEMENT_REQUESTED], "재배정요청");
    const department = cleanText(first(request, "department", "과"));
    const reason = cleanText(first(request, "reason", "사유"));
    const preferred = cleanText(first(request, "preferredDepartment", "희망과"));
    ensureDepartment(department, departments);
    if (preferred) ensureDepartment(preferred, departments);
    if (![item.주관과, ...(item.협조과 || [])].includes(department)) throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
    if (!reason) throw new FlowError(400, "재배정요청에는 사유가 필요합니다.");
    const entry = { 과: department, 사유: reason, 일시: timestamp };
    if (preferred) entry.희망과 = preferred;
    item.재배정.push(entry);
    item.상태 = STATUS.REASSIGNMENT_REQUESTED;
    item.일시 = timestamp;
    appendLog(db, "재배정요청", item, department, timestamp);
    return item;
  }

  function requestSupplement(db, request, departments, timestamp) {
    const item = requireCase(db, cleanText(request.id));
    assertStatus(item, [STATUS.RESPONDING, STATUS.REPLIED], "보완요청");
    const department = cleanText(first(request, "department", "과"));
    const reason = cleanText(first(request, "reason", "사유"));
    ensureDepartment(department, departments);
    if (![item.주관과, ...(item.협조과 || [])].includes(department)) throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
    if (!item.과별회신?.[department]) throw new FlowError(400, `${department}의 기존 회신이 없어 보완을 요청할 수 없습니다.`);
    if (!reason) throw new FlowError(400, "보완요청에는 사유가 필요합니다.");
    item.보완 ||= [];
    item.보완.push({ 과: department, 사유: reason, 일시: timestamp, 해결: false });
    item.상태 = STATUS.SUPPLEMENT_REQUESTED;
    item.일시 = timestamp;
    appendLog(db, "보완요청", item, department, timestamp);
    return item;
  }

  function confirm(db, request, _departments, timestamp) {
    const item = requireCase(db, cleanText(request.id));
    assertStatus(item, [STATUS.REPLIED], "확정");
    const comment = cleanText(first(request, "comment", "코멘트", "확정코멘트"));
    if (!comment) throw new FlowError(400, "확정에는 코멘트가 필요합니다.");
    item.확정코멘트 = comment;
    item.상태 = STATUS.CONFIRMED;
    item.일시 = timestamp;
    appendLog(db, "확정", item, "", timestamp);
    return item;
  }

  function changeReplyInclusion(db, request, departments, timestamp, excluded) {
    const item = requireCase(db, cleanText(request.id));
    const department = cleanText(first(request, "department", "과"));
    const reason = cleanText(first(request, "reason", "사유"));
    ensureDepartment(department, departments);
    if (![item.주관과, ...(item.협조과 || [])].includes(department)) throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
    const response = item.과별회신?.[department];
    if (!response) throw new FlowError(400, `${department}의 회신이 없습니다.`);
    if (excluded && !reason) throw new FlowError(400, "회신 제외에는 사유가 필요합니다.");
    response.제출처리이력 ||= [];
    response.제출처리이력.push({ 작업: excluded ? "제출본 제외" : "제출본 복구", 사유: reason, 일시: timestamp });
    response.제출제외 = excluded;
    if (excluded) response.제출제외사유 = reason;
    if (!excluded) response.제출복구일시 = timestamp;
    item.일시 = timestamp;
    appendLog(db, excluded ? "회신제외" : "회신복구", item, department, timestamp);
    return item;
  }

  function excludeReply(db, request, departments, timestamp) {
    return changeReplyInclusion(db, request, departments, timestamp, true);
  }

  function restoreReply(db, request, departments, timestamp) {
    return changeReplyInclusion(db, request, departments, timestamp, false);
  }

  function apply(db, request, organization) {
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new FlowError(400, "요청 본문은 객체여야 합니다.");
    const nextDb = normalizeDb(db);
    const departments = getDepartments(organization);
    const action = ACTIONS[cleanText(first(request, "action", "작업"))];
    if (!action) throw new FlowError(400, "지원하지 않는 작업입니다.");
    const timestamp = new Date().toISOString();
    const handlers = { receive, assign, respond, requestReassignment, requestSupplement, confirm, excludeReply, restoreReply };
    const item = handlers[action](nextDb, request, departments, timestamp);
    return { db: nextDb, item: copy(item) };
  }

  return { apply, FlowError, STATUS };
});
