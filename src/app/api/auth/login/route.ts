import { NextResponse } from "next/server";

type LoginBody = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  const expectedUsername = process.env.LOGIN_USERNAME;
  const expectedPassword = process.env.LOGIN_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return NextResponse.json(
      { success: false, error: "Configuracion de autenticacion incompleta" },
      { status: 500 },
    );
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Solicitud invalida" },
      { status: 400 },
    );
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const expectedUsernameNormalized = expectedUsername.trim().toLowerCase();
  const usernameNormalized = username.toLowerCase();

  if (usernameNormalized !== expectedUsernameNormalized || password !== expectedPassword) {
    return NextResponse.json(
      { success: false, error: "Credenciales incorrectas" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("auth_session", "authenticated", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
  return response;
}
