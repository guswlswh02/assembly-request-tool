const assert = require("node:assert/strict");
const { createApp } = require("./api/app.js");

class FakeStore {
  constructor() {
    this.db = { version: 1, cases: [], log: [] };
    this.saveCount = 0;
  }
  async load() {
    return JSON.parse(JSON.stringify(this.db));
  }
  async save(db) {
    this.db = JSON.parse(JSON.stringify(db));
    this.saveCount += 1;
  }
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
  };
}

async function call(app, method, body) {
  const response = createResponse();
  await app({ method, body }, response);
  return response;
}

function fakeOpenAIResponse(result, requests = []) {
  return async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(result) } }] };
      },
    };
  };
}

async function main() {
  const store = new FakeStore();
  const app = createApp({ store });
  const results = [];
  async function check(name, method, body, expectedStatus) {
    const response = await call(app, method, body);
    assert.equal(response.statusCode, expectedStatus, `${name}: ${JSON.stringify(response.body)}`);
    results.push({ 시험: name, 예상: expectedStatus, 결과: response.statusCode, 판정: "통과" });
    return response;
  }

  await check("빈 저장소 조회", "GET", undefined, 200);
  const received = await check("접수", "POST", {
    작업: "접수", id: "TEST-01", 파일명: "sample.pdf", 위원회: "행정위원회",
    의원: "가상의원", 문항번호: "1", 요구내용: "디지털 전환 실적",
    이름: "저장하면 안 됨", 연락처: "010-0000-0000",
    후보: [{ 과: "디지털정책과", 점수: 3.6, 근거키워드: "디지털" }],
  }, 200);
  assert.equal("이름" in received.body.문항, false);
  assert.equal("연락처" in received.body.문항, false);

  await check("조직도 밖 과 배분", "POST", {
    작업: "배분", id: "TEST-01", 주관과: "없는과", 협조과: [], 확정방법: "규칙",
  }, 400);
  await check("정상 배분", "POST", {
    작업: "배분", id: "TEST-01", 주관과: "디지털정책과", 협조과: ["운영지원과"], 확정방법: "규칙",
  }, 200);
  await check("담당 아닌 과 회신", "POST", {
    작업: "회신", id: "TEST-01", 과: "안전정책과", 메모: "회신",
  }, 403);
  const firstReply = await check("주관 과 회신", "POST", {
    작업: "회신", id: "TEST-01", 과: "디지털정책과", 파일명: "owner.xlsx", 행: [{ 연도: 2026 }],
  }, 200);
  assert.equal(firstReply.body.상태, "회신중");
  const allReplies = await check("모든 과 회신", "POST", {
    작업: "회신", id: "TEST-01", 과: "운영지원과", 메모: "해당 없음",
  }, 200);
  assert.equal(allReplies.body.상태, "회신완료");
  await check("순서 밖 재배정", "POST", {
    작업: "재배정요청", id: "TEST-01", 과: "디지털정책과", 사유: "소관 아님",
  }, 409);
  await check("사유 없는 보완요청", "POST", {
    작업: "보완요청", id: "TEST-01", 과: "운영지원과",
  }, 400);
  const supplement = await check("정상 보완요청", "POST", {
    작업: "보완요청", id: "TEST-01", 과: "운영지원과", 사유: "합계 확인 필요",
  }, 200);
  assert.equal(supplement.body.상태, "보완요청");
  await check("보완 대상 아닌 과 회신", "POST", {
    작업: "회신", id: "TEST-01", 과: "디지털정책과", 메모: "재회신",
  }, 403);
  const supplemented = await check("보완 회신", "POST", {
    작업: "회신", id: "TEST-01", 과: "운영지원과", 메모: "합계 수정 회신",
  }, 200);
  assert.equal(supplemented.body.상태, "회신완료");
  assert.equal(supplemented.body.문항.회신이력.length, 1);
  assert.equal(supplemented.body.문항.회신이력[0].메모, "해당 없음");
  await check("코멘트 없는 확정", "POST", { 작업: "확정", id: "TEST-01" }, 400);
  const confirmed = await check("정상 확정", "POST", { 작업: "확정", id: "TEST-01", 코멘트: "확인 완료" }, 200);
  assert.equal(confirmed.body.상태, "확정");
  assert.equal(confirmed.body.문항.확정코멘트, "확인 완료");
  await check("사유 없는 회신 제외", "POST", { 작업: "회신제외", id: "TEST-01", 과: "운영지원과" }, 400);
  const excluded = await check("확정 뒤 회신 제외", "POST", { 작업: "회신제외", id: "TEST-01", 과: "운영지원과", 사유: "잘못된 형식의 파일" }, 200);
  assert.equal(excluded.body.상태, "확정");
  assert.equal(excluded.body.문항.과별회신.운영지원과.제출제외, true);
  const restored = await check("제외 회신 복구", "POST", { 작업: "회신복구", id: "TEST-01", 과: "운영지원과" }, 200);
  assert.equal(restored.body.문항.과별회신.운영지원과.제출제외, false);
  assert.equal(restored.body.문항.과별회신.운영지원과.제출처리이력.length, 2);

  await check("두 번째 접수", "POST", { 작업: "접수", id: "TEST-02", 요구내용: "안전점검 현황" }, 200);
  await check("두 번째 배분", "POST", {
    작업: "배분", id: "TEST-02", 주관과: "안전정책과", 협조과: [], 확정방법: "AI",
    후보: [{ 과: "안전정책과", 근거: "안전 정책 업무와 직접 관련됩니다.", 출처: "AI" }],
  }, 200);
  assert.equal(store.db.cases.find((item) => item.id === "TEST-02").확정방법, "AI");
  assert.equal(store.db.cases.find((item) => item.id === "TEST-02").후보[0].출처, "AI");
  await check("사유 없는 재배정", "POST", {
    작업: "재배정요청", id: "TEST-02", 과: "안전정책과",
  }, 400);
  const reassigned = await check("정상 재배정요청", "POST", {
    작업: "재배정요청", id: "TEST-02", 과: "안전정책과", 사유: "시설물 소관", 희망과: "시설안전과",
  }, 200);
  assert.equal(reassigned.body.상태, "재배정요청");
  assert.equal(store.db.cases.length, 2);
  assert.equal(store.db.log.length, 12);
  assert.equal(store.saveCount, 12);

  const aiRequests = [];
  const aiNormal = createApp({
    store,
    openAiApiKey: "test-key",
    openAiFetch: fakeOpenAIResponse({
      후보: [
        { 과: "디지털정책과", 근거: "디지털 전환 업무를 담당하는 과입니다." },
        { 과: "운영지원과", 근거: "기관 운영 지원과 연관될 수 있습니다." },
      ],
      해당없음: false,
    }, aiRequests),
  });
  const normalRecommendation = await call(aiNormal, "POST", { 작업: "AI추천", 요구내용: "디지털 전환 실적" });
  assert.equal(normalRecommendation.statusCode, 200);
  assert.equal(normalRecommendation.body.후보.length, 2);
  assert.equal(normalRecommendation.body.해당없음, false);
  assert.equal(aiRequests[0].body.model, "gpt-4o-mini");
  assert.equal(aiRequests[0].body.temperature, 0);
  assert.deepEqual(aiRequests[0].body.response_format, { type: "json_object" });
  results.push({ 시험: "AI 후보 추천", 예상: 200, 결과: 200, 판정: "통과" });

  const aiFiltered = createApp({
    store,
    openAiApiKey: "test-key",
    openAiFetch: fakeOpenAIResponse({
      후보: [
        { 과: "가상과", 근거: "목록 밖 과입니다." },
        { 과: "안전정책과", 근거: "안전 정책 업무와 직접 관련됩니다." },
        { 과: "안전정책과", 근거: "중복 후보입니다." },
      ],
      해당없음: false,
    }),
  });
  const filteredRecommendation = await call(aiFiltered, "POST", { 작업: "AI추천", 요구내용: "안전 정책 현황" });
  assert.equal(filteredRecommendation.statusCode, 200);
  assert.deepEqual(filteredRecommendation.body.후보, [{ 과: "안전정책과", 근거: "안전 정책 업무와 직접 관련됩니다." }]);
  results.push({ 시험: "AI 목록 밖 과 제거", 예상: 200, 결과: 200, 판정: "통과" });

  const aiNone = createApp({
    store,
    openAiApiKey: "test-key",
    openAiFetch: fakeOpenAIResponse({ 후보: [], 해당없음: true }),
  });
  const noRecommendation = await call(aiNone, "POST", { 작업: "AI추천", 요구내용: "소관을 정할 수 없는 문항" });
  assert.equal(noRecommendation.statusCode, 200);
  assert.deepEqual(noRecommendation.body, { 후보: [], 해당없음: true });
  results.push({ 시험: "AI 해당없음", 예상: 200, 결과: 200, 판정: "통과" });

  const noKeyApp = createApp({ store, openAiApiKey: "", openAiFetch: fakeOpenAIResponse({}) });
  const noKey = await call(noKeyApp, "POST", { 작업: "AI추천", 요구내용: "예산 현황" });
  assert.equal(noKey.statusCode, 500);
  assert.match(noKey.body.error, /OPENAI_API_KEY/);
  results.push({ 시험: "AI 키 누락 안내", 예상: 500, 결과: 500, 판정: "통과" });

  assert.equal(store.saveCount, 12, "AI 추천은 cases.json을 저장하지 않아야 합니다.");

  console.table(results);
  console.log(`결과: ${results.length}개 시험 모두 통과 · 저장 ${store.saveCount}회 · 문항 ${store.db.cases.length}건`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
