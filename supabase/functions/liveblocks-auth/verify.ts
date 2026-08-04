export function extractBearerToken(authHeader: string | null): string {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("missing or malformed Authorization header");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new Error("missing or malformed Authorization header");
  }
  return token;
}
