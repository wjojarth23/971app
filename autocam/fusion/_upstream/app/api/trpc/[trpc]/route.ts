import { appRouter } from '@/lib/api';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { NextRequest } from 'next/server';
import { createContext } from '@/lib/trpc/server';

const handler = (req: NextRequest) => fetchRequestHandler({
  endpoint: "/api/trpc",
  req,
  router: appRouter,
  createContext
});

export {
  handler as GET,
  handler as POST
}
