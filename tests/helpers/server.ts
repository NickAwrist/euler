import type { Server } from "node:http";
import { app } from "../../src/app";

export const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";

export function userHeaders(
  ownerUuid = TEST_USER_ID,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { "X-Euler-User-ID": ownerUuid, ...extra };
}

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export function startTestServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        return reject(new Error("Failed to get server address"));
      }

      const url = `http://127.0.0.1:${address.port}`;

      const close = (): Promise<void> => {
        return new Promise((resolveClose, rejectClose) => {
          server.close((err) => {
            if (err) {
              rejectClose(err);
            } else {
              resolveClose();
            }
          });
        });
      };

      resolve({ url, close });
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}
