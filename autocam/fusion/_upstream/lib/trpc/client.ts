"use client";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { AppRouter } from "../api";

export default createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `/api/trpc` })]
});