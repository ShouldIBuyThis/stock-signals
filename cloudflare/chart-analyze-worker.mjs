/**
 * 📸 국장 장중 차트 캡처 분석 서버 (Cloudflare Worker) — 2026-11-12 사용자 지시.
 * 사용자가 올린 차트 캡처 1장을 Claude(비전)에게 보내 '보이는 것만' 읽게 하고, 결과 JSON을 사이트에 돌려준다.
 *
 * ⚠ 기존 장중 중계 Worker(intraday-worker.mjs)와 별개다 — 그 Worker는 건드리지 않는다.
 * 쓰는 법(대시보드에 붙여넣는 방식 — 이 Worker는 npm 묶음 없이 배포되므로 SDK 대신 HTTPS 호출을 쓴다):
 *   1) Cloudflare 대시보드 → Workers & Pages → Create → Hello World → 이름 "chart-analyze" → Deploy → Edit code → 이 파일 전체 붙여넣기 → Deploy
 *   2) 그 Worker → Settings → Variables and Secrets → Add (Type: Secret)
 *        ANTHROPIC_API_KEY = (Anthropic Console에서 만든 API 키)
 *        CHART_PASS        = (사이트에서 한 번 입력할 개인 암호 — 남이 내 키로 분석을 돌리지 못하게)
 *   3) 사이트 주소 예: https://chart-analyze.<계정이름>.workers.dev/  (index.html의 CHART_API와 같아야 한다)
 * 개인정보: 이미지는 저장하지 않는다(KV·R2·캐시 없음). 분석을 위해 Anthropic API로만 전송된다.
 * 비용: 요청마다 Anthropic API 사용료가 사용자 계정에 청구된다(이미지 1장 ≈ 입력 2~3천 토큰 + 출력 1~3천 토큰).
 */
const ALLOW = ["https://shouldibuythis.github.io"];
const MODEL = "claude-opus-5-5";
const MAX_B64 = 7_000_000;            // base64 약 5MB까지(사이트가 긴 변 1600px로 줄여 보낸다)
const TYPES = ["image/png", "image/jpeg", "image/webp"];
const TF = ["1분", "5분", "15분", "30분", "60분", "일봉", "주봉", "모름"];

const NA = "확인 불가";
const S = { type: "string" };
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["flow", "flow_reason", "seen_signals", "bb", "rsi", "macd", "stoch", "volume", "candles", "resistance", "support",
             "top_check", "trim_review", "trim_reason", "up_scenario", "down_scenario", "chart_time", "chart_tf", "unreadable"],
  properties: {
    flow: { type: "string", enum: ["상승", "횡보", "약화", "하락", NA] },
    flow_reason: S,
    seen_signals: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "where"], properties: { name: S, where: S } } },
    bb: S, rsi: S, macd: S, stoch: S, volume: S, candles: S,
    resistance: { type: "array", items: S },
    support: { type: "array", items: S },
    top_check: { type: "object", additionalProperties: false, required: ["bb_upper", "near_high", "risk_candle", "note"], properties: {
      bb_upper: { type: "string", enum: ["예", "아니오", NA] }, near_high: { type: "string", enum: ["예", "아니오", NA] },
      risk_candle: { type: "string", enum: ["예", "아니오", NA] }, note: S } },
    trim_review: { type: "string", enum: ["근거 있음", "추가 확인 필요"] },
    trim_reason: S, up_scenario: S, down_scenario: S, chart_time: S, chart_tf: S,
    unreadable: { type: "array", items: S },
  },
};

