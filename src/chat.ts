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
	R2_IMAGE_KV: KVNamespace;
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
			body: z.object({
				image: z.string().refine(Base64.isValid),
			}),
		}),
	),
	async (c) => {
		const data = await c.req.json<{ body: { image: string } }>();
		const base64 = data.body.image;

		const type = detectType(base64);
		if (!type) return c.notFound();

		const body = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

		const key = `${await sha256(body)}.${type?.suffix}`;

		await c.env.BUCKET.put(key, body, {
			httpMetadata: {
				contentType: type?.mimeType,
			},
		});

		const llm = new ChatOpenAI({
			openAIApiKey: c.env.OPENAI_API_KEY,
			modelName: "gpt-4-vision-preview",
			maxTokens: 300,
		});

		const result = await llm.invoke([
			new SystemMessage({
				content: [
					{
						type: "text",
						text: 'Describe the provided image URL in Japanese. Output the description in JSON format: {"description": string}',
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

		return c.json(result.toJSON());
	},
);

export default chat;
