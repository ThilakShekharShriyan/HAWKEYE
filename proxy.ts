import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_HEADER, checkAccess } from "./lib/access";

const unconfigured = () =>
  NextResponse.json({ error: "Set HAWKEYE_ACCESS_TOKEN to serve HAWKEYE" }, { status: 503 });

// Gates every page and API route behind the household access token.
// Open the app once with /?token=... to store it in an httpOnly cookie; the
// cookie then covers fetch, EventSource and <img> requests alike.
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const isApi = url.pathname.startsWith("/api/");
  const fromQuery = isApi ? null : url.searchParams.get("token");

  // A token in the page URL is judged on its own, so a stale cookie cannot
  // hide a valid link and a mistyped link cannot overwrite a good cookie.
  if (fromQuery !== null) {
    const verdict = checkAccess(fromQuery);
    if (verdict === "unconfigured") return unconfigured();
    if (verdict === "denied") {
      return new NextResponse("HAWKEYE is private. That token is not valid.", { status: 401 });
    }
    const clean = url.clone();
    clean.searchParams.delete("token");
    const response = NextResponse.redirect(clean);
    if (process.env.HAWKEYE_ACCESS_TOKEN?.trim()) {
      response.cookies.set(ACCESS_COOKIE, fromQuery, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return response;
  }

  const verdict = checkAccess(request.headers.get(ACCESS_HEADER) ?? request.cookies.get(ACCESS_COOKIE)?.value);
  if (verdict === "unconfigured") return unconfigured();
  if (verdict === "denied") {
    return isApi
      ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
      : new NextResponse("HAWKEYE is private. Open it with ?token=<household token>.", { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
