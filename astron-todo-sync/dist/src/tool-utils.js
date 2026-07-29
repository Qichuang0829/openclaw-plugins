export function jsonResult(payload) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(payload, null, 2),
            },
        ],
        details: typeof payload === "object" && payload !== null ? payload : undefined,
    };
}
export function errorResult(code, error, options = {}) {
    return jsonResult({
        ...(options.extra ?? {}),
        success: false,
        error,
        code,
        retryable: false,
        ...(options.nextAction ? { next_action: options.nextAction } : {}),
    });
}
export function isErrorCode(error, code) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === code);
}
export function nowIso() {
    return new Date().toISOString();
}
