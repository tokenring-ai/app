import { describe, expect, it } from "vitest";
import appRpc from "../rpc/app.ts";
import createTestingApp from "./createTestingApp";

describe("streamLogs RPC", () => {
  it("streams incremental log chunks with position", async () => {
    const app = createTestingApp();
    const controller = new AbortController();
    const stream = appRpc.methods.streamLogs.execute({ fromPosition: 0 }, app, controller.signal);

    const first = await stream.next();
    expect(first.value).toEqual({ logs: [], position: 0 });

    app.serviceOutput({ name: "TestService" } as never, "hello");
    const second = await stream.next();
    expect(second.value?.logs).toHaveLength(1);
    expect(second.value?.logs[0]?.message).toContain("hello");
    expect(second.value?.position).toBe(1);

    app.serviceError({ name: "TestService" } as never, "boom");
    const third = await stream.next();
    expect(third.value?.logs).toHaveLength(1);
    expect(third.value?.logs[0]?.level).toBe("error");
    expect(third.value?.position).toBe(2);

    controller.abort();
    const done = await stream.next();
    expect(done.done).toBe(true);
  });
});