import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Our database user id — the key every authorization lookup uses. */
      id: string;
    } & DefaultSession["user"];
  }
}
