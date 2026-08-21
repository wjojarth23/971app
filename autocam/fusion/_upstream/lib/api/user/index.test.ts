import { NextRequest } from 'next/server';
import { describe, expect, test } from "vitest";
import { POST } from "@/app/api/auth/[...all]/route";

describe("Create User", () => {
  test("Minimum password length", async () => {
    const request = new NextRequest(`${process.env.BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "test@test.test",
        password: "pw",
        name: "Test User",
      })
    })
    expect((await POST(request)).status).toBe(400);
  });

  test("User created successfully", async () => {
    const request = new NextRequest(`${process.env.BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "test@test.test",
        password: "password",
        name: "Test User"
      })
    })
    expect((await POST(request)).status).toBe(200);
  });
});
