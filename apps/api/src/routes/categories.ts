// routes/categories.ts — CAT-7's category dropdown source: this user's
// active (non-archived) Category rows (CAT-9/ADR-0028), read-only through
// CAT-7. A user correcting a transaction into a category that doesn't
// exist yet falls back to a free-text control instead
// (ReviewCategoryControl.tsx) -- creating a real Category row from that
// was left for whenever CAT-9's own "manage categories" UI got scoped.
//
// CAT-14 added the create route this file's own comment (and
// CategoryRepository.create()'s) already anticipated: `POST
// /api/categories`.
//
// CAT-16 activates CategoryRepository.update() (CAT-10/CAT-11's
// recolor/re-icon method, now also re-kind) via a new
// `PATCH /api/categories/:id` -- that method has existed since CAT-10/
// CAT-11 with zero route ever calling it (grep-confirmed before writing
// this route: only its own test called it), left for "whenever CAT-12's
// fuller edit UI" per this file's own prior comment. The new
// /categories management page (CAT-16) is a legitimate first caller, so
// it's activated now rather than staying dormant for CAT-12. Same
// GET response shape/ownership pattern as every other route here.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CategoryRepository } from "@financial-os/db";
import { requireAuth } from "../auth/requireAuth.js";
import { pickDefaultCategoryColor } from "../categories/palette.js";

const categoryRepo = new CategoryRepository();

// CAT-11: no enum/allowlist enforced here against apps/web's curated icon
// set (design/categoryIcons.tsx) -- that set is a *frontend* picker
// constraint ("don't build free-form icon upload," BACKLOG.md), not a
// database-level one, the same way `color` has never been hex-format
// validated at this layer either. A value outside the curated set just
// falls back to a generic icon at render time (CategoryIcon's own doc
// comment) rather than failing the request.
const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(60).optional(),
  // CAT-16: defaults to "expense" here, at the schema layer, rather than
  // leaving it undefined for CategoryRepository.create()'s own
  // param-less-call-picks-up-the-Mongoose-schema-default path -- this
  // way the route's own response always reflects exactly what was
  // requested/defaulted, instead of depending on a second layer's
  // default to agree with this one.
  kind: z.enum(["income", "expense"]).default("expense"),
});

const updateCategorySchema = z
  .object({
    color: z.string().trim().min(1).max(32).optional(),
    icon: z.string().trim().min(1).max(60).optional(),
    kind: z.enum(["income", "expense"]).optional(),
  })
  .refine(
    (body) => body.color !== undefined || body.icon !== undefined || body.kind !== undefined,
    {
      message: "at least one of color, icon, or kind is required",
    },
  );

// Every seeded default gets an icon (CAT-11); a custom category created
// without picking one gets this instead of staying icon-less, so
// "Uncategorized" isn't the only category ever missing one.
const DEFAULT_CUSTOM_CATEGORY_ICON = "tag";

export async function registerCategoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/categories", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const categories = await categoryRepo.findActiveByUser(userId);
    return reply.send(
      categories.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        color: c.color,
        icon: c.icon,
        isDefault: c.isDefault,
        // CAT-16: normalized to a concrete value here rather than passed
        // through as `c.kind` -- a category row written before this
        // field existed has no `kind` physically stored and a `.lean()`
        // read (findActiveByUser()) does not backfill the schema's
        // "expense" default (Category.kind's own doc comment has the
        // full mechanics) -- so every API consumer sees a real
        // "income" | "expense", never undefined, matching the value
        // that would show up if the row were re-saved through update().
        kind: c.kind ?? "expense",
      })),
    );
  });

  // CAT-14: create a custom category. Color is never client-supplied --
  // BACKLOG.md's own text: "a color is required at creation -- CAT-10's
  // existing default-palette logic can seed a sensible one rather than
  // forcing a color picker up front" -- so this route always assigns one
  // (see categories/palette.ts), matching color to icon in being
  // something the user can change afterward (CAT-16's PATCH route below)
  // rather than something they choose here.
  app.post("/api/categories", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const body = createCategorySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid input" });
    }

    const existing = await categoryRepo.findActiveByUser(userId);
    if (existing.some((c) => c.name === body.data.name)) {
      // Matches CategoryModel's own {userId, name} unique index
      // (Category.ts) -- checked up front so this is a clean 409 instead
      // of a raw duplicate-key error surfacing from create() below.
      return reply.code(409).send({ error: "a category with that name already exists" });
    }

    const color = pickDefaultCategoryColor(existing.length);
    const created = await categoryRepo.create(
      userId,
      body.data.name,
      color,
      body.data.icon ?? DEFAULT_CUSTOM_CATEGORY_ICON,
      body.data.kind,
    );

    return reply.code(201).send({
      id: created._id.toString(),
      name: created.name,
      color: created.color,
      icon: created.icon,
      isDefault: created.isDefault,
      kind: created.kind ?? "expense",
    });
  });

  // CAT-16: color/icon/kind, ownership-scoped through
  // CategoryRepository.update()'s own {_id, userId} filter (this route's
  // first real caller -- see the file comment above). A category not
  // found for this user (wrong id, or someone else's) 404s rather than
  // silently no-op'ing.
  app.patch("/api/categories/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid category id" });
    }
    const body = updateCategorySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid input" });
    }

    const updated = await categoryRepo.update(userId, params.data.id, body.data);
    if (!updated) {
      return reply.code(404).send({ error: "category not found" });
    }

    return reply.send({
      id: updated._id.toString(),
      name: updated.name,
      color: updated.color,
      icon: updated.icon,
      isDefault: updated.isDefault,
      kind: updated.kind ?? "expense",
    });
  });
}
