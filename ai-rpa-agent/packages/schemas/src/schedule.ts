import { z } from "zod";

export const SlotMinutes = z.number().int().positive().max(24 * 60);

export const Doctor = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  specialty: z.string().min(1).optional(),
});
export type Doctor = z.infer<typeof Doctor>;

export const Procedure = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  durationMinutes: SlotMinutes,
  allowedDoctorIds: z.array(z.string().min(1)).min(1),
});
export type Procedure = z.infer<typeof Procedure>;

export const WorkingWindow = z.object({
  doctorId: z.string().min(1),
  day: z.number().int().min(0).max(8),
  startMinute: z.number().int().min(0).max(24 * 60 - 1),
  endMinute: z.number().int().min(1).max(24 * 60),
});
export type WorkingWindow = z.infer<typeof WorkingWindow>;

export const ScheduleRequest = z.object({
  horizonDays: z.number().int().positive().max(30).default(9),
  doctors: z.array(Doctor).min(1),
  procedures: z.array(Procedure).min(1),
  windows: z.array(WorkingWindow).min(1),
  slotMinutes: SlotMinutes.default(15),
});
export type ScheduleRequest = z.infer<typeof ScheduleRequest>;

export const ScheduledAssignment = z.object({
  procedureId: z.string().min(1),
  doctorId: z.string().min(1),
  day: z.number().int().min(0).max(30),
  startMinute: z.number().int().min(0),
  endMinute: z.number().int().min(1),
});
export type ScheduledAssignment = z.infer<typeof ScheduledAssignment>;

export const ScheduleResult = z.object({
  status: z.enum(["optimal", "feasible", "infeasible", "unknown"]),
  assignments: z.array(ScheduledAssignment),
  objective: z.number().optional(),
});
export type ScheduleResult = z.infer<typeof ScheduleResult>;
