import OpenAI from "openai";

export const MODEL = "qwen3.5-plus";

let _client: OpenAI | null = null;

export function getDashscope(): OpenAI {
  if (!_client) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error("DASHSCOPE_API_KEY environment variable is required");
    }
    _client = new OpenAI({
      apiKey,
      baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    });
  }
  return _client;
}
