import { z } from "zod";

export const PatchExtractedFindingActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }).strict(),
  z.object({ action: z.literal("reject"), reason: z.string().optional() }).strict(),
  z.object({ action: z.literal("correct"), correctedText: z.string().trim().min(1), correctedFindingId: z.string().uuid().optional() }).strict(),
]);

export type PatchExtractedFindingAction = z.infer<typeof PatchExtractedFindingActionSchema>;