const SYSTEM = `너는 한국 주식·ETF 차트 캡처를 읽는 보조 분석가다. 사용자는 장중에 캡처한 차트 이미지 1장을 올린다.
규칙(반드시 지켜라):
- 이미지에서 실제로 보이는 것만 근거로 쓴다. 이미지에 없는 지표·가격·시각은 만들지 말고 "${NA}"라고 쓴다.
- 축 눈금·라벨에서 읽을 수 있는 가격만 지지·저항으로 적는다. 흐릿하거나 겹쳐 읽기 어려운 숫자는 추측하지 말고 unreadable에 적는다.
- RSI·MACD·스토캐스틱·볼린저밴드·거래량이 화면에 없으면 해당 칸에 "${NA}". 보이면 위치·방향(과열/약화 등)만 짧게.
- 캔들은 최근 몇 개 봉의 모양(윗꼬리·아랫꼬리·도지·팽이·유성형·석별형·장대음봉 등)을 보이는 대로.
- top_check: 볼밴 상단권(상단선 근처·돌파), 화면 안 최근 고점 근접, 위험 캔들이 각각 보이는지. 셋이 겹치면 note에 적는다.
- 일부 익절 검토는 근거가 화면에 보일 때만 "근거 있음", 아니면 "추가 확인 필요". 매수·매도 지시나 확률·점수는 쓰지 않는다.
- 상승 지속 시나리오와 하락 전환 시나리오를 둘 다 쓴다(각 1~2문장, 화면 근거 기반).
- 차트 주기와 화면에 찍힌 시각(있으면)을 chart_tf·chart_time에 적는다. 이것은 캡처 시점 자료이지 실시간 시세가 아니다.
- 한국어 해요체, 짧게.`;

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = { "Access-Control-Allow-Origin": ALLOW.includes(origin) ? origin : ALLOW[0], "Vary": "Origin",
                   "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Chart-Pass" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const configured = !!(env.ANTHROPIC_API_KEY && env.CHART_PASS);
    if (req.method === "GET") return json({ ok: true, configured, model: MODEL }, 200, cors);
    if (req.method !== "POST") return json({ error: "GET·POST만 받아요" }, 405, cors);
    if (!ALLOW.includes(origin)) return json({ error: "허용되지 않은 출처예요" }, 403, cors);
    if (!configured) return json({ error: "분석 서버 설정 전이에요(ANTHROPIC_API_KEY·CHART_PASS)" }, 503, cors);
    if ((req.headers.get("X-Chart-Pass") || "") !== env.CHART_PASS) return json({ error: "암호가 맞지 않아요" }, 401, cors);

    let b; try { b = await req.json(); } catch (e) { return json({ error: "요청 형식 오류" }, 400, cors); }
    const img = String(b.image || ""), mt = String(b.media_type || "");
    if (!TYPES.includes(mt)) return json({ error: "PNG·JPEG·WEBP 이미지만 받아요" }, 400, cors);
    if (!img || img.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(img)) return json({ error: "이미지가 없거나 너무 커요" }, 400, cors);
    const tk = String(b.ticker || "").slice(0, 20), nm = String(b.name || "").slice(0, 40);
    const tf = TF.includes(b.tf) ? b.tf : "모름", at = String(b.captured_at || "").slice(0, 40);

    const body = {
      model: MODEL, max_tokens: 8000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mt, data: img } },
        { type: "text", text: `종목: ${nm || "(사용자 미입력)"} ${tk ? `(${tk})` : ""}\n사용자가 고른 차트 주기: ${tf}\n업로드 시각(사용자 기기 기준): ${at || "모름"}\n위 규칙대로 이 캡처를 분석해 JSON으로 답해.` },
      ] }],
    };
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: {
        "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01" }, body: JSON.stringify(body) });
    } catch (e) { return json({ error: "분석 서버(Anthropic)에 연결하지 못했어요" }, 502, cors); }
    let d; try { d = await r.json(); } catch (e) { return json({ error: `분석 응답 형식 오류(${r.status})` }, 502, cors); }
    if (!r.ok) return json({ error: `분석 서버 오류 ${r.status}: ${(d && d.error && d.error.message) || ""}`.slice(0, 300) }, 502, cors);
    if (d.stop_reason === "refusal") return json({ error: "이 이미지는 분석할 수 없다고 응답했어요" }, 422, cors);
    if (d.stop_reason === "max_tokens") return json({ error: "분석이 길어져 중간에 끊겼어요 — 다시 시도해 주세요" }, 502, cors);
    const txt = (d.content || []).filter(x => x.type === "text").map(x => x.text).join("");
    let out; try { out = JSON.parse(txt); } catch (e) { return json({ error: "분석 결과를 읽지 못했어요" }, 502, cors); }
    return json({ ok: true, result: out, model: d.model, usage: d.usage ? { in: d.usage.input_tokens, out: d.usage.output_tokens } : null, analyzed_at: new Date().toISOString() }, 200, cors);
  },
};
