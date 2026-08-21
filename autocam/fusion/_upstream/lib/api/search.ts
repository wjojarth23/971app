import { BoxTubes, PartCategories, Parts } from "@/lib/db/schema/cam";
import { and, eq, ilike, or } from "drizzle-orm";
import zod from "zod";
import { routeFactory, routeResponse, parseSchema } from "./common";

const SearchParams = zod.object({
  q: zod.string().trim().min(1).max(100),
  limit: zod.coerce.number().int().positive().max(25).optional().default(8),
});

export const GET = routeFactory(async (req, _authType, tx, teamId) => {
  if (!teamId) return routeResponse(422);

  const params = req.nextUrl.searchParams;
  const data = await parseSchema(
    {
      q: params.get("q")?.toString(),
      limit: params.get("limit")?.toString(),
    },
    SearchParams
  );

  const q = data.q.trim();
  if (q.length < 2) {
    return routeResponse(200, { parts: [], partCategories: [], boxTubes: [] });
  }

  const limit = data.limit;
  const pattern = `%${q}%`;
  const numeric = Number(q);
  const hasNumeric = Number.isFinite(numeric);

  const partCategories = await tx
    .select({
      id: PartCategories.id,
      material: PartCategories.material,
      thickness: PartCategories.thickness,
    })
    .from(PartCategories)
    .where(
      and(
        eq(PartCategories.team_id, teamId),
        or(
          ilike(PartCategories.material, pattern),
          hasNumeric ? eq(PartCategories.thickness, numeric) : undefined
        )
      )
    )
    .orderBy(PartCategories.material)
    .limit(limit);

  const parts = await tx
    .select({
      id: Parts.id,
      name: Parts.name,
      epic: Parts.epic,
      ticket: Parts.ticket,
      quantity: Parts.quantity,
      categoryId: PartCategories.id,
      categoryMaterial: PartCategories.material,
      categoryThickness: PartCategories.thickness,
    })
    .from(Parts)
    .innerJoin(PartCategories, eq(Parts.category_id, PartCategories.id))
    .where(
      and(
        eq(PartCategories.team_id, teamId),
        or(
          ilike(Parts.name, pattern),
          ilike(Parts.epic, pattern),
          ilike(Parts.ticket, pattern),
          ilike(PartCategories.material, pattern)
        )
      )
    )
    .orderBy(Parts.name)
    .limit(limit);

  const boxTubes = await tx
    .select({
      id: BoxTubes.id,
      name: BoxTubes.name,
      epic: BoxTubes.epic,
      ticket: BoxTubes.ticket,
      quantity: BoxTubes.quantity,
    })
    .from(BoxTubes)
    .where(
      and(
        eq(BoxTubes.team_id, teamId),
        or(
          ilike(BoxTubes.name, pattern),
          ilike(BoxTubes.epic, pattern),
          ilike(BoxTubes.ticket, pattern)
        )
      )
    )
    .orderBy(BoxTubes.name)
    .limit(limit);

  return routeResponse(200, {
    parts: parts.map((p) => ({
      id: p.id,
      name: p.name,
      epic: p.epic,
      ticket: p.ticket,
      quantity: p.quantity,
      category: {
        id: p.categoryId,
        material: p.categoryMaterial,
        thickness: p.categoryThickness,
      },
    })),
    partCategories,
    boxTubes,
  });
}, { user: {} });

