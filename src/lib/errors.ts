import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { corsHeaders } from "./cors";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public traceId: string = randomUUID(),
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(status: number, code: string, message: string): ApiError {
  return new ApiError(status, code, message);
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "Invalid request";
    return NextResponse.json(
      {
        error: message,
        message,
        code: "VALIDATION",
        traceId: randomUUID(),
      },
      { status: 400, headers: corsHeaders() },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: error.message,
        message: error.message,
        code: error.code,
        traceId: error.traceId,
      },
      { status: error.status, headers: corsHeaders() },
    );
  }

  const traceId = randomUUID();
  console.error(JSON.stringify({ level: "error", traceId, err: String(error) }));
  return NextResponse.json(
    {
      error: "Internal server error",
      message: "Internal server error",
      code: "INTERNAL",
      traceId,
    },
    { status: 500, headers: corsHeaders() },
  );
}

export function jsonOk<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}
