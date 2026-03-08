const DB_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/u;
const ISO_WITHOUT_TZ_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/u;
const TZ_SUFFIX_PATTERN = /(Z|[+-]\d{2}:\d{2})$/u;

function normalizeApiDateTime(value: string): string {
	const trimmed = value.trim();
	if (DB_DATETIME_PATTERN.test(trimmed)) {
		return `${trimmed.replace(" ", "T")}Z`;
	}
	if (ISO_WITHOUT_TZ_PATTERN.test(trimmed) && !TZ_SUFFIX_PATTERN.test(trimmed)) {
		return `${trimmed}Z`;
	}
	return trimmed;
}

export function parseApiDateTime(value: string): Date | null {
	if (!value) {
		return null;
	}
	const parsed = new Date(normalizeApiDateTime(value));
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}
	return parsed;
}

export function formatMonthDayTime(value: string): string {
	const date = parseApiDateTime(value);
	if (!date) {
		return value;
	}
	const month = date.getMonth() + 1;
	const day = date.getDate();
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${month}月${day}日 ${hours}:${minutes}`;
}
