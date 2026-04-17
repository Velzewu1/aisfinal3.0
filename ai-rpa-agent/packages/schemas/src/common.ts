import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0";

export const CorrelationId = z.string().min(1);
export type CorrelationId = z.infer<typeof CorrelationId>;

export const Confidence = z.number().min(0).max(1);
export type Confidence = z.infer<typeof Confidence>;

export const IsoTimestamp = z.string().datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

export const SessionContext = z.object({
  sessionId: z.string().min(1),
  correlationId: CorrelationId,
  pageId: z.string().min(1).optional(),
  patientId: z.string().min(1).optional(),
  startedAt: IsoTimestamp,
});
export type SessionContext = z.infer<typeof SessionContext>;
