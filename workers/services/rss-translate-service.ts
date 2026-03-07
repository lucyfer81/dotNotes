import { buildAiChatRuntime, callSiliconflowJson, getAiTaskTimeoutMs } from "./ai-provider-service";
import { isRecord } from "./common-service";

const DEFAULT_RSS_TRANSLATE_MAX_CHARS = 1600;

export function getRssTranslateMaxChars(env: Env): number {
	const ext = env as Env & { RSS_TRANSLATE_MAX_CHARS?: string };
	const parsed = Number(ext.RSS_TRANSLATE_MAX_CHARS);
	if (Number.isFinite(parsed) && parsed >= 200 && parsed <= 6000) {
		return Math.trunc(parsed);
	}
	return DEFAULT_RSS_TRANSLATE_MAX_CHARS;
}

export function getRssTranslateEnabled(env: Env): boolean {
	const ext = env as Env & { RSS_TRANSLATE_ENABLED?: string };
	const value = typeof ext.RSS_TRANSLATE_ENABLED === "string" ? ext.RSS_TRANSLATE_ENABLED.trim().toLowerCase() : "";
	if (!value) {
		return true;
	}
	return value === "1" || value === "true" || value === "yes";
}

export async function translateSummaryToChinese(env: Env, rawText: string): Promise<string> {
	const normalized = rawText.replace(/\s+/gu, " ").trim();
	if (!normalized) {
		return "";
	}
	if (hasStrongChineseSignal(normalized)) {
		return normalized;
	}

	let runtime;
	try {
		runtime = buildAiChatRuntime(env);
	} catch {
		return normalized;
	}
	try {
		const maxChars = getRssTranslateMaxChars(env);
		const payload = await callSiliconflowJson(
			runtime,
			{
				systemPrompt: "You translate technical/news text into concise Simplified Chinese. Return strict JSON only.",
				userPrompt: [
					"Translate the text to Simplified Chinese.",
					"Keep names, numbers, and links accurate.",
					`Input text: ${JSON.stringify(normalized.slice(0, maxChars))}`,
					`Output schema: ${JSON.stringify({ translatedSummary: "string" })}`,
				].join("\n"),
			},
			{
				timeoutMs: getAiTaskTimeoutMs(env, "summary"),
				label: "rss:translate",
			},
		);
		if (!isRecord(payload)) {
			return normalized;
		}
		const translatedSummary = readStringField(payload, "translatedSummary")
			|| readStringField(payload, "translation")
			|| readStringField(payload, "translated")
			|| readStringField(payload, "summaryZh");
		return translatedSummary || normalized;
	} catch (error) {
		console.error("RSS translation failed, fallback to original summary", error);
		return normalized;
	}
}

function readStringField(payload: Record<string, unknown>, key: string): string {
	const value = payload[key];
	if (typeof value !== "string") {
		return "";
	}
	return value.trim();
}

function hasStrongChineseSignal(text: string): boolean {
	let cjkCount = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
			cjkCount += 1;
		}
	}
	return cjkCount >= Math.max(12, Math.floor(text.length * 0.2));
}
