import { z } from "zod";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";

const BriefingScheduleSchema = z
  .object({
    enabled: z.boolean(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format.")
      .refine(
        (t) => {
          const [h, m] = t.split(":").map(Number);
          return h >= 0 && h <= 23 && m >= 0 && m <= 59;
        },
        { message: "Time must be a valid HH:MM value." }
      )
  })
  .strict();

type BriefingScheduleConfig = z.infer<typeof BriefingScheduleSchema>;

// In-memory store for MVP. A production implementation would persist
// this to the repository or a config file.
let briefingSchedule: BriefingScheduleConfig = {
  enabled: false,
  time: "08:00"
};

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    return authenticatedJson({ schedule: briefingSchedule });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve briefing schedule.");
  }
}

export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const body = await parseJsonBody(request, BriefingScheduleSchema);
    briefingSchedule = body;
    return authenticatedJson({ schedule: briefingSchedule });
  } catch (error) {
    return handleApiError(error, "Failed to update briefing schedule.");
  }
}
