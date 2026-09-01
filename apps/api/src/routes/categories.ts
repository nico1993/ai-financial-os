// routes/categories.ts — CAT-7's category dropdown source: this user's
// active (non-archived) Category rows (CAT-9/ADR-0028), read-only. No
// create/rename/recolor route here yet -- CategoryRepository.create()'s
// own doc comment already flags CAT-7 as where a create route was
// expected to land, but this ticket's actual scope (BACKLOG.md) is
// "list needs_review transactions, manual category correction, triggers
// write-back," not a full category-management UI. A user correcting a
// transaction into a category that doesn't exist yet falls back to a
// free-text control instead (ReviewCategoryControl.tsx) -- creating a
// real Category row from that is left for whenever CAT-9's own
// "manage categories" UI is actually scoped.
import type { FastifyInstance } from "fastify";
import { CategoryRepository } from "@financial-os/db";
import { requireAuth } from "../auth/requireAuth.js";

const categoryRepo = new CategoryRepository();

export async function registerCategoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/categories", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const categories = await categoryRepo.findActiveByUser(userId);
    return reply.send(
      categories.map((c) => ({ id: c._id.toString(), name: c.name, color: c.color })),
    );
  });
}
