const flow = require("../web/flow.js");
const organization = require("./org.json");

const EMPTY_DB = Object.freeze({ version: 1, cases: [], log: [] });
const BLOB_PATH = "cases.json";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const copy = (value) => JSON.parse(JSON.stringify(value));

function createBlobStore(options = {}) {
  const token = options.token || process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN 환경변수가 설정되지 않았습니다.");
  return {
    async load() {
      const { get } = await import("@vercel/blob");
      const result = await get(BLOB_PATH, { access: "private", token, useCache: false });
      if (!result) return copy(EMPTY_DB);
      if (result.statusCode !== 200 || !result.stream) throw new Error("cases.json을 읽지 못했습니다.");
      const parsed = JSON.parse(await new Response(result.stream).text());
      return parsed && Array.isArray(parsed.cases) && Array.isArray(parsed.log) ? parsed : copy(EMPTY_DB);
    },
    async save(db) {
      const { put } = await import("@vercel/blob");
      await put(BLOB_PATH, JSON.stringify(db), {
        access: "private",
        token,
        allowOverwrite: true,
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
      });
    },
  };
}

function sendJson(response, statusCode, body) {
  return response.status(statusCode).json(body);
}

function getDepartmentNames(org) {
  const rows = Array.isArray(org) ? org : org?.departments;
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.department ?? row?.과 ?? "").trim())
    .filter(Boolean);
}

function createOpenAIRecommender(options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  return async function recommend(requestText, org) {
    if (!apiKey) {
      const error = new Error("OPENAI_API_KEY 환경변수가 설정되지 않아 AI 추천을 사용할 수 없습니다.");
      error.statusCode = 500;
      throw error;
    }
    const departments = getDepartmentNames(org);
    const allowed = new Set(departments);
    const response = await fetchImpl(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "국회 자료요구 문항의 소관 과 후보를 추천한다.",
              `허용 과 목록: ${JSON.stringify(departments)}`,
              "허용 과 목록 안에서만 최대 3개를 고르고 각 근거를 한 문장으로 작성한다.",
              "적절한 과가 없으면 후보는 빈 배열, 해당없음은 true로 반환한다.",
              "반드시 {\"후보\":[{\"과\":\"...\",\"근거\":\"...\"}],\"해당없음\":false} 형식의 JSON 객체만 반환한다.",
            ].join("\n"),
          },
          { role: "user", content: requestText },
        ],
      }),
    });
    if (!response.ok) {
      const error = new Error(`OpenAI AI 추천 호출에 실패했습니다. (${response.status})`);
      error.statusCode = 502;
      throw error;
    }
    let parsed;
    try {
      const payload = await response.json();
      parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "");
    } catch {
      const error = new Error("OpenAI AI 추천 응답의 JSON 형식이 올바르지 않습니다.");
      error.statusCode = 502;
      throw error;
    }
    const seen = new Set();
    const candidates = (Array.isArray(parsed?.후보) ? parsed.후보 : [])
      .map((candidate) => ({
        과: String(candidate?.과 || "").trim(),
        근거: String(candidate?.근거 || "").trim(),
      }))
      .filter((candidate) => candidate.과 && candidate.근거 && allowed.has(candidate.과) && !seen.has(candidate.과) && seen.add(candidate.과))
      .slice(0, 3);
    if (parsed?.해당없음 === true || candidates.length === 0) return { 후보: [], 해당없음: true };
    return { 후보: candidates, 해당없음: false };
  };
}

function createApp(options = {}) {
  const org = options.organization || organization;
  const storeFactory = options.store ? null : (options.storeFactory || createBlobStore);
  const recommendAI = options.recommendAI || createOpenAIRecommender({
    apiKey: Object.prototype.hasOwnProperty.call(options, "openAiApiKey") ? options.openAiApiKey : undefined,
    fetchImpl: options.openAiFetch,
  });
  let store = options.store || null;

  return async function app(request, response) {
    try {
      if (request.method !== "POST") {
        if (request.method === "GET") {
          if (!store) store = storeFactory();
          return sendJson(response, 200, await store.load());
        }
        response.setHeader("Allow", "GET, POST");
        return sendJson(response, 405, { error: "GET과 POST만 지원합니다." });
      }
      if (request.body?.작업 === "AI추천") {
        const requestText = String(request.body?.요구내용 || "").trim();
        if (!requestText) return sendJson(response, 400, { error: "AI추천에는 요구내용이 필요합니다." });
        return sendJson(response, 200, await recommendAI(requestText, org));
      }
      if (!store) store = storeFactory();
      const result = flow.apply(await store.load(), request.body, org);
      await store.save(result.db);
      return sendJson(response, 200, { ok: true, 상태: result.item.상태, 문항: result.item });
    } catch (error) {
      if (error instanceof flow.FlowError) return sendJson(response, error.statusCode, { error: error.message });
      if (error.statusCode) return sendJson(response, error.statusCode, { error: error.message });
      console.error("서버 처리 오류", error);
      return sendJson(response, 500, { error: "서버에서 요청을 처리하지 못했습니다." });
    }
  };
}

const handler = createApp();
module.exports = handler;
module.exports.createApp = createApp;
module.exports.createBlobStore = createBlobStore;
module.exports.createOpenAIRecommender = createOpenAIRecommender;
