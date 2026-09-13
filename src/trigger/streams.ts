import { streams } from "@trigger.dev/sdk";
import { REALTIME_STREAMS } from "@/contracts/api";

export const thinkingStream = streams.define<string>({ id: REALTIME_STREAMS.thinking });
export const assistantStream = streams.define<string>({ id: REALTIME_STREAMS.assistant });
