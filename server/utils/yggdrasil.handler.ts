import type { EventHandler, H3Event } from "h3";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["irminsul", "yggdrasil"]);

export class YggdrasilError extends Error {
  constructor(
    public httpStatus: number,
    public error: string,
    public errorMessage: string,
  ) {
    super(errorMessage);
  }

  toJSON() {
    return { error: this.error, errorMessage: this.errorMessage };
  }
}

export function defineYggdrasilHandler<T>(handler: (event: H3Event) => Promise<T>): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err instanceof YggdrasilError) {
        setResponseStatus(event, err.httpStatus);
        return err.toJSON();
      }
      logger.error`Unhandled Yggdrasil error: ${err}`;
      setResponseStatus(event, 500);
      return { error: "InternalError", errorMessage: "Internal server error" };
    }
  });
}
