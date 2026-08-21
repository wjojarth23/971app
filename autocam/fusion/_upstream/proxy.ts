import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "./lib/api/common";

export async function proxy(request: NextRequest) {
  const userId = await getUserId(request);
  if (["/login", "/signup"].some(p => request.nextUrl.pathname.startsWith(p))) {
    if (userId)
      return NextResponse.redirect(new URL("/dashboard", process.env.BASE_URL));
    return NextResponse.next();
  }
  if (userId) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", process.env.BASE_URL));
}

export const config = {
  matcher: [
    "/((?!$|_next/|index/|auth|api).*)"
  ]
}