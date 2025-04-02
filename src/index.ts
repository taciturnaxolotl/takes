import { SlackApp } from "slack-edge";

import * as features from "./features/index";

import { t, t_fetch } from "./libs/template";
import { blog } from "./libs/Logger";
import { version, name } from "../package.json";
const environment = process.env.NODE_ENV;

// Check required environment variables
const requiredVars = ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"] as const;
const missingVars = requiredVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
	throw new Error(
		`Missing required environment variables: ${missingVars.join(", ")}`,
	);
}

console.log(
	`----------------------------------\n${name} Server\n----------------------------------\n`,
);
console.log(`🏗️  Starting ${name}...`);
console.log("📦 Loading Slack App...");
console.log("🔑 Loading environment variables...");

const slackApp = new SlackApp({
	env: {
		SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
		SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET!,
		SLACK_LOGGING_LEVEL: "INFO",
	},
	startLazyListenerAfterAck: true,
});
const slackClient = slackApp.client;

console.log(`⚒️  Loading ${Object.entries(features).length} features...`);
for (const [feature, handler] of Object.entries(features)) {
	console.log(`📦 ${feature} loaded`);
	if (typeof handler === "function") {
		handler();
	}
}

export default {
	port: process.env.PORT || 3000,
	async fetch(request: Request) {
		const url = new URL(request.url);
		const path = url.pathname;

		switch (path) {
			case "/":
				return new Response(`Hello World from ${name}@${version}`);
			case "/health":
				return new Response("OK");
			case "/slack":
				return slackApp.run(request);
			default:
				return new Response("404 Not Found", { status: 404 });
		}
	},
};

console.log(
	`🚀 Server Started in ${
		Bun.nanoseconds() / 1000000
	} milliseconds on version: ${version}!\n\n----------------------------------\n`,
);

blog(
	t("app.startup", {
		environment,
	}),
	"start",
	{
		channel: process.env.SLACK_SPAM_CHANNEL || "",
	},
);

console.log("\n----------------------------------\n");

export { slackApp, slackClient, version, name, environment };
