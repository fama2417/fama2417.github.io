export type AiOperationState = "idle" | "saving" | "analyzing" | "refreshing" | "success" | "error";

export const isAiOperationActive = (state: AiOperationState) => ["saving", "analyzing", "refreshing"].includes(state);

export async function runAiExtractionWorkflow<T>(steps: {
  saveDraft: () => Promise<void>;
  analyze: () => Promise<void>;
  refresh: () => Promise<T>;
}, setState: (state: AiOperationState) => void) {
  setState("saving");
  try {
    await steps.saveDraft();
  } catch {
    setState("error");
    return { ok: false as const, phase: "saving" as const };
  }
  try {
    setState("analyzing");
    await steps.analyze();
    setState("refreshing");
    const value = await steps.refresh();
    setState("success");
    return { ok: true as const, value };
  } catch {
    setState("error");
    return { ok: false as const, phase: "analysis" as const };
  }
}
