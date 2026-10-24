import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_HEADER, checkAccess } from "./lib/access";

// Gates every page and API route behind the household access token.
// Open the app once with /?token=... to store it in an httpOnly cookie; the
// cookie then covers fetch, EventSource and <img> requests alike.
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const isApi = url.pathname.startsWith("/api/");
  const fromQuery = isApi ? null : url.searchParams.get("token");
  const presented = request.headers.get(ACCESS_HEADER) ?? request.cookies.get(ACCESS_COOKIE)?.value ?? fromQuery;

  const verdict = checkAccess(presented);
  if (verdict === "unconfigured") {
    return NextResponse.json({ error: "Set HAWKEYE_ACCESS_TOKEN to serve HAWKEYE" }, { status: 503 });
  }
  if (verdict === "denied") {
    return isApi
      ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
      : new NextResponse("HAWKEYE is private. Open it with ?token=<household token>.", { status: 401 });
  }

  if (fromQuery) {
    const clean = url.clone();
    clean.searchParams.delete("token");
    const response = NextResponse.redirect(clean);
    response.cookies.set(ACCESS_COOKIE, fromQuery, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
