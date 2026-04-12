import { z } from "zod";

export const LocalNoteDocumentSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  path: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type LocalNoteDocument = z.infer<typeof LocalNoteDocumentSchema>;
