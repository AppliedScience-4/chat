import { Hono } from "hono";
import { sha256 } from "hono/utils/crypto";
import { basicAuth } from "hono/basic-auth";
import { Base64 } from "js-base64";

import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { detectType } from "./utils";

import { ChatOpenAI } from "langchain/chat_models/openai";
import { HumanMessage, SystemMessage } from "langchain/schema";

type Bindings = {
  OPENAI_API_KEY: string;
  BUCKET: R2Bucket;
  USER: string;
  PASS: string;
};

const chat = new Hono<{ Bindings: Bindings }>();

chat.use("/", async (c, next) => {
  const auth = basicAuth({ username: c.env.USER, password: c.env.PASS });
  return auth(c, next);
});

chat.get("/", (c) => c.text("Auth OK"));

chat.post(
  "/",
  zValidator(
    "json",
    z.object({
      image: z.string().refine(Base64.isValid),
      language: z.string(),
    })
  ),
  async (c) => {
    const data = await c.req.json<{
      image: string;
      language: string;
    }>();
    const base64 = data.image;

    const type = detectType(base64);
    if (!type) return c.notFound();

    const body = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const key = `${await sha256(body)}.${type?.suffix}`;

    await c.env.BUCKET.put(key, body, {
      httpMetadata: {
        contentType: type?.mimeType,
      },
    });

    const vision = new ChatOpenAI({
      openAIApiKey: c.env.OPENAI_API_KEY,
      modelName: "gpt-4-vision-preview",
      maxTokens: 300,
    });

    const text = await vision.invoke([
      new SystemMessage({
        content: [
          {
            type: "text",
            text: "You are OCR machine. Output the characters in the given image. You can only respond with the extracted text. Ignore any characters that are cut off, obscured, or blurred due to lighting or other issues. ",
          },
        ],
      }),
      new HumanMessage({
        content: [
          {
            type: "image_url",
            image_url: `https://image.sayoi341.moe/${key}`,
          },
        ],
      }),
    ]);

    const chat = new ChatOpenAI({
      openAIApiKey: c.env.OPENAI_API_KEY,
      modelName: "gpt-4-turbo-preview",
      maxTokens: 300,
    });

    const result = await chat.invoke([
      new SystemMessage({
        content: [
          {
            type: "text",
            text: `Translate the text given by the user into ${data.language}.`,
          },
        ],
      }),
      new HumanMessage({
        content: [
          {
            type: "text",
            text: text.content.toString(),
          },
        ],
      }),
    ]);

    return c.json(result.toJSON());
  }
);

export default chat;
