import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// JWKS / OpenID discovery endpoints used to verify Convex Auth JWTs.
auth.addHttpRoutes(http);

export default http;
