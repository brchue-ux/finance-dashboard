/**
 * Request schema shared by POST /api/import/csv and its preview endpoint.
 * One definition, because the preview is only honest if it parses the file
 * exactly the way the commit will — a drifted copy would warn about one
 * import and perform another. (Next route files can only export handlers,
 * so the schema lives here.)
 */
import { z } from "zod";

export const csvImportSchema = z.object({
  csv: z.string().min(1),
  mapping: z.object({
    date: z.string().min(1),
    description: z.string().min(1),
    amount: z.string().min(1),
    category: z.string().optional(),
  }),
  negateAmounts: z.boolean().optional(),
});
