import { z } from "zod";
import { AppStateSlice } from "../types.ts";

export interface LogEntry {
  timestamp: number;
  level: "info" | "error";
  message: string;
}

const serializationSchema = z.object({
  logs: z.array(
    z.object({
      timestamp: z.number(),
      level: z.enum(["info", "error"]),
      message: z.string(),
    }),
  ),
});

export class AppLogsState extends AppStateSlice<typeof serializationSchema> {
  logs: LogEntry[] = [];

  constructor() {
    super("AppLogsState", serializationSchema);
  }

  serialize(): z.output<typeof serializationSchema> {
    return {
      logs: this.logs,
    };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.logs = data.logs ?? [];
  }

  addLog(level: "info" | "error", message: string): void {
    this.logs.push({
      timestamp: Date.now(),
      level,
      message,
    });
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }
}
