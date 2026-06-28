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
export function nowIso() {
    return new Date().toISOString();
}
