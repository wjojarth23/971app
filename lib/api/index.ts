import { router } from "../trpc/server";

import teams from "./teams";
import "./machines";
import "./materials";
import "./parts";
import "./pc";
import "./plates";
import "./boxTubes";
import "./user";
import "./auth";
import "./tools";
import "./jobs";

export const appRouter = router({
  teams
});

export type AppRouter = typeof appRouter;
